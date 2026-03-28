import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime
  end: string;
  allDay: boolean;
  calendar: string;
  reminders?: number[]; // minutes before
}

interface CalendarConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  calendars?: string[]; // calendar IDs to watch
  travelTimeMinutes?: number;
  focusBlocks?: Array<{ day: number; start: string; end: string }>;
}

export class CalendarPlugin implements AuraPlugin {
  name = 'calendar';
  version = '0.1.0';
  private ctx!: PluginContext;
  private config!: CalendarConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.config = ctx.config as unknown as CalendarConfig;

    // Listen for calendar-related events
    ctx.logger.info('Calendar plugin loaded');
  }

  async onActivate(): Promise<void> {
    // Schedule periodic sync (every 5 minutes)
    this.ctx.schedule('*/5 * * * *', async () => {
      await this.syncEvents();
    });

    // Schedule daily conflict check (8 AM)
    this.ctx.schedule('0 8 * * *', async () => {
      await this.checkConflicts();
    });

    this.ctx.logger.info('Calendar plugin activated — syncing every 5m, conflict check at 8 AM');
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Calendar plugin deactivated');
  }

  // --- Google Calendar API ---

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new Error('Calendar: Google OAuth not configured. Set clientId, clientSecret, and refreshToken.');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Calendar: OAuth token refresh failed (${response.status})`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  async getEvents(timeMin: string, timeMax: string, calendarId = 'primary'): Promise<CalendarEvent[]> {
    const token = await this.getAccessToken();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`Calendar API error (${response.status})`);
    }

    const data = await response.json() as {
      items: Array<{
        id: string;
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
        reminders?: { overrides?: Array<{ minutes: number }> };
      }>;
    };

    return data.items.map(item => ({
      id: item.id,
      summary: item.summary || '(No title)',
      description: item.description,
      location: item.location,
      start: item.start.dateTime || item.start.date || '',
      end: item.end.dateTime || item.end.date || '',
      allDay: !item.start.dateTime,
      calendar: calendarId,
      reminders: item.reminders?.overrides?.map(r => r.minutes),
    }));
  }

  async getTodayEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    return this.getEvents(startOfDay, endOfDay);
  }

  async getUpcomingEvents(days = 7): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.getEvents(now.toISOString(), future.toISOString());
  }

  // --- Conflict Detection ---

  async checkConflicts(): Promise<Array<{ event1: CalendarEvent; event2: CalendarEvent }>> {
    const events = await this.getTodayEvents();
    const conflicts: Array<{ event1: CalendarEvent; event2: CalendarEvent }> = [];

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i];
        const b = events[j];
        if (a.allDay || b.allDay) continue;

        const aStart = new Date(a.start).getTime();
        const aEnd = new Date(a.end).getTime();
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();

        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push({ event1: a, event2: b });
        }
      }
    }

    if (conflicts.length > 0) {
      const msg = conflicts.map(c =>
        `⚠️ Conflict: "${c.event1.summary}" overlaps with "${c.event2.summary}"`
      ).join('\n');

      this.ctx.emit('conflicts', { conflicts });
      await this.ctx.notify(msg, { urgency: 'high' });
      this.ctx.logger.warn(`Found ${conflicts.length} calendar conflict(s)`);
    }

    return conflicts;
  }

  // --- Sync ---

  private async syncEvents(): Promise<void> {
    try {
      const events = await getUpcomingEventsLocal(this);
      // Cache in storage
      for (const event of events) {
        this.ctx.storage.set('calendar-events', event.id, event, {
          date: event.start,
          calendar: event.calendar,
        });
      }
      this.ctx.emit('synced', { count: events.length });
      this.ctx.logger.debug(`Calendar synced: ${events.length} events`);
    } catch (err) {
      this.ctx.logger.error(`Calendar sync failed: ${err}`);
    }
  }

  // --- Formatting ---

  formatEvent(event: CalendarEvent): string {
    const start = new Date(event.start);
    const time = event.allDay ? 'All day' :
      start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const loc = event.location ? ` 📍 ${event.location}` : '';
    return `${time} — ${event.summary}${loc}`;
  }

  formatDaySummary(events: CalendarEvent[]): string {
    if (events.length === 0) return '📅 No events today. Enjoy the free time!';

    const lines = events.map(e => this.formatEvent(e));
    return `📅 *Today's Schedule* (${events.length} events)\n\n${lines.join('\n')}`;
  }
}

// Helper to avoid 'this' issues in sync
async function getUpcomingEventsLocal(plugin: CalendarPlugin): Promise<CalendarEvent[]> {
  return plugin.getUpcomingEvents(7);
}
