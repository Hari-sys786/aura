import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';
import type { CalendarPlugin } from './calendar.js';

interface BriefingConfig {
  morningTime?: string; // cron format, default "0 8 * * *"
  eveningTime?: string; // default "0 21 * * *"
  weeklyDay?: number;   // 0=Sun, 1=Mon, default 1
  timezone?: string;
  enableMorning?: boolean;
  enableEvening?: boolean;
  enableWeekly?: boolean;
}

export class BriefingPlugin implements AuraPlugin {
  name = 'briefing';
  version = '0.1.0';
  private ctx!: PluginContext;
  private config!: BriefingConfig;

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      morningTime: '0 8 * * *',
      eveningTime: '0 21 * * *',
      weeklyDay: 1,
      enableMorning: true,
      enableEvening: true,
      enableWeekly: true,
      ...ctx.config as Record<string, unknown>,
    } as BriefingConfig;

    ctx.logger.info('Briefing plugin loaded');
  }

  async onActivate(): Promise<void> {
    if (this.config.enableMorning) {
      this.ctx.schedule(this.config.morningTime!, async () => {
        const briefing = await this.generateMorningBriefing();
        await this.ctx.notify(briefing);
      });
      this.ctx.logger.info(`Morning briefing scheduled: ${this.config.morningTime}`);
    }

    if (this.config.enableEvening) {
      this.ctx.schedule(this.config.eveningTime!, async () => {
        const briefing = await this.generateEveningBriefing();
        await this.ctx.notify(briefing);
      });
      this.ctx.logger.info(`Evening briefing scheduled: ${this.config.eveningTime}`);
    }

    if (this.config.enableWeekly) {
      this.ctx.schedule(`0 9 * * ${this.config.weeklyDay}`, async () => {
        const briefing = await this.generateWeeklyBriefing();
        await this.ctx.notify(briefing);
      });
      this.ctx.logger.info(`Weekly briefing scheduled: day ${this.config.weeklyDay}`);
    }
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Briefing plugin deactivated');
  }

  // --- Morning Briefing ---

  async generateMorningBriefing(): Promise<string> {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateFmt = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const sections: string[] = [
      `🌅 *Good Morning!*\n${dayName}, ${dateFmt}\n`,
    ];

    // Calendar section
    try {
      const calendarSummary = await this.getCalendarSummary();
      sections.push(calendarSummary);
    } catch {
      sections.push('📅 Calendar not available');
    }

    // Pending tasks
    const tasks = this.getPendingTasks();
    if (tasks) sections.push(tasks);

    // Due bills
    const bills = this.getDueBills();
    if (bills) sections.push(bills);

    sections.push('\n_Have a productive day!_ 🔱');
    return sections.join('\n');
  }

  // --- Evening Briefing ---

  async generateEveningBriefing(): Promise<string> {
    const sections: string[] = [
      `🌙 *Evening Summary*\n`,
    ];

    // What happened today
    const completed = this.getCompletedToday();
    if (completed) sections.push(completed);

    // Tomorrow preview
    try {
      const tomorrow = await this.getTomorrowPreview();
      sections.push(tomorrow);
    } catch {
      // Calendar not available
    }

    // Overdue items
    const overdue = this.getOverdueItems();
    if (overdue) sections.push(overdue);

    sections.push('\n_Rest well._ 🌙');
    return sections.join('\n');
  }

  // --- Weekly Briefing ---

  async generateWeeklyBriefing(): Promise<string> {
    const sections: string[] = [
      `📊 *Weekly Overview*\n`,
    ];

    // Week ahead calendar
    try {
      const weekAhead = await this.getWeekAheadSummary();
      sections.push(weekAhead);
    } catch {
      sections.push('📅 Calendar not available');
    }

    // Upcoming deadlines
    const deadlines = this.getUpcomingDeadlines();
    if (deadlines) sections.push(deadlines);

    sections.push('\n_Let\'s make this week count._ 🔱');
    return sections.join('\n');
  }

  // --- Helpers ---

  private async getCalendarSummary(): Promise<string> {
    // Pull from stored calendar events
    const events = this.ctx.storage.sqlite.list('calendar-events');
    const today = new Date().toISOString().slice(0, 10);

    const todayEvents = events.filter(e => {
      const val = JSON.parse(e.value);
      return val.start?.startsWith(today);
    });

    if (todayEvents.length === 0) {
      return '📅 No events today — wide open schedule!';
    }

    const lines = todayEvents.map(e => {
      const val = JSON.parse(e.value);
      const time = val.allDay ? 'All day' :
        new Date(val.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `  • ${time} — ${val.summary}`;
    });

    return `📅 *Schedule* (${todayEvents.length} events)\n${lines.join('\n')}`;
  }

  private async getTomorrowPreview(): Promise<string> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const events = this.ctx.storage.sqlite.list('calendar-events');
    const tomorrowEvents = events.filter(e => {
      const val = JSON.parse(e.value);
      return val.start?.startsWith(tomorrowStr);
    });

    if (tomorrowEvents.length === 0) {
      return '📅 Tomorrow: nothing scheduled';
    }

    return `📅 Tomorrow: ${tomorrowEvents.length} event(s)`;
  }

  private async getWeekAheadSummary(): Promise<string> {
    const events = this.ctx.storage.sqlite.list('calendar-events');
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weekEvents = events.filter(e => {
      const val = JSON.parse(e.value);
      const start = new Date(val.start);
      return start >= now && start <= weekEnd;
    });

    return `📅 *This week:* ${weekEvents.length} event(s)`;
  }

  private getPendingTasks(): string | null {
    const tasks = this.ctx.storage.sqlite.list('tasks');
    const pending = tasks.filter(t => {
      const val = JSON.parse(t.value);
      return val.status === 'pending';
    });

    if (pending.length === 0) return null;

    const lines = pending.slice(0, 5).map(t => {
      const val = JSON.parse(t.value);
      return `  • ${val.title}`;
    });

    const more = pending.length > 5 ? `\n  _...and ${pending.length - 5} more_` : '';
    return `✅ *Pending Tasks* (${pending.length})\n${lines.join('\n')}${more}`;
  }

  private getDueBills(): string | null {
    const bills = this.ctx.storage.sqlite.list('bills');
    const now = new Date();
    const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const due = bills.filter(b => {
      const val = JSON.parse(b.value);
      const dueDate = new Date(val.dueDate);
      return dueDate <= threeDays && val.status !== 'paid';
    });

    if (due.length === 0) return null;

    const lines = due.map(b => {
      const val = JSON.parse(b.value);
      return `  • ${val.name}: ₹${val.amount} due ${val.dueDate}`;
    });

    return `💰 *Due Bills*\n${lines.join('\n')}`;
  }

  private getCompletedToday(): string | null {
    const audit = this.ctx.storage.sqlite.auditQuery({
      action: 'task:completed',
      after: new Date().toISOString().slice(0, 10),
      limit: 10,
    });

    if (audit.length === 0) return '✅ No tasks completed today';
    return `✅ Completed today: ${audit.length} task(s)`;
  }

  private getOverdueItems(): string | null {
    const tasks = this.ctx.storage.sqlite.list('tasks');
    const overdue = tasks.filter(t => {
      const val = JSON.parse(t.value);
      return val.status === 'pending' && val.dueDate && new Date(val.dueDate) < new Date();
    });

    if (overdue.length === 0) return null;
    return `⚠️ *Overdue:* ${overdue.length} item(s) need attention`;
  }

  private getUpcomingDeadlines(): string | null {
    const tasks = this.ctx.storage.sqlite.list('tasks');
    const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = tasks.filter(t => {
      const val = JSON.parse(t.value);
      return val.dueDate && new Date(val.dueDate) <= week && val.status !== 'done';
    });

    if (upcoming.length === 0) return null;
    return `⏰ *Upcoming deadlines:* ${upcoming.length} this week`;
  }
}
