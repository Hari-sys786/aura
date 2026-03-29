import type { AiAdapter, ChatMessage, ChatResponse } from './ai/index.js';
import type { MemoryStore } from './storage/index.js';
import type { PluginBus } from './plugin-bus.js';
import type { Scheduler } from './scheduler.js';
import type { Logger } from './logger.js';

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
  private async fetchPluginData(message: string): Promise<string | null> {
    const msg = message.toLowerCase();
    const parts: string[] = [];

    // Email intent
    const emailKeywords = ['email', 'mail', 'inbox', 'unread', 'newsletter', 'junk', 'spam', 'bill', 'invoice'];
    if (emailKeywords.some(k => msg.includes(k))) {
      try {
        const emailPlugin = this.plugins.getPlugin('email');
        if (emailPlugin) {
          const emails = this.storage.sqlite.list('emails');
          if (emails.length > 0) {
            const classified = emails.slice(0, 20).map(e => {
              const val = JSON.parse(e.value);
              return `- [${val.category}] From: ${val.fromName} | Subject: ${val.subject} | Date: ${val.date?.slice(0, 10) ?? 'unknown'}`;
            });
            parts.push(`Recent Emails (${emails.length} total):\n${classified.join('\n')}`);
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

    // Finance intent
    const financeKeywords = ['spend', 'spending', 'expense', 'money', 'budget', 'finance', 'transaction', 'cost'];
    if (financeKeywords.some(k => msg.includes(k))) {
      try {
        const transactions = this.storage.sqlite.list('transactions');
        if (transactions.length > 0) {
          const recent = transactions.slice(0, 10).map(t => {
            const val = JSON.parse(t.value);
            return `- ${val.type} ₹${val.amount} | ${val.merchant} (${val.category}) | ${val.date?.slice(0, 10) ?? ''}`;
          });
          const totalSpent = transactions
            .map(t => JSON.parse(t.value))
            .filter((v: { type: string }) => v.type === 'debit')
            .reduce((sum: number, v: { amount: number }) => sum + v.amount, 0);
          parts.push(`Finance (${transactions.length} transactions, Total spent: ₹${totalSpent}):\n${recent.join('\n')}`);
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

    // Add any additional context
    if (context) {
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
