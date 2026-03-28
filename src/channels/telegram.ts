import type { Agent } from '../core/agent.js';
import type { Logger } from '../core/logger.js';

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

  constructor(token: string, agent: Agent, logger: Logger, allowedUserIds?: number[]) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.agent = agent;
    this.log = logger;

    if (allowedUserIds && allowedUserIds.length > 0) {
      this.allowedUsers = new Set(allowedUserIds);
      this.log.info(`Telegram: restricted to ${allowedUserIds.length} allowed user(s)`);
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
            await this.handleUpdate(update);
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
          `🔱 *Aura v0.1*\n\nHey ${from.first_name}! I'm your personal AI life manager.\n\n` +
          `Send me any message and I'll help. Here's what I can do:\n\n` +
          `/status — System status\n` +
          `/plugins — Active plugins\n` +
          `/clear — Clear conversation\n` +
          `/help — Show this message`,
          { parse_mode: 'Markdown' }
        );
        break;

      case '/status': {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const mem = process.memoryUsage();
        const memMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

        await this.sendMessage(chatId,
          `📊 *Aura Status*\n\n` +
          `⏱ Uptime: ${hours}h ${mins}m\n` +
          `💾 Memory: ${memMB} MB\n` +
          `🔌 Channel: Telegram`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case '/clear':
        this.agent.clearHistory();
        await this.sendMessage(chatId, '🧹 Conversation cleared.');
        break;

      case '/help':
        await this.sendMessage(chatId,
          `🔱 *Aura Commands*\n\n` +
          `/status — System status\n` +
          `/plugins — Active plugins\n` +
          `/clear — Clear conversation\n` +
          `/help — This message\n\n` +
          `Or just send any message — I'm here to help manage your life.`,
          { parse_mode: 'Markdown' }
        );
        break;

      default:
        await this.sendMessage(chatId, `Unknown command: ${command}\nType /help for available commands.`);
    }
  }

  async sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    // Telegram max message length is 4096
    if (text.length > 4096) {
      const chunks = this.chunkText(text, 4096);
      for (const chunk of chunks) {
        await this.apiCall('sendMessage', { chat_id: chatId, text: chunk, ...extra });
      }
      return;
    }

    await this.apiCall('sendMessage', { chat_id: chatId, text, ...extra });
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
}
