import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';

// IMAP types
interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  mailbox?: string;
  pollIntervalMs?: number;
}

interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface EmailConfig {
  provider: 'imap' | 'gmail';
  imap?: ImapConfig;
  gmail?: GmailConfig;
  categories: string[];
  autoClassify: boolean;
  extractBills: boolean;
  pollIntervalMs: number;
}

export interface ParsedEmail {
  id: string;
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  bodyPlain: string;
  date: string;
  labels: string[];
  isRead: boolean;
  hasAttachments: boolean;
  threadId?: string;
}

export type EmailCategory = 'bill' | 'action_required' | 'fyi' | 'newsletter' | 'personal' | 'work' | 'spam';

export interface ClassifiedEmail extends ParsedEmail {
  category: EmailCategory;
  confidence: number;
  extractedData?: BillData | ActionData;
}

export interface BillData {
  vendor: string;
  amount: number;
  currency: string;
  dueDate: string;
  accountId?: string;
  billType: string;
}

export interface ActionData {
  action: string;
  deadline?: string;
  priority: 'low' | 'medium' | 'high';
}

export class EmailPlugin implements AuraPlugin {
  name = 'email';
  version = '0.2.0';
  private ctx!: PluginContext;
  private config!: EmailConfig;
  private gmailAccessToken: string | null = null;
  private gmailTokenExpiry = 0;

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      provider: 'gmail',
      categories: ['bill', 'action_required', 'fyi', 'newsletter', 'personal', 'work'],
      autoClassify: true,
      extractBills: true,
      pollIntervalMs: 5 * 60 * 1000, // 5 minutes
      ...ctx.config as Record<string, unknown>,
    } as EmailConfig;

    ctx.logger.info('Email plugin loaded');
  }

  async onActivate(): Promise<void> {
    // Schedule periodic email check
    const cronInterval = Math.max(Math.floor(this.config.pollIntervalMs / 60000), 1);
    this.ctx.schedule(`*/${cronInterval} * * * *`, async () => {
      await this.checkNewEmails();
    });

    this.ctx.logger.info(`Email plugin activated — checking every ${cronInterval}m`);
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Email plugin deactivated');
  }

  // --- Gmail API ---

  private async getGmailToken(): Promise<string> {
    if (this.gmailAccessToken && Date.now() < this.gmailTokenExpiry) {
      return this.gmailAccessToken;
    }

    const gmail = this.config.gmail;
    if (!gmail) throw new Error('Gmail not configured');
    if (!gmail.clientId || !gmail.clientSecret || !gmail.refreshToken) {
      const missing = [
        !gmail.clientId && 'clientId',
        !gmail.clientSecret && 'clientSecret',
        !gmail.refreshToken && 'refreshToken',
      ].filter(Boolean).join(', ');
      throw new Error(`Gmail config missing: ${missing}`);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: gmail.clientId,
        client_secret: gmail.clientSecret,
        refresh_token: gmail.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) throw new Error(`Gmail OAuth failed (${response.status})`);

    const data = await response.json() as { access_token: string; expires_in: number };
    this.gmailAccessToken = data.access_token;
    this.gmailTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.gmailAccessToken;
  }

  async fetchRecentEmails(maxResults = 20, query = 'is:unread'): Promise<ParsedEmail[]> {
    const token = await this.getGmailToken();

    // List message IDs
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);

    const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };
    if (!listData.messages || listData.messages.length === 0) return [];

    // Fetch each message
    const emails: ParsedEmail[] = [];
    for (const msg of listData.messages) {
      try {
        const email = await this.fetchGmailMessage(token, msg.id);
        if (email) emails.push(email);
      } catch (err) {
        this.ctx.logger.error(`Failed to fetch message ${msg.id}: ${err}`);
      }
    }

    return emails;
  }

  private async fetchGmailMessage(token: string, messageId: string): Promise<ParsedEmail | null> {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) return null;

    const data = await res.json() as {
      id: string;
      threadId: string;
      labelIds: string[];
      payload: {
        headers: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{ mimeType: string; body?: { data?: string } }>;
      };
      internalDate: string;
    };

    const headers = data.payload.headers;
    const getHeader = (name: string): string =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('From');
    const fromMatch = from.match(/^(?:"?(.+?)"?\s)?<?([^>]+)>?$/);

    // Extract body
    let bodyPlain = '';
    if (data.payload.body?.data) {
      bodyPlain = Buffer.from(data.payload.body.data, 'base64url').toString('utf-8');
    } else if (data.payload.parts) {
      const textPart = data.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        bodyPlain = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      }
    }

    return {
      id: data.id,
      messageId: getHeader('Message-ID'),
      from: fromMatch?.[2] ?? from,
      fromName: fromMatch?.[1] ?? from.split('@')[0],
      to: getHeader('To'),
      subject: getHeader('Subject'),
      body: bodyPlain,
      bodyPlain,
      date: new Date(parseInt(data.internalDate)).toISOString(),
      labels: data.labelIds ?? [],
      isRead: !(data.labelIds ?? []).includes('UNREAD'),
      hasAttachments: (data.payload.parts?.length ?? 0) > 1,
      threadId: data.threadId,
    };
  }

  // --- Classification ---

  async classifyEmail(email: ParsedEmail): Promise<ClassifiedEmail> {
    const category = this.ruleBasedClassify(email);

    const classified: ClassifiedEmail = {
      ...email,
      category: category.category,
      confidence: category.confidence,
    };

    // Extract bill data if it's a bill
    if (classified.category === 'bill' && this.config.extractBills) {
      classified.extractedData = this.extractBillData(email);
    }

    // Extract action items
    if (classified.category === 'action_required') {
      classified.extractedData = this.extractActionData(email);
    }

    return classified;
  }

  private ruleBasedClassify(email: ParsedEmail): { category: EmailCategory; confidence: number } {
    const subject = email.subject.toLowerCase();
    const from = email.from.toLowerCase();
    const body = email.bodyPlain.toLowerCase().slice(0, 2000);
    const combined = `${subject} ${body}`;

    // Bill detection
    const billKeywords = ['invoice', 'bill', 'payment due', 'amount due', 'statement', 'electricity', 'water bill', 'gas bill', 'rent', 'emi', 'premium'];
    const billScore = billKeywords.filter(k => combined.includes(k)).length;
    if (billScore >= 2) return { category: 'bill', confidence: 0.9 };
    if (billScore >= 1 && /₹|rs\.?|inr|\$|usd/.test(combined)) return { category: 'bill', confidence: 0.8 };

    // Newsletter detection
    const newsletterKeywords = ['unsubscribe', 'view in browser', 'email preferences', 'opt out', 'mailing list'];
    if (newsletterKeywords.filter(k => combined.includes(k)).length >= 2) {
      return { category: 'newsletter', confidence: 0.85 };
    }

    // Action required
    const actionKeywords = ['action required', 'please review', 'approval needed', 'urgent', 'deadline', 'respond by', 'rsvp', 'confirm'];
    if (actionKeywords.some(k => combined.includes(k))) {
      return { category: 'action_required', confidence: 0.75 };
    }

    // Work emails (common domains)
    if (from.includes('jira') || from.includes('github') || from.includes('slack') || from.includes('confluence')) {
      return { category: 'work', confidence: 0.8 };
    }

    // Personal
    if (!from.includes('noreply') && !from.includes('no-reply') && !from.includes('notifications')) {
      return { category: 'personal', confidence: 0.5 };
    }

    return { category: 'fyi', confidence: 0.4 };
  }

  private extractBillData(email: ParsedEmail): BillData {
    const text = `${email.subject} ${email.bodyPlain}`;

    // Amount extraction (supports ₹, Rs, $, etc.)
    const amountMatch = text.match(/(?:₹|rs\.?\s*|inr\s*|usd\s*|\$)\s*([\d,]+(?:\.\d{2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    // Currency detection
    const currency = /₹|rs\.?|inr/i.test(text) ? 'INR' : /\$|usd/i.test(text) ? 'USD' : 'INR';

    // Due date extraction
    const dueDateMatch = text.match(/(?:due|by|before|on)\s+(\d{1,2}[\s/-]\w+[\s/-]\d{2,4}|\d{1,2}[\s/-]\d{1,2}[\s/-]\d{2,4})/i);
    const dueDate = dueDateMatch ? dueDateMatch[1] : '';

    // Vendor from sender
    const vendor = email.fromName || email.from.split('@')[0];

    // Bill type
    const subject = email.subject.toLowerCase();
    let billType = 'other';
    if (/electric/i.test(subject)) billType = 'electricity';
    else if (/water/i.test(subject)) billType = 'water';
    else if (/gas/i.test(subject)) billType = 'gas';
    else if (/internet|broadband|wifi/i.test(subject)) billType = 'internet';
    else if (/phone|mobile|airtel|jio|vi\b/i.test(subject)) billType = 'mobile';
    else if (/rent/i.test(subject)) billType = 'rent';
    else if (/insurance|premium/i.test(subject)) billType = 'insurance';
    else if (/emi|loan/i.test(subject)) billType = 'loan';
    else if (/credit card/i.test(subject)) billType = 'credit_card';
    else if (/subscription/i.test(subject)) billType = 'subscription';

    return { vendor, amount, currency, dueDate, billType };
  }

  private extractActionData(email: ParsedEmail): ActionData {
    const text = `${email.subject} ${email.bodyPlain}`.toLowerCase();

    // Priority
    let priority: 'low' | 'medium' | 'high' = 'medium';
    if (/urgent|asap|immediately|critical/i.test(text)) priority = 'high';
    else if (/when you get a chance|no rush|fyi/i.test(text)) priority = 'low';

    // Deadline
    const deadlineMatch = text.match(/(?:by|before|deadline|due)\s+(\d{1,2}[\s/-]\w+[\s/-]\d{2,4})/i);

    return {
      action: email.subject,
      deadline: deadlineMatch?.[1],
      priority,
    };
  }

  // --- Email Processing Pipeline ---

  async checkNewEmails(): Promise<void> {
    try {
      this.ctx.logger.info('Checking for new emails...');

      const lastCheck = this.ctx.storage.get<{ timestamp: string }>('email-state', 'lastCheck');
      const query = lastCheck
        ? `is:unread after:${lastCheck.timestamp.slice(0, 10).replace(/-/g, '/')}`
        : 'is:unread';

      const emails = await this.fetchRecentEmails(20, query);
      this.ctx.logger.info(`Found ${emails.length} new email(s)`);

      const classified: ClassifiedEmail[] = [];
      for (const email of emails) {
        const c = await this.classifyEmail(email);
        classified.push(c);

        // Store in DB
        this.ctx.storage.set('emails', email.id, c, {
          category: c.category,
          from: c.from,
          date: c.date,
        });
      }

      // Notify about important emails
      const bills = classified.filter(e => e.category === 'bill');
      const actions = classified.filter(e => e.category === 'action_required');

      if (bills.length > 0) {
        const billSummary = bills.map(b => {
          const data = b.extractedData as BillData | undefined;
          const amount = data?.amount ? ` — ${data.currency} ${data.amount}` : '';
          return `  💰 ${b.fromName}: ${b.subject}${amount}`;
        }).join('\n');
        await this.ctx.notify(`📧 *New Bills*\n${billSummary}`, { urgency: 'high' });
      }

      if (actions.length > 0) {
        const actionSummary = actions.map(a => `  ⚡ ${a.fromName}: ${a.subject}`).join('\n');
        await this.ctx.notify(`📧 *Action Required*\n${actionSummary}`, { urgency: 'high' });
      }

      // Update last check timestamp
      this.ctx.storage.set('email-state', 'lastCheck', { timestamp: new Date().toISOString() });

      // Emit events
      this.ctx.emit('checked', { total: emails.length, bills: bills.length, actions: actions.length });

    } catch (err) {
      this.ctx.logger.error(`Email check failed: ${err}`);
    }
  }

  // --- Summary Generation ---

  generateSummary(emails: ClassifiedEmail[]): string {
    const byCategory = new Map<EmailCategory, ClassifiedEmail[]>();
    for (const email of emails) {
      const list = byCategory.get(email.category) ?? [];
      list.push(email);
      byCategory.set(email.category, list);
    }

    const sections: string[] = ['📧 *Email Summary*\n'];

    const categoryEmoji: Record<EmailCategory, string> = {
      bill: '💰', action_required: '⚡', personal: '👤',
      work: '💼', newsletter: '📰', fyi: 'ℹ️', spam: '🗑️',
    };

    for (const [category, list] of byCategory) {
      const emoji = categoryEmoji[category] ?? '📧';
      sections.push(`${emoji} *${category.replace('_', ' ')}* (${list.length})`);
      for (const email of list.slice(0, 5)) {
        sections.push(`  • ${email.fromName}: ${email.subject}`);
      }
      if (list.length > 5) {
        sections.push(`  _...and ${list.length - 5} more_`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }
}
