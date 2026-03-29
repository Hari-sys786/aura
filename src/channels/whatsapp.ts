import type { Agent } from '../core/agent.js';
import type { Logger } from '../core/logger.js';

interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret?: string;
}

interface WAMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  document?: { id: string; filename: string };
}

interface WAWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: WAMessage[];
        statuses?: unknown[];
      };
      field: string;
    }>;
  }>;
}

export class WhatsAppChannel {
  private agent: Agent;
  private log: Logger;
  private config: WhatsAppConfig;
  private baseUrl = 'https://graph.facebook.com/v19.0';

  constructor(config: WhatsAppConfig, agent: Agent, logger: Logger) {
    this.config = config;
    this.agent = agent;
    this.log = logger;
  }

  // Webhook verification (GET)
  handleVerification(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      this.log.info('WhatsApp webhook verified');
      return challenge;
    }
    this.log.warn('WhatsApp webhook verification failed');
    return null;
  }

  // Webhook handler (POST)
  async handleWebhook(body: string): Promise<void> {
    const payload = JSON.parse(body) as WAWebhookPayload;

    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          const contact = contacts.find(c => c.wa_id === msg.from);
          const name = contact?.profile?.name ?? msg.from;
          await this.handleMessage(msg, name);
        }
      }
    }
  }

  private async handleMessage(msg: WAMessage, senderName: string): Promise<void> {
    if (msg.type !== 'text' || !msg.text?.body) return;

    const text = msg.text.body.trim();
    const from = msg.from;

    this.log.info(`WhatsApp [${senderName}]: ${text.slice(0, 100)}`);

    // Handle commands
    if (text.startsWith('/')) {
      await this.handleCommand(from, text, senderName);
      return;
    }

    // Process through agent
    try {
      await this.markAsRead(msg.id);
      const response = await this.agent.processMessage(text, {
        channel: 'whatsapp',
        userId: from,
        username: senderName,
      });
      await this.sendMessage(from, response);
    } catch (err) {
      this.log.error(`WhatsApp agent error: ${err}`);
      await this.sendMessage(from, '⚠️ Something went wrong. Try again.');
    }
  }

  private async handleCommand(to: string, text: string, name: string): Promise<void> {
    const cmd = text.split(/\s+/)[0].toLowerCase();

    switch (cmd) {
      case '/start':
      case '/help':
        await this.sendMessage(to,
          `🔱 *Aura v0.6*\n\nHey ${name}! I'm your personal AI life manager.\n\n` +
          `Commands:\n` +
          `/status — System status\n` +
          `/spend — Today's spending\n` +
          `/summary — Monthly summary\n` +
          `/docs — Document vault\n` +
          `/subs — Subscriptions\n` +
          `/clear — Clear conversation\n\n` +
          `Or just send any message!`
        );
        break;

      case '/status': {
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        await this.sendMessage(to, `📊 *Aura Status*\n\n⏱ Uptime: ${h}h ${m}m\n💾 Memory: ${mem} MB`);
        break;
      }

      case '/clear':
        this.agent.clearHistory();
        await this.sendMessage(to, '🧹 Conversation cleared.');
        break;

      default:
        // Pass to agent as regular message
        const response = await this.agent.processMessage(text, { channel: 'whatsapp', userId: to });
        await this.sendMessage(to, response);
    }
  }

  // --- WhatsApp API ---

  async sendMessage(to: string, text: string): Promise<void> {
    // WhatsApp max message is 4096 chars
    const chunks = text.length > 4096 ? this.chunkText(text, 4096) : [text];

    for (const chunk of chunks) {
      await this.apiCall('messages', {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: chunk },
      });
    }
  }

  async sendTemplate(to: string, templateName: string, language = 'en'): Promise<void> {
    await this.apiCall('messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language } },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.apiCall('messages', {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch { /* ignore read receipt failures */ }
  }

  private async apiCall(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/${this.config.phoneNumberId}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp API error (${res.status}): ${err}`);
    }

    return await res.json();
  }

  private chunkText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let breakAt = remaining.lastIndexOf('\n', maxLen);
      if (breakAt < maxLen / 2) breakAt = maxLen;
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    }
    return chunks;
  }
}
