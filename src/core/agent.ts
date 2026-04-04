import type { AiAdapter, ChatMessage, ChatResponse } from './ai/index.js';
import type { MemoryStore } from './storage/index.js';
import type { PluginBus } from './plugin-bus.js';
import type { Scheduler } from './scheduler.js';
import type { Logger } from './logger.js';
import { todayIST, monthIST, toISTDate, toISTDateTime } from './timezone.js';

export interface AgentContext {
  ai: AiAdapter;
  storage: MemoryStore;
  plugins: PluginBus;
  scheduler: Scheduler;
  logger: Logger;
}

/**
 * Aura Agent Runtime — processes incoming messages, reasons with AI, and dispatches actions.
 */
export class Agent {
  private ai: AiAdapter;
  private storage: MemoryStore;
  private plugins: PluginBus;
  private scheduler: Scheduler;
  private log: Logger;
  private systemPrompt: string;
  private conversationHistory: ChatMessage[] = [];
  private maxHistory = 50;

  constructor(ctx: AgentContext) {
    this.ai = ctx.ai;
    this.storage = ctx.storage;
    this.plugins = ctx.plugins;
    this.scheduler = ctx.scheduler;
    this.log = ctx.logger;

    this.systemPrompt = `You are Aura, a personal AI life management assistant. You are direct, concise, and proactive.

When the user asks about emails, calendar, finances, or briefings — you have REAL access to their data through plugins.

IMPORTANT: You will receive plugin data in your context when relevant. Use it to answer directly. Never say "I can't access" — if a plugin is active, you CAN access the data.
TIMEZONE: The user is in IST (India Standard Time, UTC+5:30). All dates and times in responses must be in IST. Today is ${todayIST()} IST.

Commands you support:
- Email: list emails, show bills, show newsletters, check unread
- Calendar: show today's schedule, upcoming events, conflicts
- Finance: show spending, set budget, monthly summary
- Briefing: morning/evening/weekly summary

Be concise. Answer with actual data, not instructions.`;
  }

