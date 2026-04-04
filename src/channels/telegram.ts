import type { Agent } from '../core/agent.js';
import type { Logger } from '../core/logger.js';
import type { MemoryStore } from '../core/storage/index.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
}

interface TelegramResponse {
  ok: boolean;
  result: TelegramUpdate[] | unknown;
  description?: string;
}

export class TelegramChannel {
  private token: string;
  private baseUrl: string;
  private agent: Agent;
  private log: Logger;
  private polling = false;
  private offset = 0;
  private allowedUsers: Set<number> = new Set();
  private inFlight = 0;
  private readonly maxConcurrent = 5;
  private knownChatIds: Set<number> = new Set();
  private storage: MemoryStore | null = null;
  private readonly CHAT_IDS_KEY = 'chat_ids';
  private readonly CHAT_IDS_COLLECTION = 'telegram';

  constructor(token: string, agent: Agent, logger: Logger, allowedUserIds?: number[], storage?: MemoryStore) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.agent = agent;
    this.log = logger;

    if (allowedUserIds && allowedUserIds.length > 0) {
      this.allowedUsers = new Set(allowedUserIds);
      this.log.info(`Telegram: restricted to ${allowedUserIds.length} allowed user(s)`);
    }

    if (storage) {
      this.storage = storage;
      // Load persisted chatIds on startup
      const stored = storage.get<{ ids: number[] }>(this.CHAT_IDS_COLLECTION, this.CHAT_IDS_KEY);
      if (stored?.ids) {
        this.knownChatIds = new Set(stored.ids);
        this.log.info(`Telegram: loaded ${this.knownChatIds.size} known chat(s) from storage`);
      }
    }
  }

  private registerChatId(chatId: number): void {
    if (this.knownChatIds.has(chatId)) return;
    this.knownChatIds.add(chatId);
    if (this.storage) {
      this.storage.set(this.CHAT_IDS_COLLECTION, this.CHAT_IDS_KEY, { ids: Array.from(this.knownChatIds) });
    }
    this.log.info(`Telegram: registered new chat ${chatId} (total: ${this.knownChatIds.size})`);
  }

  getChatIds(): number[] {
    return Array.from(this.knownChatIds);
  }

  async broadcastAlert(message: string, urgency: string = 'normal'): Promise<void> {
    if (this.knownChatIds.size === 0) {
      this.log.warn('Telegram broadcastAlert: no known chats yet — alert dropped');
      return;
    }
    const prefix = urgency === 'critical' ? '🚨' :
                   urgency === 'high' ? '⚠️' :
                   urgency === 'low' ? '📌' : '📢';
    const text = `${prefix} ${message}`;
    for (const chatId of this.knownChatIds) {
      try {
        await this.sendMessage(chatId, text);
      } catch (err) {
        this.log.error(`Telegram broadcastAlert failed for chat ${chatId}: ${err}`);
      }
    }
  }

  async start(): Promise<void> {
    // Verify bot token
    const me = await this.apiCall('getMe');
    if (!me.ok) {
      throw new Error(`Telegram bot auth failed: ${me.description}`);
    }
    const bot = me.result as { username: string; first_name: string };
    this.log.info(`Telegram bot connected: @${bot.username} (${bot.first_name})`);

    this.polling = true;
    this.pollLoop();
  }

  stop(): void {
    this.polling = false;
    this.log.info('Telegram polling stopped');
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const response = await this.apiCall('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });

        if (response.ok && Array.isArray(response.result)) {
          for (const update of response.result as TelegramUpdate[]) {
            this.offset = update.update_id + 1;
            // Process without blocking the poll loop (bounded concurrency)
            if (this.inFlight < this.maxConcurrent) {
              this.inFlight++;
              this.handleUpdate(update).catch(err => {
                this.log.error(`Update handling error: ${err}`);
              }).finally(() => { this.inFlight--; });
            } else {
              this.log.warn('Too many concurrent updates, dropping message');
            }
          }
        }
      } catch (err) {
        this.log.error(`Telegram poll error: ${err}`);
        // Back off on error
        await this.sleep(5000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.text) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Access control
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(userId)) {
      this.log.warn(`Telegram: unauthorized user ${userId} (@${msg.from.username})`);
      await this.sendMessage(chatId, '⛔ Unauthorized. This bot is private.');
      return;
    }

    this.log.info(`Telegram [${msg.from.username ?? userId}]: ${text.slice(0, 100)}`);

    // Register this chat for proactive alerts
    this.registerChatId(chatId);

    // Handle commands
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text, msg.from);
      return;
    }

    // Process through agent
    try {
      // Send typing indicator
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });

      const response = await this.agent.processMessage(text, {
        channel: 'telegram',
        userId,
        username: msg.from.username,
        chatId,
      });

      await this.sendMessage(chatId, response);
    } catch (err) {
      this.log.error(`Agent error: ${err}`);
      await this.sendMessage(chatId, '⚠️ Something went wrong. Try again.');
    }
  }

  private async handleCommand(chatId: number, text: string, from: { id: number; first_name: string }): Promise<void> {
    const [command] = text.split(/\s+/);

    switch (command) {
      case '/start':
        await this.sendMessage(chatId,
          `🔱 <b>Aura v0.3</b>\n\nHey ${from.first_name}! I'm your personal AI life manager.\n\n` +
          `Send me any message and I'll help. Here's what I can do:\n\n` +
          `<b>General</b>\n` +
          `/status — System status\n` +
          `/plugins — Active plugins\n` +
          `/clear — Clear conversation\n` +
          `/help — Show this message\n\n` +
          `<b>Finance</b>\n` +
          `/spend — Today's spending\n` +
          `/budget — Budget status\n` +
          `/summary — Monthly summary\n\n` +
          `<b>Documents &amp; Subscriptions</b>\n` +
          `/docs — Document vault\n` +
          `/subs — Subscription tracker`,
          { parse_mode: 'HTML' }
        );
        break;

      case '/status': {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const mem = process.memoryUsage();
        const memMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

        await this.sendMessage(chatId,
          `📊 <b>Aura Status</b>\n\n` +
          `⏱ Uptime: ${hours}h ${mins}m\n` +
          `💾 Memory: ${memMB} MB\n` +
          `🔌 Channel: Telegram`,
          { parse_mode: 'HTML' }
        );
        break;
      }

      case '/plugins': {
        const pluginList = this.agent.getPlugins();
        if (pluginList.length === 0) {
          await this.sendMessage(chatId, '🔌 No plugins active.\n\nPlugins will be available in v0.2+ (Email, Finance, Calendar, etc.)');
        } else {
          const lines = pluginList.map(p => `  • ${p.name} v${p.version} (${p.state})`);
          await this.sendMessage(chatId, `🔌 <b>Plugins</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
        }
        break;
      }

      case '/clear':
        this.agent.clearHistory();
        await this.sendMessage(chatId, '🧹 Conversation cleared.');
        break;

      case '/spend': {
        const fp = this.getFinancePlugin();
        if (!fp) { await this.sendMessage(chatId, '💰 Finance plugin not active.'); break; }
        const daily = fp.getDailySummary();
        await this.sendMessage(chatId, daily ?? '💰 No spending recorded today.', { parse_mode: 'HTML' });
        break;
      }

      case '/budget': {
        const fp = this.getFinancePlugin();
        if (!fp) { await this.sendMessage(chatId, '💰 Finance plugin not active.'); break; }
        await fp.checkBudgets();
        await this.sendMessage(chatId, '✅ Budget check complete.');
        break;
      }

      case '/summary': {
        const fp = this.getFinancePlugin();
        if (!fp) { await this.sendMessage(chatId, '💰 Finance plugin not active.'); break; }
        const monthly = fp.getMonthlySummary();
        await this.sendMessage(chatId, monthly ?? '📊 No transactions this month.', { parse_mode: 'HTML' });
        break;
      }

      case '/docs': {
        const docPlugin = this.agent.getPluginInstance('documents');
        if (!docPlugin || typeof (docPlugin as Record<string, unknown>).getSummary !== 'function') {
          await this.sendMessage(chatId, '📄 Document vault not active.');
          break;
        }
        const summary = (docPlugin as { getSummary(): string }).getSummary();
        await this.sendMessage(chatId, summary, { parse_mode: 'HTML' });
        break;
      }

      case '/subs': {
        const subPlugin = this.agent.getPluginInstance('subscriptions');
        if (!subPlugin || typeof (subPlugin as Record<string, unknown>).getMonthlyCostSummary !== 'function') {
          await this.sendMessage(chatId, '🔔 Subscription watchdog not active.');
          break;
        }
        const subSummary = (subPlugin as { getMonthlyCostSummary(): string }).getMonthlyCostSummary();
        await this.sendMessage(chatId, subSummary, { parse_mode: 'HTML' });
        break;
      }

      case '/help':
        await this.sendMessage(chatId,
          `🔱 <b>Aura Commands</b>\n\n` +
          `<b>General</b>\n` +
          `/status — System status\n` +
          `/plugins — Active plugins\n` +
          `/clear — Clear conversation\n` +
          `/help — This message\n\n` +
          `<b>Finance</b>\n` +
          `/spend — Today's spending\n` +
          `/budget — Budget check\n` +
          `/summary — Monthly summary\n\n` +
          `<b>Documents &amp; Subscriptions</b>\n` +
          `/docs — Document vault summary\n` +
          `/subs — Subscription costs\n\n` +
          `Or just send any message — I'm here to help manage your life.`,
          { parse_mode: 'HTML' }
        );
        break;

      default:
        await this.sendMessage(chatId, `Unknown command: ${command}\nType /help for available commands.`);
    }
  }

  async sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    // Convert Markdown to Telegram HTML for AI responses (no parse_mode set)
    if (!extra.parse_mode) {
      text = this.markdownToTelegramHtml(text);
      extra.parse_mode = 'HTML';
    }

    // Telegram max message length is 4096
    if (text.length > 4096) {
      const chunks = this.chunkText(text, 4096);
      for (const chunk of chunks) {
        await this.apiCall('sendMessage', { chat_id: chatId, text: chunk, ...extra });
      }
      return;
    }

    const result = await this.apiCall('sendMessage', { chat_id: chatId, text, ...extra });
    // If HTML parse fails, retry without formatting
    if (!result.ok && extra.parse_mode) {
      const plain = text.replace(/<[^>]+>/g, '');
      await this.apiCall('sendMessage', { chat_id: chatId, text: plain });
    }
  }

  private markdownToTelegramHtml(text: string): string {
    // Escape HTML entities first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');

    // Italic: *text* or _text_ (but not inside words like don_t)
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

    // Code blocks: ```text```
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre>$2</pre>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');

    // Inline code: `text`
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Headers: # text → bold
    html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

    // Bullet points: clean up
    html = html.replace(/^[-•]\s+/gm, '• ');

    return html;
  }

  async sendNotification(chatId: number, message: string, urgency: string = 'normal'): Promise<void> {
    const prefix = urgency === 'critical' ? '🚨' :
                   urgency === 'high' ? '⚠️' :
                   urgency === 'low' ? '📌' : '📢';
    await this.sendMessage(chatId, `${prefix} ${message}`);
  }

  private chunkText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to break at newline
      let breakAt = remaining.lastIndexOf('\n', maxLen);
      if (breakAt < maxLen / 2) breakAt = maxLen;
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    }
    return chunks;
  }

  private async apiCall(method: string, body?: Record<string, unknown>): Promise<TelegramResponse> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    return await response.json() as TelegramResponse;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getFinancePlugin(): { getDailySummary(): string | null; getMonthlySummary(): string | null; checkBudgets(): Promise<void> } | null {
    const plugin = this.agent.getPluginInstance('finance');
    if (!plugin || typeof (plugin as Record<string, unknown>).getDailySummary !== 'function') return null;
    return plugin as { getDailySummary(): string | null; getMonthlySummary(): string | null; checkBudgets(): Promise<void> };
  }
}
