import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';
import type { AlertRegistry } from '../core/alerts.js';

// ─── IMAP / Gmail Config ────────────────────────────────────────────────────

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  mailbox?: string;
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// ─── Multi-Account Types ─────────────────────────────────────────────────────

export type AccountPurpose = 'work' | 'personal' | 'banking' | 'newsletters' | 'custom';

export interface EmailAccount {
  id: string;             // unique slug: "work", "personal", "banking"
  label: string;          // human display name: "Work Email", "Banking Alerts"
  purpose: AccountPurpose;
  provider: 'imap' | 'gmail';
  gmail?: GmailConfig;
  imap?: ImapConfig;
  pollIntervalMs?: number;
  enabled: boolean;
}

// ─── Legacy single-account config shape (for backward compat) ───────────────

interface LegacyEmailConfig {
  provider?: 'imap' | 'gmail';
  imap?: ImapConfig;
  gmail?: GmailConfig;
  pollIntervalMs?: number;
  categories?: string[];
  autoClassify?: boolean;
  extractBills?: boolean;
}

export interface EmailConfig {
  accounts: EmailAccount[];
  categories: string[];
  autoClassify: boolean;
  extractBills: boolean;
  /** Default poll interval (ms) used when an account doesn't specify its own */
  pollIntervalMs: number;
}

// ─── Email Data Types ────────────────────────────────────────────────────────

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
  /** Which account this email came from */
  accountId: string;
  /** Display label for the source account */
  accountLabel: string;
}

export type EmailCategory =
  | 'bill'
  | 'finance'
  | 'action_required'
  | 'fyi'
  | 'newsletter'
  | 'personal'
  | 'work'
  | 'spam';

export interface ClassifiedEmail extends ParsedEmail {
  category: EmailCategory;
  confidence: number;
  extractedData?: BillData | ActionData | Record<string, unknown>;
}

export interface BillData {
  vendor: string;
  amount: number;
  minimumDue?: number;
  currency: string;
  dueDate: string;
  cardLast4?: string;
  accountId?: string;
  billType: string;
}

export interface ActionData {
  action: string;
  deadline?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface AccountSummary {
  accountId: string;
  accountLabel: string;
  purpose: AccountPurpose;
  provider: 'imap' | 'gmail';
  unread: number;
  bills: number;
  actions: number;
  lastChecked: string | null;
}

// ─── Per-account token cache ─────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiry: number;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export class EmailPlugin implements AuraPlugin {
  name = 'email';
  version = '0.3.0';

  private ctx!: PluginContext;
  private config!: EmailConfig;
  private alertRegistry: AlertRegistry | null = null;

  /** Token cache keyed by accountId */
  private tokenCache = new Map<string, TokenCache>();

  /** Schedule handles keyed by accountId */
  private scheduleHandles = new Map<string, string>();

  setAlertRegistry(registry: AlertRegistry): void {
    this.alertRegistry = registry;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    const raw = ctx.config as Record<string, unknown>;
    this.config = this.normalizeConfig(raw);
    ctx.logger.info(`Email plugin loaded — ${this.config.accounts.length} account(s) configured`);
  }

  async onActivate(): Promise<void> {
    for (const account of this.config.accounts) {
      if (!account.enabled) continue;

      const intervalMs = account.pollIntervalMs ?? this.config.pollIntervalMs;
      const cronInterval = Math.max(Math.floor(intervalMs / 60_000), 1);

      const handle = this.ctx.schedule(`*/${cronInterval} * * * *`, async () => {
        await this.checkAccountEmails(account);
      });

      this.scheduleHandles.set(account.id, handle);
      this.ctx.logger.info(
        `Email account "${account.label}" (${account.id}) polling every ${cronInterval}m`
      );

      // Immediate fetch on startup (non-blocking)
      setImmediate(() => {
        this.checkAccountEmails(account).catch(err =>
          this.ctx.logger.error(`Startup email fetch failed for "${account.id}": ${err.message}`)
        );
      });
    }
  }

  async onDeactivate(): Promise<void> {
    this.scheduleHandles.clear();
    this.ctx.logger.info('Email plugin deactivated');
  }

  // ─── Config Normalization (backward compat) ─────────────────────────────────

  private normalizeConfig(raw: Record<string, unknown>): EmailConfig {
    const defaults: EmailConfig = {
      accounts: [],
      categories: ['bill', 'action_required', 'fyi', 'newsletter', 'personal', 'work'],
      autoClassify: true,
      extractBills: true,
      pollIntervalMs: 5 * 60 * 1000,
    };

    // New format: has accounts array
    if (Array.isArray(raw['accounts']) && raw['accounts'].length > 0) {
      return {
        ...defaults,
        ...(raw as unknown as Partial<EmailConfig>),
        accounts: raw['accounts'] as EmailAccount[],
      };
    }

    // Legacy format: has provider/gmail/imap at top level → auto-wrap
    const legacy = raw as LegacyEmailConfig;
    if (legacy.provider) {
      const account: EmailAccount = {
        id: 'default',
        label: 'Default Email',
        purpose: 'custom',
        provider: legacy.provider,
        gmail: legacy.gmail,
        imap: legacy.imap,
        pollIntervalMs: legacy.pollIntervalMs,
        enabled: true,
      };

      this.ctx?.logger.info('Legacy email config detected — wrapped into single "default" account');

      return {
        ...defaults,
        categories: legacy.categories ?? defaults.categories,
        autoClassify: legacy.autoClassify ?? defaults.autoClassify,
        extractBills: legacy.extractBills ?? defaults.extractBills,
        pollIntervalMs: legacy.pollIntervalMs ?? defaults.pollIntervalMs,
        accounts: [account],
      };
    }

    return defaults;
  }