  /**
   * Process an incoming message and return the agent's response.
   */
  async processMessage(userMessage: string, context?: Record<string, unknown>): Promise<string> {
    this.log.info(`Processing message: "${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);

    // Detect intent and fetch relevant plugin data
    const pluginData = await this.fetchPluginData(userMessage);

    // Add user message to history (with plugin data appended if available)
    const enrichedMessage = pluginData
      ? `${userMessage}\n\n[Plugin Data]\n${pluginData}`
      : userMessage;

    this.conversationHistory.push({ role: 'user', content: enrichedMessage });

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistory) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
    }

    // Build context-enriched messages
    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(context) },
      ...this.conversationHistory,
    ];

    try {
      const response = await this.ai.chat(messages);

      // Store assistant response in history
      this.conversationHistory.push({ role: 'assistant', content: response.content });

      // Audit the interaction
      this.storage.audit('agent:chat', {
        userMessage: userMessage.slice(0, 200),
        model: response.model,
        tokens: response.usage?.totalTokens,
      });

      // Emit event for plugins to react
      this.plugins.emit('agent:response', {
        userMessage,
        response: response.content,
        context,
      });

      this.log.info(`Response generated (${response.usage?.totalTokens ?? '?'} tokens)`);
      return response.content;
    } catch (err) {
      this.log.error(`AI reasoning failed: ${err}`);
      // Remove the user message from history on failure
      this.conversationHistory.pop();
      throw err;
    }
  }

  /**
   * Process a system event (from plugins, scheduler, etc.) — no user input.
   */
  async processEvent(event: string, data: unknown): Promise<string | null> {
    this.log.info(`Processing event: ${event}`);
    this.plugins.emit(event, data);

    // Some events need AI reasoning
    if (this.shouldReasonAbout(event)) {
      const messages: ChatMessage[] = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: `[System Event: ${event}]\n${JSON.stringify(data, null, 2)}` },
      ];

      const response = await this.ai.chat(messages);
      return response.content;
    }

    return null;
  }

  /**
   * Detect user intent and fetch relevant data from plugins.
   */
  async fetchPluginData(message: string): Promise<string | null> {
    const msg = message.toLowerCase();
    const parts: string[] = [];

    // Email intent
    const emailKeywords = ['email', 'mail', 'inbox', 'unread', 'newsletter', 'junk', 'spam', 'bill', 'invoice'];
    if (emailKeywords.some(k => msg.includes(k))) {
      try {
        const emailPlugin = this.plugins.getPlugin('email');
        // Trigger a fresh sync if plugin supports it (non-blocking, best effort)
        if (emailPlugin && typeof (emailPlugin as any).syncNow === 'function') {
          try { await Promise.race([(emailPlugin as any).syncNow(), new Promise(r => setTimeout(r, 3000))]); }
          catch { /* best effort */ }
        }
        if (emailPlugin) {
          const emails = this.storage.sqlite.list('emails');
          if (emails.length > 0) {
            // Sort by date descending and show most recent, with IST date
            
            const parsed = emails.map(e => JSON.parse(e.value))
              .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
            const classified = parsed.slice(0, 15).map((val: any) => {
              return `- [${val.category}] From: ${val.fromName} | Subject: ${val.subject} | ${toISTDateTime(val.date)}`;
            });
            parts.push(`Recent Emails (${emails.length} total, latest first):\n${classified.join('\n')}`);
          } else {
            parts.push('No emails fetched yet. Email sync runs every 5 minutes.');
          }
        }
      } catch (err) {
        this.log.error(`Failed to fetch email data: ${err}`);
      }
    }

    // Calendar intent
    const calendarKeywords = ['calendar', 'schedule', 'meeting', 'event', 'appointment', 'today', 'tomorrow', 'week'];
    if (calendarKeywords.some(k => msg.includes(k))) {
      try {
        const events = this.storage.sqlite.list('calendar-events');
        if (events.length > 0) {
          const upcoming = events.slice(0, 10).map(e => {
            const val = JSON.parse(e.value);
            const time = val.allDay ? 'All day' : val.start?.slice(11, 16) ?? '';
            return `- ${time} | ${val.summary}${val.location ? ` (${val.location})` : ''}`;
          });
          parts.push(`Calendar Events:\n${upcoming.join('\n')}`);
        } else {
          parts.push('No calendar events synced yet. Calendar sync runs every 5 minutes.');
        }
      } catch (err) {
        this.log.error(`Failed to fetch calendar data: ${err}`);
      }
    }

    // Finance intent — smart date filtering based on query
    const financeKeywords = ['spend', 'spending', 'expense', 'money', 'budget', 'finance', 'transaction', 'cost'];
    if (financeKeywords.some(k => msg.includes(k))) {
      try {
        const allTransactions = this.storage.sqlite.list('transactions');
        if (allTransactions.length > 0) {
          const todayISTStr = todayIST();
          const monthISTStr = monthIST();
          const parsed = allTransactions.map(t => ({ ...JSON.parse(t.value), _key: t.key }));

          // Detect requested date range from the query
          const nowISTDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
          let targetDate = todayISTStr; // default: today
          let dateLabel = 'Today';

          if (/yesterday/i.test(msg)) {
            const yd = new Date(nowISTDate); yd.setDate(yd.getDate() - 1);
            targetDate = yd.toISOString().slice(0, 10);
            dateLabel = 'Yesterday';
          } else if (/last\s*week/i.test(msg)) {
            const wd = new Date(nowISTDate); wd.setDate(wd.getDate() - 7);
            targetDate = ''; dateLabel = 'Last 7 days';
          } else if (/this\s*week/i.test(msg)) {
            const dayOfWeek = nowISTDate.getDay();
            const weekStart = new Date(nowISTDate); weekStart.setDate(weekStart.getDate() - dayOfWeek);
            targetDate = ''; dateLabel = 'This week';
          }

          // Match: exact YYYY-MM-DD in query, or "april 3", "3rd april", etc
          const dateMatch = msg.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) { targetDate = dateMatch[1]; dateLabel = targetDate; }

          // Filter transactions
          let filtered: any[];
          if (dateLabel === 'Last 7 days') {
            const cutoff = new Date(nowISTDate); cutoff.setDate(cutoff.getDate() - 7);
            const cutoffStr = cutoff.toISOString().slice(0, 10);
            filtered = parsed.filter((v: any) => toISTDate(v.date) >= cutoffStr);
          } else if (dateLabel === 'This week') {
            const dayOfWeek = nowISTDate.getDay();
            const weekStart = new Date(nowISTDate); weekStart.setDate(weekStart.getDate() - dayOfWeek);
            const weekStartStr = weekStart.toISOString().slice(0, 10);
            filtered = parsed.filter((v: any) => toISTDate(v.date) >= weekStartStr);
          } else if (/this\s*month|month/i.test(msg) && !targetDate) {
            filtered = parsed.filter((v: any) => toISTDate(v.date)?.startsWith(monthISTStr));
            dateLabel = `This month (${monthISTStr})`;
          } else {
            filtered = parsed.filter((v: any) => toISTDate(v.date) === targetDate);
          }

          // Also compute month totals for context
          const monthTxns = parsed.filter((v: any) => toISTDate(v.date)?.startsWith(monthISTStr));
          const monthSpent = monthTxns.filter((v: any) => v.type === 'debit').reduce((s: number, v: any) => s + (v.amount || 0), 0);

          const periodSpent = filtered.filter((v: any) => v.type === 'debit').reduce((s: number, v: any) => s + (v.amount || 0), 0);
          const periodDebits = filtered.filter((v: any) => v.type === 'debit');

          // Sort by amount descending for "top" queries
          const sortedDebits = [...periodDebits].sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0));
          const topN = /top\s*(\d+)/i.exec(msg);
          const limit = topN ? parseInt(topN[1]) : 10;
          const shown = sortedDebits.slice(0, limit);

          const txnList = shown.map((v: any) =>
            `- ₹${v.amount} | ${v.merchant || v.description?.slice(0, 30)} (${v.category || 'uncategorized'}) | ${toISTDate(v.date)}`
          );

          const summary = `${dateLabel} (IST): ₹${periodSpent} spent across ${periodDebits.length} debits.\nThis month total: ₹${monthSpent}.`;

          if (shown.length > 0) {
            parts.push(`Finance:\n${summary}\n\nTransactions${topN ? ` (top ${limit})` : ''}:\n${txnList.join('\n')}`);
          } else {
            parts.push(`Finance:\n${summary}\nNo debit transactions for ${dateLabel.toLowerCase()}.`);
          }
        } else {
          parts.push('No transactions recorded yet.');
        }
      } catch (err) {
        this.log.error(`Failed to fetch finance data: ${err}`);
      }
    }

    // Document intent
    const docKeywords = ['document', 'vault', 'file', 'pdf', 'passport', 'license', 'certificate', 'insurance', 'medical', 'receipt'];
    if (docKeywords.some(k => msg.includes(k))) {
      try {
        const docs = this.storage.sqlite.list('documents');
        if (docs.length > 0) {
          const list = docs.slice(0, 10).map(d => {
            const val = JSON.parse(d.value);
            return `- [${val.category}] ${val.originalName} (${val.tags?.join(', ') ?? ''})`;
          });
          parts.push(`Documents (${docs.length} total):\n${list.join('\n')}`);
        } else {
          parts.push('No documents in vault yet. Send files to store them.');
        }
      } catch (err) {
        this.log.error(`Failed to fetch document data: ${err}`);
      }
    }

    // Subscription intent
    const subKeywords = ['subscription', 'subscribe', 'renewal', 'renew', 'netflix', 'spotify', 'prime', 'monthly cost'];
    if (subKeywords.some(k => msg.includes(k))) {
      try {
        const subs = this.storage.sqlite.list('subscriptions');
        if (subs.length > 0) {
          const list = subs.map(s => {
            const val = JSON.parse(s.value);
            return `- ${val.name}: ${val.currency} ${val.amount}/${val.frequency} (${val.status})`;
          });
          parts.push(`Subscriptions (${subs.length}):\n${list.join('\n')}`);
        } else {
          parts.push('No subscriptions tracked yet.');
        }
      } catch (err) {
        this.log.error(`Failed to fetch subscription data: ${err}`);
      }
    }

    // Smart home intent
    const haKeywords = ['light', 'switch', 'turn on', 'turn off', 'temperature', 'thermostat', 'lock', 'home', 'device', 'smart'];
    if (haKeywords.some(k => msg.includes(k))) {
      try {
        const states = this.storage.sqlite.list('ha-states');
        if (states.length > 0) {
          const list = states.slice(0, 15).map(s => {
            const val = JSON.parse(s.value);
            const name = (val.attributes?.friendly_name as string) ?? val.entity_id;
            return `- ${name}: ${val.state}`;
          });
          parts.push(`Smart Home Devices (${states.length}):\n${list.join('\n')}`);
        }
      } catch (err) {
        this.log.error(`Failed to fetch HA data: ${err}`);
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  private buildSystemPrompt(context?: Record<string, unknown>): string {
    const parts = [this.systemPrompt];

    // Add active plugin info
    const activePlugins = this.plugins.listPlugins().filter(p => p.state === 'active');
    if (activePlugins.length > 0) {
      parts.push(`\nActive plugins: ${activePlugins.map(p => p.name).join(', ')}`);
    }

    // Add channel-specific instructions
    if (context?.channel === 'alexa') {
      
      parts.push(`\nIMPORTANT: This is a voice response for Alexa. Keep it SHORT (under 3 sentences). No markdown, no bullet lists, no special characters. Speak naturally. Numbers spoken plainly ("eight thousand" not "₹8,000"). Summarize don't itemize. User timezone is IST (UTC+5:30). Today's date in IST is ${todayIST()}. Only report data matching TODAY's date. If no data for today, say "nothing so far today".`);
    } else if (context) {
      parts.push(`\nContext: ${JSON.stringify(context)}`);
    }

    return parts.join('\n');
  }

  private shouldReasonAbout(event: string): boolean {
    // Events that benefit from AI reasoning
    const reasonableEvents = [
      'email:received',
      'calendar:conflict',
      'finance:threshold',
      'document:expiring',
      'briefing:generate',
    ];
    return reasonableEvents.some(e => event.startsWith(e));
  }

  getPlugins(): Array<{ name: string; version: string; state: string }> {
    return this.plugins.listPlugins();
  }

  getPluginInstance(name: string): unknown {
    return this.plugins.getPlugin(name);
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }
}
