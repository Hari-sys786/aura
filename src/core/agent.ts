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

    this.systemPrompt = `You are Aura, a personal AI life management assistant. You help manage emails, calendar, finances, documents, and daily routines. You are direct, helpful, and proactive. You run locally on the user's device and respect their privacy completely.

Available capabilities depend on active plugins. When asked about something you can't do yet, explain what plugin is needed.

Be concise. Prioritize actionable responses. Don't over-explain.`;
  }

  /**
   * Process an incoming message and return the agent's response.
   */
  async processMessage(userMessage: string, context?: Record<string, unknown>): Promise<string> {
    this.log.info(`Processing message: "${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: userMessage });

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

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }
}