  // ─── Gmail OAuth — Per-account ──────────────────────────────────────────────

  async getGmailAccessToken(accountId: string): Promise<string> {
    const cached = this.tokenCache.get(accountId);
    if (cached && Date.now() < cached.expiry) return cached.accessToken;

    const account = this.getAccountById(accountId);
    if (!account) throw new Error(`Unknown account id: ${accountId}`);
    if (account.provider !== 'gmail') throw new Error(`Account "${accountId}" is not Gmail`);

    const gmail = account.gmail;
    if (!gmail) throw new Error(`Gmail config missing for account "${accountId}"`);
    if (!gmail.clientId || !gmail.clientSecret || !gmail.refreshToken) {
      const missing = [
        !gmail.clientId && 'clientId',
        !gmail.clientSecret && 'clientSecret',
        !gmail.refreshToken && 'refreshToken',
      ]
        .filter(Boolean)
        .join(', ');
      throw new Error(`Gmail config missing fields for account "${accountId}": ${missing}`);
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

    if (!response.ok)
      throw new Error(`Gmail OAuth failed for account "${accountId}" (${response.status})`);

    const data = (await response.json()) as { access_token: string; expires_in: number };
    const token: TokenCache = {
      accessToken: data.access_token,
      expiry: Date.now() + (data.expires_in - 60) * 1000,
    };
    this.tokenCache.set(accountId, token);
    return token.accessToken;
  }

  // ─── Fetch Emails ──────────────────────────────────────────────────────────

  /**
   * Fetch emails for a specific Gmail account.
   * Pass maxResults and a Gmail query string (e.g. 'is:unread').
   */
  async fetchGmailEmails(
    accountId: string,
    maxResults = 20,
    query = 'newer_than:7d'
  ): Promise<ParsedEmail[]> {
    const account = this.getAccountById(accountId);
    if (!account) throw new Error(`Unknown account: ${accountId}`);

    const token = await this.getGmailAccessToken(accountId);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok)
      throw new Error(`Gmail list failed for account "${accountId}" (${listRes.status})`);

    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
    };
    if (!listData.messages || listData.messages.length === 0) return [];

    const emails: ParsedEmail[] = [];
    for (const msg of listData.messages) {
      try {
        const email = await this.fetchGmailMessage(token, msg.id, account);
        if (email) emails.push(email);
      } catch (err) {
        this.ctx.logger.error(`Failed to fetch message ${msg.id} for "${accountId}": ${err}`);
      }
    }

    return emails;
  }

  /** Backward-compat alias — fetches from first available Gmail account */
  async fetchRecentEmails(maxResults = 20, query = 'newer_than:7d'): Promise<ParsedEmail[]> {
    const gmailAccount = this.config.accounts.find(
      a => a.provider === 'gmail' && a.enabled
    );
    if (!gmailAccount) throw new Error('No enabled Gmail account configured');
    return this.fetchGmailEmails(gmailAccount.id, maxResults, query);
  }

  private async fetchGmailMessage(
    token: string,
    messageId: string,
    account: EmailAccount
  ): Promise<ParsedEmail | null> {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      id: string;
      threadId: string;
      labelIds: string[];
      payload: {
        headers: Array<{ name: string; value: string }>;
        mimeType?: string;
        body?: { data?: string };
        parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: unknown[] }>;
      };
      internalDate: string;
    };

    const headers = data.payload.headers;
    const getHeader = (name: string): string =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('From');
    const fromMatch = from.match(/^(?:"?(.+?)"?\s)?<?([^>]+)>?$/);

    let bodyPlain = '';

    // Helper: decode base64url to utf-8 string
    const decode64 = (data: string) => Buffer.from(data, 'base64url').toString('utf-8');

    // Helper: strip HTML tags to plain text (preserves meaningful content)
    const htmlToText = (html: string) =>
      html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        // Decode HTML entities BEFORE stripping tags (so &amp;INR; etc work)
        .replace(/&#8377;/g, '₹')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
        // Add spaces around block elements to preserve word boundaries
        .replace(/<\/?(td|th|tr|li|dt|dd)[^>]*>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?(p|div|h[1-6]|table|ul|ol)[^>]*>/gi, ' ')
        // Strip remaining tags
        .replace(/<[^>]+>/g, '')
        // Collapse whitespace
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/(\s*\n\s*){3,}/g, '\n\n')
        .trim();

    // Helper: recursively find parts by mimeType (handles nested multipart)
    const findPart = (
      parts: Array<{ mimeType: string; body?: { data?: string }; parts?: unknown[] }>,
      mime: string
    ): string | null => {
      for (const part of parts) {
        if (part.mimeType === mime && part.body?.data) return decode64(part.body.data);
        if (part.parts) {
          const found = findPart(
            part.parts as Array<{ mimeType: string; body?: { data?: string }; parts?: unknown[] }>,
            mime
          );
          if (found) return found;
        }
      }
      return null;
    };

    if (data.payload.body?.data) {
      const raw = decode64(data.payload.body.data);
      bodyPlain = data.payload.mimeType === 'text/html' ? htmlToText(raw) : raw;
    } else if (data.payload.parts) {
      // Try text/plain first, fall back to text/html
      const plainText = findPart(data.payload.parts, 'text/plain');
      if (plainText && plainText.trim().length > 10) {
        bodyPlain = plainText;
      } else {
        const htmlText = findPart(data.payload.parts, 'text/html');
        if (htmlText) bodyPlain = htmlToText(htmlText);
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
      hasAttachments: this.detectAttachments(data.payload),
      threadId: data.threadId,
      accountId: account.id,
      accountLabel: account.label,
    };
  }

  private detectAttachments(payload: {
    parts?: Array<{
      filename?: string;
      mimeType?: string;
      headers?: Array<{ name: string; value: string }>;
      parts?: unknown[];
    }>;
  }): boolean {
    if (!payload.parts) return false;
    for (const part of payload.parts) {
      if (part.filename && part.filename.length > 0) return true;
      if (part.headers) {
        const disposition = part.headers.find(
          h => h.name.toLowerCase() === 'content-disposition'
        );
        if (disposition && disposition.value.toLowerCase().includes('attachment')) return true;
      }
      if (part.parts && this.detectAttachments(part as typeof payload)) return true;
    }
    return false;
  }

  // ─── Classification ─────────────────────────────────────────────────────────

  private async aiClassifyEmail(email: ParsedEmail): Promise<{ category: EmailCategory; confidence: number; extractedData?: Record<string, unknown> } | null> {
    try {
      const baseUrl = process.env['AI_BASE_URL'] || 'https://integrate.api.nvidia.com/v1';
      const apiKey = process.env['AI_API_KEY'] || '';
      const model = process.env['AI_MODEL'] || 'qwen/qwen3.5-397b-a17b';

      if (!apiKey) return null;

      const snippet = email.bodyPlain.slice(0, 500).replace(/\s+/g, ' ').trim();
      const prompt = `Classify this email and extract financial data if present.

From: ${email.fromName || email.from} <${email.from}>
Subject: ${email.subject}
Snippet: ${snippet}

Reply with ONLY valid JSON in this exact format:
{
  "category": "<one of: bill, finance, action_required, newsletter, work, personal, fyi>",
  "confidence": <0.0-1.0>,
  "amount": <number or null>,
  "currency": "<INR|USD|EUR or null>",
  "txType": "<debit|credit or null>",
  "txCategory": "<investment|food|transport|shopping|subscription|insurance|emi|grocery|fuel|bills|recharge|other or null>",
  "merchant": "<merchant name or null>"
}

Rules:
- finance: purchases, payments, UPI, bank transactions, investments, gold, refunds, cashback
- bill: upcoming bills/dues with due date
- action_required: needs your response/action urgently
- newsletter: promotional, marketing, bulk email
- work: work-related (Jira, GitHub, Slack, etc.)
- personal: personal message from a person
- fyi: everything else`;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;

      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim() ?? '';

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        category: string;
        confidence: number;
        amount?: number | null;
        currency?: string | null;
        txType?: string | null;
        txCategory?: string | null;
        merchant?: string | null;
      };

      const validCategories: EmailCategory[] = ['bill', 'finance', 'action_required', 'newsletter', 'work', 'personal', 'fyi'];
      if (!validCategories.includes(parsed.category as EmailCategory)) return null;

      const result: { category: EmailCategory; confidence: number; extractedData?: Record<string, unknown> } = {
        category: parsed.category as EmailCategory,
        confidence: parsed.confidence ?? 0.7,
      };

      if (parsed.category === 'finance' && parsed.amount) {
        result.extractedData = {
          amount: parsed.amount,
          currency: parsed.currency || 'INR',
          type: parsed.txType || 'debit',
          category: parsed.txCategory || 'other',
          merchant: parsed.merchant || email.fromName || email.from.split('@')[0],
        };
      }

      return result;
    } catch (err) {
      this.ctx.logger.warn(`AI email classification failed, falling back to rules: ${err}`);
      return null;
    }
  }

  async classifyEmail(email: ParsedEmail, useAI = false): Promise<ClassifiedEmail> {
    // Use rule-based by default for bulk fetches (fast + no API calls)
    // AI is opt-in via useAI=true (used for single email queries/chat)
    let category: EmailCategory;
    let confidence: number;
    let aiExtractedData: Record<string, unknown> | undefined;

    if (useAI) {
      const aiResult = await this.aiClassifyEmail(email);
      if (aiResult) {
        category = aiResult.category;
        confidence = aiResult.confidence;
        aiExtractedData = aiResult.extractedData;
        this.ctx.logger.debug(`[AI] ${email.subject} → ${category} (${confidence})`);
      } else {
        const ruleResult = this.ruleBasedClassify(email);
        category = ruleResult.category;
        confidence = ruleResult.confidence;
      }
    } else {
      // Rule-based only — instant, no API call
      const ruleResult = this.ruleBasedClassify(email);
      category = ruleResult.category;
      confidence = ruleResult.confidence;
      this.ctx.logger.debug(`[Rules] ${email.subject} → ${category} (${confidence})`);
    }

    const classified: ClassifiedEmail = {
      ...email,
      category,
      confidence,
    };

    // Extract data for bills
    if (classified.category === 'bill' && this.config.extractBills) {
      classified.extractedData = this.extractBillData(email);
    }

    // Extract finance data (prefer AI-extracted, fallback to rule extraction)
    if (classified.category === 'finance') {
      classified.extractedData = aiExtractedData || this.extractFinanceData(email);
    }

    if (classified.category === 'action_required') {
      classified.extractedData = this.extractActionData(email);
    }

    // Auto-create finance transaction
    // Only emit for actual transactions — skip promotional/marketing finance emails
    const isActualTransaction = classified.category === 'finance' &&
      classified.extractedData &&
      // Must have a transaction signal in subject or body
      /transaction|debited|credited|payment|receipt|invoice|order confirmed|order shipped|upi txn|spent|purchased|refund/i
        .test(`${email.subject} ${email.bodyPlain.slice(0, 500)}`);

    if (isActualTransaction) {
      const data = classified.extractedData as Record<string, unknown>;
      const amount = (data.amount as number) || 0;

      // Parse payment method from email body
      const bodyLower = email.bodyPlain.toLowerCase().slice(0, 1000);
      let paymentMethod = '';
      let merchantDetail = '';
      if (bodyLower.includes('credit card')) {
        paymentMethod = 'Credit Card';
        const cardMatch = email.bodyPlain.match(/(?:Credit Card|card)\s+ending\s+(?:with\s+)?(\d{4})/i);
        const bankMatch = email.bodyPlain.match(/(YES BANK|HDFC|SBI|ICICI|AXIS|KOTAK|IDFC|FEDERAL|AMEX|CITI)/i);
        if (bankMatch && cardMatch) merchantDetail = `${bankMatch[1]} CC *${cardMatch[1]}`;
      } else if (bodyLower.includes('debit card')) {
        paymentMethod = 'Debit Card';
        const cardMatch = email.bodyPlain.match(/(?:Debit Card|card)\s+ending\s+(?:with\s+)?(\d{4})/i);
        if (cardMatch) merchantDetail = `Debit *${cardMatch[1]}`;
      } else if (/\bupi\b|upi_|upi\//i.test(bodyLower)) {
        paymentMethod = 'UPI';
        const upiMatch = email.bodyPlain.match(/(?:UPI[_\/\s-])(\w+)/i);
        if (upiMatch) merchantDetail = upiMatch[1];
      } else if (/\bneft\b|\brtgs\b|\bimps\b/i.test(bodyLower)) {
        paymentMethod = 'NEFT/IMPS';
      }

      // Extract actual merchant from body (e.g. "at UPI_SWIGGY LTD on")
      let parsedMerchant = data.merchant || email.fromName || 'Unknown';
      const atMatch = email.bodyPlain.match(/at\s+(UPI_)?([A-Za-z0-9\s&'.]+?)\s+on\s+\d/i);
      if (atMatch) parsedMerchant = atMatch[2].trim();

      this.ctx.emit('finance:transaction', {
        amount,
        currency: data.currency || 'INR',
        type: data.type || 'debit',
        category: data.category || 'other',
        description: email.subject,
        merchant: parsedMerchant,
        paymentMethod,
        merchantDetail,
        source: 'email',
        date: email.date,
        reference: email.messageId,
        tags: [
          'auto-detected',
          `account:${email.accountId}`,
          ...(amount === 0 ? ['amount-unknown'] : []),
          ...(paymentMethod ? [`method:${paymentMethod.toLowerCase().replace(/\s+/g, '-')}`] : []),
        ],
      });
    }

    return classified;
  }

  private ruleBasedClassify(email: ParsedEmail): { category: EmailCategory; confidence: number } {
    const subject = email.subject.toLowerCase();
    const from = email.from.toLowerCase();
    const body = email.bodyPlain.toLowerCase().slice(0, 2000);
    const combined = `${subject} ${body}`;

    // ── Credit Card Bill Detection (high priority) ──────────────────────────
    // These are the most important bills — credit card statements with due dates
    const isCreditCardBill =
      /(?:credit card|cc)\s+(?:bill|statement|due|payment)/i.test(combined) ||
      /(?:bill|statement).*(?:generated|arrived|ready)/i.test(combined) ||
      /(?:total\s+(?:amount\s+)?due|minimum\s+(?:amount\s+)?due)/i.test(combined) ||
      /(?:new\s+statement|monthly\s+statement)/i.test(combined);

    const isCreditCardSender = /cred\.club|billdesk|sbicard|icicibank|hdfcbank|axisbank|kotakbank|yesbank|amex|americanexpress/i.test(from);

    if (isCreditCardBill || (isCreditCardSender && combined.includes('statement'))) {
      return { category: 'bill', confidence: 0.95 };
    }

    // ── General Bill Detection ────────────────────────────────────────────────
    const billKeywords = [
      'invoice', 'payment due', 'amount due', 'due date', 'overdue',
      'electricity', 'water bill', 'gas bill', 'rent due', 'emi due',
      'premium due', 'your bill', 'pay now', 'minimum due',
    ];
    const hasAmount = /(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)[\d,]+/.test(combined);
    const hasDueDate = /due\s+date|pay\s+by\s+\d|before\s+\d{1,2}\s+[a-z]/i.test(combined);
    const billScore = billKeywords.filter(k => combined.includes(k)).length;

    const nonBillSenders = [
      'linkedin', 'myntra', 'swiggy', 'zomato',
      'youtube', 'twitter', 'facebook', 'instagram', 'quora', 'medium', 'substack',
    ];
    const isNonBillSender = nonBillSenders.some(s => from.includes(s));

    if (!isNonBillSender && billScore >= 2) {
      return { category: 'bill', confidence: 0.9 };
    }
    if (!isNonBillSender && billScore >= 1 && (hasAmount || hasDueDate)) {
      return { category: 'bill', confidence: 0.8 };
    }

    // Finance / transaction detection
    // Strategy: signal-based, NOT sender-based. Any email with financial signals = finance.
    // Sender list only boosts confidence, never gates classification.

    const financeKeywords = [
      // Transaction signals
      'transaction', 'debited', 'credited', 'transferred',
      'upi', 'neft', 'imps', 'rtgs', 'payment received', 'payment successful',
      'payment confirmation', 'payment link', 'auto-debit', 'auto debit', 'mandate',
      // Purchase / order
      'purchase', 'purchased', 'bought', 'order confirmed', 'order placed',
      'order shipped', 'order delivered', 'your order',
      // Financial products
      'mutual fund', 'investment', 'sip', 'redeemed', 'gold purchase', 'digital gold',
      'emi', 'loan', 'wallet', 'recharged', 'top-up', 'topup',
      // Returns / rewards
      'refund', 'cashback', 'reward', 'coins converted',
      // Documents
      'invoice', 'receipt', 'statement', 'premium receipt',
      // Subscriptions
      'subscription renewed', 'renewal',
    ];

    // Strong subject signals — finance even with empty/short body
    const financeSubjectSignals = [
      'transaction alert', 'transaction', 'debited', 'credited',
      'payment', 'invoice', 'receipt', 'statement', 'order confirmed',
      'order shipped', 'order delivered', 'coins converted', 'gold purchase',
      'premium receipt', 'your order', 'refund', 'cashback', 'alert',
    ];

    // Known finance senders → confidence boost only
    const knownFinanceSenders = [
      'bank', 'pay', 'credit', 'debit', 'money', 'wallet', 'finance',
      'invest', 'fund', 'trade', 'stock', 'insurance', 'loan', 'card',
    ];

    const financeScore = financeKeywords.filter(k => combined.includes(k)).length;
    const isFinanceSubject = financeSubjectSignals.some(k => subject.includes(k));
    const isKnownFinanceSender = knownFinanceSenders.some(s => from.includes(s));
    const bodyIsEmpty = email.bodyPlain.trim().length < 10;

    // Classify as finance if ANY of these:
    // 1. Strong body signals (2+ keywords)
    // 2. Has amount + any finance keyword
    // 3. Finance subject signal (transaction alert, receipt, etc.)
    // 4. Empty body but finance subject signal (HTML emails we can't parse yet)
    if (
      financeScore >= 2 ||
      (hasAmount && financeScore >= 1) ||
      isFinanceSubject ||
      (bodyIsEmpty && isFinanceSubject)
    ) {
      const confidence = isKnownFinanceSender ? 0.92 : financeScore >= 2 ? 0.85 : 0.8;
      return { category: 'finance' as EmailCategory, confidence };
    }

    // Newsletter / promo detection
    const newsletterKeywords = [
      'unsubscribe', 'view in browser', 'email preferences', 'opt out',
      'mailing list', 'manage preferences', 'update preferences',
    ];
    const promoKeywords = [
      'off', 'sale', 'deal', 'offer', 'discount', 'coupon', 'shop now',
      'buy now', 'limited time', 'exclusive', 'new arrival', 'check out',
    ];
    const promoSenders = [
      'myntra', 'flipkart', 'amazon', 'swiggy', 'zomato', 'ajio',
      'nykaa', 'meesho', 'linkedin', 'quora',
    ];

    if (newsletterKeywords.filter(k => combined.includes(k)).length >= 2) {
      return { category: 'newsletter', confidence: 0.85 };
    }
    if (
      promoSenders.some(s => from.includes(s)) &&
      (newsletterKeywords.some(k => combined.includes(k)) ||
        promoKeywords.some(k => combined.includes(k)))
    ) {
      return { category: 'newsletter', confidence: 0.8 };
    }

    // Account purpose hints
    const accountPurpose = this.getAccountById(email.accountId)?.purpose;
    if (accountPurpose === 'work') {
      return { category: 'work', confidence: 0.7 };
    }
    if (accountPurpose === 'newsletters') {
      return { category: 'newsletter', confidence: 0.7 };
    }

    // Action required
    const actionKeywords = [
      'action required', 'please review', 'approval needed', 'urgent',
      'deadline', 'respond by', 'rsvp', 'confirm',
    ];
    if (actionKeywords.some(k => combined.includes(k))) {
      return { category: 'action_required', confidence: 0.75 };
    }

    // Work tools
    if (
      from.includes('jira') ||
      from.includes('github') ||
      from.includes('slack') ||
      from.includes('confluence')
    ) {
      return { category: 'work', confidence: 0.8 };
    }

    // Personal
    if (!from.includes('noreply') && !from.includes('no-reply') && !from.includes('notifications')) {
      return { category: 'personal', confidence: 0.5 };
    }

    return { category: 'fyi', confidence: 0.4 };
  }

  private extractBillData(email: ParsedEmail): BillData {
    // Normalize whitespace — critical for emails like CRED that have excessive spacing
    const raw = `${email.subject} ${email.bodyPlain}`;
    const text = raw.replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();

    const parseAmount = (raw: string): number => {
      const clean = raw.replace(/,/g, '');
      return parseFloat(clean);
    };

    // Credit card bill: "total amount due ₹1,133.00" or "total due: ₹5,000"
    let amount = 0;
    const totalDueMatch = text.match(
      /(?:total\s+(?:amount\s+)?due|amount\s+due|total\s+outstanding|outstanding\s+amount)[^₹$€\d]{0,30}(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)([\d,]+(?:\.\d{1,2})?)/i
    );
    if (totalDueMatch) {
      amount = parseAmount(totalDueMatch[1]);
    } else {
      // Fallback: first currency amount
      const amountMatch = text.match(/(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)([\d,]+(?:\.\d{1,2})?)/i);
      if (amountMatch) amount = parseAmount(amountMatch[1]);
    }

    // Minimum due: "minimum amount due ₹100"
    let minimumDue: number | undefined;
    const minMatch = text.match(
      /(?:minimum\s+(?:amount\s+)?due|min\s+due)[^₹$€\d]{0,30}(?:₹\s*|rs\.?\s*|inr\s*|\$\s*)([\d,]+(?:\.\d{1,2})?)/i
    );
    if (minMatch) minimumDue = parseAmount(minMatch[1]);

    const currency = /₹|rs\.?|inr/i.test(text) ? 'INR'
      : /€|eur/i.test(text) ? 'EUR'
      : /\$|usd/i.test(text) ? 'USD' : 'INR';

    // Due date: "due date April 15, 2026" or "pay by 15 April" or "due: 15/04/2026"
    let dueDate = '';
    const dueDatePatterns = [
      /(?:due\s+date|payment\s+due)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:due\s+date|payment\s+due)[:\s]+(\d{1,2}[\s/-][A-Za-z]+[\s/-]\d{2,4})/i,
      /(?:due\s+date|payment\s+due)[:\s]+(\d{1,2}[\s/-]\d{1,2}[\s/-]\d{2,4})/i,
      /(?:pay\s+by|before|due\s+on)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      /(?:pay\s+by|before|due\s+on)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      // CRED-style: "due date ₹1,133 ₹100 April 15, 2026" — date after amounts
      /(?:due\s+date).*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i,
      // Indian format: "15 April 2026" or "15-04-2026"
      /\b(\d{1,2}[\s/-](?:January|February|March|April|May|June|July|August|September|October|November|December)[\s/-]\d{4})\b/i,
      /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
    ];
    for (const pattern of dueDatePatterns) {
      const m = text.match(pattern);
      if (m) { dueDate = m[1].trim(); break; }
    }

    // Card last 4: "card XXXX-3005" or "card ending 0224"
    let cardLast4: string | undefined;
    const cardMatch = text.match(/(?:card|cc)\s+(?:ending|no\.?|number)?\s*(?:x+[-\s]?)?(\d{4})\b/i)
      || text.match(/XXXX-XXXX-XXXX-(\d{4})/i)
      || text.match(/xx+(\d{4})/i);
    if (cardMatch) cardLast4 = cardMatch[1];

    const vendor = email.fromName || email.from.split('@')[0];

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

    return { vendor, amount, minimumDue, currency, dueDate, cardLast4, accountId: email.accountId, billType };
  }

  private extractFinanceData(email: ParsedEmail): Record<string, unknown> {
    const text = `${email.subject} ${email.bodyPlain}`;
    const lower = text.toLowerCase();

    // ─── Amount Extraction ───────────────────────────────────────────────────
    // Handles: ₹510.00, INR 510.00, Rs. 1,234.56, $10.00
    // Also: "debited by INR 510.00", "debited for Rs.1234"
    // Excludes balance lines like "new balance INR 23,500CR" (use first debit amount)
    let amount = 0;
    const amountPatterns = [
      // "debited by INR 510.00" or "debited for Rs.1,234" or "spent INR 4750"
      /(?:debited|paid|charged|spent|purchase(?:d)?|transaction of|amount of|transferred)\s+(?:by\s+|for\s+|of\s+)?(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)([\d,]+(?:\.\d{1,2})?)/i,
      // "has been spent on ... ₹1,234.56" or "INR 510.00 has been debited"
      /(?:₹\s*|inr\s*|rs\.?\s*)([\d,]+(?:\.\d{1,2})?)(?:\s*(?:has been|is)\s+(?:debited|credited|spent|charged))/i,
      // Selling price (not MRP): "Selling Price ... ₹29,372" — take LAST price before quantity/total
      /(?:selling price[^₹$€\d]*|total[^₹$€\d]*)(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)([\d,]+(?:\.\d{1,2})?)/i,
      // Generic currency amount (avoid balance lines)
      /(?:₹\s*|rs\.?\s*|inr\s*|\$\s*|€\s*)([\d,]+(?:\.\d{1,2})?)(?!\s*(?:cr\b|lakh|crore|available|balance|limit|mrp|max|off))/i,
    ];

    for (const pattern of amountPatterns) {
      const m = text.match(pattern);
      if (m) {
        const parsed = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0 && parsed < 10_000_000) {
          amount = parsed;
          break;
        }
      }
    }

    // ─── Transaction Type ────────────────────────────────────────────────────
    // Be precise: "debited" = debit, "credited" = credit
    // Avoid false positives: "credit card" doesn't mean credit transaction
    const debitSignals = ['debited', 'debit', 'payment made', 'paid', 'purchase', 'spent', 'charged', 'withdrawn'];
    const creditSignals = ['credited', 'refund', 'cashback received', 'received in', 'deposited', 'added to'];
    const isDebit = debitSignals.some(k => lower.includes(k));
    const isCredit = creditSignals.some(k => lower.includes(k));
    // Default to debit if ambiguous (most transaction alerts are debits)
    const type = (!isDebit && isCredit) ? 'credit' : 'debit';

    // ─── Category ────────────────────────────────────────────────────────────
    let category = 'other';
    // Order matters: most specific first
    if (/gold|digital gold|sovereign gold bond/i.test(lower)) category = 'investment';
    else if (/mutual fund|sip\b|nav\b|smallcase|stocks?|equity|nifty|sensex/i.test(lower)) category = 'investment';
    else if (/fuel|petrol|diesel|bpcl|iocl|hpcl|hp gas|bharat petroleum|indian oil/i.test(lower)) category = 'fuel';
    else if (/grocery|bigbasket|blinkit|zepto|instamart|dmart|grofers/i.test(lower)) category = 'grocery';
    else if (/swiggy|zomato|restaurant|food order|dominos|pizza|burger/i.test(lower)) category = 'food';
    else if (/uber|ola\b|rapido|cab|taxi|ride|metro|bus|train|irctc|flight|skyscanner/i.test(lower)) category = 'transport';
    else if (/\binsurance\b|\bpremium receipt\b|\binsurance policy\b|\blife policy\b|tata aia|\blic\b|hdfc life|sbi life|max life|bajaj allianz/i.test(lower)) category = 'insurance';
    else if (/emi\b|loan\b|emi converted|flexipay/i.test(lower)) category = 'emi';
    else if (/recharge|top.?up|prepaid|airtel|jio\b|vi\b|bsnl/i.test(lower)) category = 'recharge';
    else if (/netflix|spotify|prime video|hotstar|zee5|subscription/i.test(lower)) category = 'subscription';
    else if (/electricity|water bill|gas bill|utility|bbmp|bescom/i.test(lower)) category = 'bills';
    else if (/amazon|flipkart|myntra|nykaa|meesho|ajio|wakefit|bed|mattress|furniture|electronics/i.test(lower)) category = 'shopping';
    // UPI/transfer — catch bank transaction alerts without specific merchant
    else if (/upi|neft|imps|rtgs|transfer|transaction alert|upi txn/i.test(lower)) category = 'transfer';
    else if (amount > 0) category = 'shopping';

    // ─── Merchant Extraction ─────────────────────────────────────────────────
    // Try to extract merchant from body (e.g. "payment to Swiggy", "purchase at Amazon")
    const merchantBodyMatch = text.match(/(?:at|to|from|merchant[:\s]+|info[:\s]+)([A-Z][A-Za-z\s&.'-]{2,30}?)(?:\s*[,.\n]|$)/);
    const merchant = merchantBodyMatch?.[1]?.trim() ||
      email.fromName ||
      email.from.split('@')[0].replace(/[._-]/g, ' ');

    const currency = /\$|usd/i.test(text) ? 'USD' : /€|eur/i.test(text) ? 'EUR' : 'INR';

    return { amount, type, category, merchant, currency };
  }

  private extractActionData(email: ParsedEmail): ActionData {
    const text = `${email.subject} ${email.bodyPlain}`.toLowerCase();

    let priority: 'low' | 'medium' | 'high' = 'medium';
    if (/urgent|asap|immediately|critical/i.test(text)) priority = 'high';
    else if (/when you get a chance|no rush|fyi/i.test(text)) priority = 'low';

    const deadlineMatch = text.match(
      /(?:by|before|deadline|due)\s+(\d{1,2}[\s/-]\w+[\s/-]\d{2,4})/i
    );

    return { action: email.subject, deadline: deadlineMatch?.[1], priority };
  }

  // ─── Email Check Pipeline ───────────────────────────────────────────────────

  /**
   * Check new emails for a single account. Called by per-account scheduler.
   */
  async checkAccountEmails(account: EmailAccount): Promise<ClassifiedEmail[]> {
    const stateKey = `lastCheck:${account.id}`;
    const lastCheck = this.ctx.storage.get<{ timestamp: string }>('email-state', stateKey);

    // On first run: fetch last 30 days (read + unread) to backfill
    // On subsequent runs: fetch everything since last check
    const query = lastCheck
      ? `after:${lastCheck.timestamp.slice(0, 10).replace(/-/g, '/')}`
      : 'newer_than:30d';

    let emails: ParsedEmail[] = [];

    if (account.provider === 'gmail') {
      emails = await this.fetchGmailEmails(account.id, 100, query);
    } else {
      // IMAP support placeholder — extend here
      this.ctx.logger.warn(`IMAP polling not yet implemented for account "${account.id}"`);
    }

    this.ctx.logger.info(
      `[${account.label}] Found ${emails.length} new email(s)`
    );

    const classified: ClassifiedEmail[] = [];
    for (const email of emails) {
      // Skip already processed emails (dedup by email ID)
      const existing = this.ctx.storage.get('emails', email.id);
      if (existing) continue;

      const c = await this.classifyEmail(email);
      classified.push(c);
      this.ctx.storage.set('emails', email.id, c, {
        category: c.category,
        from: c.from,
        date: c.date,
        accountId: c.accountId,
      });
    }

    const bills = classified.filter(e => e.category === 'bill');
    const actions = classified.filter(e => e.category === 'action_required');

    // Alert per-email with dedup (24h cooldown per message)
    for (const bill of bills) {
      const key = `email:${bill.id}:bill`;
      const shouldSend = this.alertRegistry ? this.alertRegistry.shouldFire(key, 24 * 60 * 60 * 1000) : true;
      if (shouldSend) {
        const data = bill.extractedData as BillData | undefined;
        const amount = data?.amount ? ` — ${data.currency} ${data.amount}` : '';
        await this.ctx.notify(
          `📧 Bill from <b>${bill.fromName}</b>: ${bill.subject}${amount}`,
          { urgency: 'high' }
        );
      }
    }

    for (const action of actions) {
      const key = `email:${action.id}:action`;
      const shouldSend = this.alertRegistry ? this.alertRegistry.shouldFire(key, 24 * 60 * 60 * 1000) : true;
      if (shouldSend) {
        await this.ctx.notify(
          `⚡ Action required from <b>${action.fromName}</b>: ${action.subject}`,
          { urgency: 'high' }
        );
      }
    }

    this.ctx.storage.set('email-state', stateKey, { timestamp: new Date().toISOString() });
    this.ctx.emit('checked', {
      accountId: account.id,
      total: emails.length,
      bills: bills.length,
      actions: actions.length,
    });

    return classified;
  }

  /**
   * Check ALL enabled accounts. Main entry point (e.g. for manual trigger or AI).
   */
  async checkNewEmails(): Promise<void> {
    const enabled = this.config.accounts.filter(a => a.enabled);
    this.ctx.logger.info(`Checking ${enabled.length} enabled email account(s)...`);

    for (const account of enabled) {
      try {
        await this.checkAccountEmails(account);
      } catch (err) {
        this.ctx.logger.error(`Email check failed for account "${account.id}": ${err}`);
      }
    }
  }

  /** Trigger immediate email sync — used by Alexa/voice channels for fresh data */
  async syncNow(): Promise<void> {
    return this.checkNewEmails();
  }

  // ─── Query Helpers ──────────────────────────────────────────────────────────

  /**
   * Get stored emails for a specific account.
   */
  getEmailsByAccount(accountId: string): ClassifiedEmail[] {
    const rows = this.ctx.storage.sqlite.query('emails', { accountId });
    return rows.map(r => JSON.parse(r.value) as ClassifiedEmail);
  }

  /**
   * Per-account unread/bills/actions counts.
   */
  async getAccountSummary(): Promise<AccountSummary[]> {
    const summaries: AccountSummary[] = [];

    for (const account of this.config.accounts) {
      const stateKey = `lastCheck:${account.id}`;
      const lastCheck = this.ctx.storage.get<{ timestamp: string }>('email-state', stateKey);

      const emails = this.getEmailsByAccount(account.id);
      const unread = emails.filter(e => !e.isRead).length;
      const bills = emails.filter(e => e.category === 'bill').length;
      const actions = emails.filter(e => e.category === 'action_required').length;

      summaries.push({
        accountId: account.id,
        accountLabel: account.label,
        purpose: account.purpose,
        provider: account.provider,
        unread,
        bills,
        actions,
        lastChecked: lastCheck?.timestamp ?? null,
      });
    }

    return summaries;
  }

  // ─── Summary / AI Context ───────────────────────────────────────────────────

  generateSummary(emails: ClassifiedEmail[]): string {
    if (emails.length === 0) return '📧 No emails to summarize.';

    const byCategory = new Map<EmailCategory, ClassifiedEmail[]>();
    for (const email of emails) {
      const list = byCategory.get(email.category) ?? [];
      list.push(email);
      byCategory.set(email.category, list);
    }

    const sections: string[] = ['📧 <b>Email Summary</b>\n'];

    const categoryEmoji: Record<EmailCategory, string> = {
      bill: '💰',
      finance: '💳',
      action_required: '⚡',
      personal: '👤',
      work: '💼',
      newsletter: '📰',
      fyi: 'ℹ️',
      spam: '🗑️',
    };

    for (const [category, list] of byCategory) {
      const emoji = categoryEmoji[category] ?? '📧';
      sections.push(`${emoji} *${category.replace('_', ' ')}* (${list.length})`);
      for (const email of list.slice(0, 5)) {
        const accountTag = this.config.accounts.length > 1 ? ` [${email.accountLabel}]` : '';
        sections.push(`  • ${email.fromName}: ${email.subject}${accountTag}`);
      }
      if (list.length > 5) {
        sections.push(`  _...and ${list.length - 5} more_`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * AI context block injected into the assistant's system prompt.
   * Tells the AI what accounts exist and their current state,
   * enabling natural queries like "check banking email" or "any job emails?".
   */
  async buildAIContext(): Promise<string> {
    const accounts = this.config.accounts.filter(a => a.enabled);
    if (accounts.length === 0) return '';

    const summaries = await this.getAccountSummary();
    const lines: string[] = [
      `## Email Accounts (${accounts.length} configured)`,
    ];

    for (const s of summaries) {
      const parts = [`**${s.accountLabel}** (id: \`${s.accountId}\`, purpose: ${s.purpose})`];
      if (s.unread > 0) parts.push(`${s.unread} unread`);
      if (s.bills > 0) parts.push(`${s.bills} bill(s)`);
      if (s.actions > 0) parts.push(`${s.actions} action(s) needed`);
      if (s.lastChecked) parts.push(`last checked: ${s.lastChecked}`);
      lines.push(`- ${parts.join(' | ')}`);
    }

    lines.push('');
    lines.push(
      'To query a specific account, address it by purpose/label: ' +
      accounts
        .map(a => `"${a.purpose}" → ${a.label}`)
        .join(', ')
    );

    return lines.join('\n');
  }

  // ─── Utility ────────────────────────────────────────────────────────────────

  getAccountById(accountId: string): EmailAccount | undefined {
    return this.config.accounts.find(a => a.id === accountId);
  }

  getEnabledAccounts(): EmailAccount[] {
    return this.config.accounts.filter(a => a.enabled);
  }
}
