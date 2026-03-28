import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  type: 'credit' | 'debit';
  category: TransactionCategory;
  description: string;
  merchant: string;
  source: 'sms' | 'email' | 'upi' | 'manual';
  date: string;
  account?: string;
  reference?: string;
  tags?: string[];
}

export type TransactionCategory =
  | 'food' | 'transport' | 'shopping' | 'entertainment'
  | 'bills' | 'rent' | 'emi' | 'insurance'
  | 'health' | 'education' | 'investment'
  | 'subscription' | 'salary' | 'transfer'
  | 'grocery' | 'fuel' | 'recharge' | 'other';

export interface Budget {
  category: TransactionCategory;
  limit: number;
  currency: string;
  period: 'daily' | 'weekly' | 'monthly';
}

export interface FinanceConfig {
  currency: string;
  budgets: Budget[];
  alertThreshold: number; // percentage (e.g., 80 = alert at 80% of budget)
  trackSubscriptions: boolean;
  autoCategorizeSms: boolean;
}

export interface SpendingSummary {
  period: string;
  totalSpent: number;
  totalIncome: number;
  byCategory: Map<TransactionCategory, number>;
  topMerchants: Array<{ merchant: string; total: number; count: number }>;
  overBudget: Array<{ category: TransactionCategory; spent: number; limit: number }>;
}

export class FinancePlugin implements AuraPlugin {
  name = 'finance';
  version = '0.2.0';
  private ctx!: PluginContext;
  private config!: FinanceConfig;
  private scheduleHandles: string[] = [];

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      currency: 'INR',
      budgets: [],
      alertThreshold: 80,
      trackSubscriptions: true,
      autoCategorizeSms: true,
      ...ctx.config as Record<string, unknown>,
    } as FinanceConfig;

    // Listen for bill emails from email plugin
    ctx.logger.info('Finance plugin loaded');
  }

  async onActivate(): Promise<void> {
    this.scheduleHandles = [];

    // Daily spending summary at 9 PM
    this.scheduleHandles.push(this.ctx.schedule('0 21 * * *', async () => {
      const summary = this.getDailySummary();
      if (summary) await this.ctx.notify(summary);
    }));

    // Weekly summary on Sundays
    this.scheduleHandles.push(this.ctx.schedule('0 10 * * 0', async () => {
      const summary = this.getWeeklySummary();
      if (summary) await this.ctx.notify(summary);
    }));

    // Monthly summary on 1st
    this.scheduleHandles.push(this.ctx.schedule('0 10 1 * *', async () => {
      const summary = this.getMonthlySummary();
      if (summary) await this.ctx.notify(summary);
    }));

    // Budget check every 6 hours
    this.scheduleHandles.push(this.ctx.schedule('0 */6 * * *', async () => {
      await this.checkBudgets();
    }));

    this.ctx.logger.info('Finance plugin activated — tracking expenses');
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Finance plugin deactivated');
  }

  // --- Transaction Management ---

  addTransaction(tx: Omit<Transaction, 'id'>): Transaction {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const transaction: Transaction = { id, ...tx };

    this.ctx.storage.set('transactions', id, transaction, {
      category: tx.category,
      type: tx.type,
      date: tx.date,
      merchant: tx.merchant,
    });

    this.ctx.emit('transaction', transaction);
    this.ctx.logger.info(`Transaction added: ${tx.type} ${tx.currency} ${tx.amount} — ${tx.description}`);

    return transaction;
  }

  getTransactions(filter?: {
    startDate?: string;
    endDate?: string;
    category?: TransactionCategory;
    type?: 'credit' | 'debit';
    minAmount?: number;
  }): Transaction[] {
    const all = this.ctx.storage.sqlite.list('transactions');

    return all
      .map(row => JSON.parse(row.value) as Transaction)
      .filter(tx => {
        if (filter?.startDate && tx.date < filter.startDate) return false;
        if (filter?.endDate && tx.date > filter.endDate) return false;
        if (filter?.category && tx.category !== filter.category) return false;
        if (filter?.type && tx.type !== filter.type) return false;
        if (filter?.minAmount && tx.amount < filter.minAmount) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // --- SMS Parsing (Indian Banks) ---

  parseBankSms(smsBody: string, sender: string): Omit<Transaction, 'id'> | null {
    const text = smsBody.toLowerCase();

    // Debit patterns
    const debitMatch = text.match(
      /(?:debited|spent|paid|withdrawn|purchase|debit)\b.*?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)/i
    ) || text.match(
      /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)\s*(?:debited|spent|withdrawn)/i
    );

    // Credit patterns
    const creditMatch = text.match(
      /(?:credited|received|deposited|credit|refund)\b.*?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)/i
    ) || text.match(
      /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)\s*(?:credited|received|deposited)/i
    );

    // UPI patterns
    const upiMatch = text.match(/(?:upi|paytm|gpay|phonepe|bhim)/i);
    const merchantMatch = text.match(/(?:at|to|from|merchant)\s+([A-Za-z0-9\s&'.]+?)(?:\s+on|\s+ref|\s+upi|\.|\s*$)/i);

    // Account detection
    const accountMatch = text.match(/(?:a\/c|acct?|account)\s*(?:no\.?\s*)?(?:xx|[*x]+)?\s*(\d{4})/i);

    // Reference number
    const refMatch = text.match(/(?:ref|txn|transaction)\s*(?:no\.?\s*)?:?\s*(\w+)/i);

    if (debitMatch) {
      const amount = parseFloat(debitMatch[1].replace(/,/g, ''));
      const merchant = merchantMatch?.[1]?.trim() ?? this.extractMerchant(smsBody);
      return {
        amount,
        currency: this.config.currency,
        type: 'debit',
        category: this.categorizeMerchant(merchant),
        description: smsBody.slice(0, 200),
        merchant,
        source: upiMatch ? 'upi' : 'sms',
        date: new Date().toISOString(),
        account: accountMatch?.[1],
        reference: refMatch?.[1],
      };
    }

    if (creditMatch) {
      const amount = parseFloat(creditMatch[1].replace(/,/g, ''));
      const merchant = merchantMatch?.[1]?.trim() ?? sender;
      return {
        amount,
        currency: this.config.currency,
        type: 'credit',
        category: this.categorizeMerchant(merchant),
        description: smsBody.slice(0, 200),
        merchant,
        source: upiMatch ? 'upi' : 'sms',
        date: new Date().toISOString(),
        account: accountMatch?.[1],
        reference: refMatch?.[1],
      };
    }

    return null;
  }

  private extractMerchant(text: string): string {
    // Try to find merchant name from common patterns
    const patterns = [
      /(?:at|to|from)\s+([A-Za-z0-9\s&'.]+?)(?:\s+on|\s+ref|\.)/i,
      /(?:upi[/-])([A-Za-z0-9]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return 'Unknown';
  }

  private categorizeMerchant(merchant: string): TransactionCategory {
    const m = merchant.toLowerCase();

    const categories: Array<{ keywords: string[]; category: TransactionCategory }> = [
      { keywords: ['swiggy', 'zomato', 'restaurant', 'food', 'cafe', 'pizza', 'burger', 'biryani', 'dominos', 'kfc', 'mcdonalds'], category: 'food' },
      { keywords: ['uber', 'ola', 'rapido', 'metro', 'irctc', 'railway', 'bus', 'flight', 'airline', 'cab', 'auto'], category: 'transport' },
      { keywords: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'mall', 'store'], category: 'shopping' },
      { keywords: ['netflix', 'hotstar', 'prime video', 'spotify', 'youtube', 'movie', 'pvr', 'inox', 'game'], category: 'entertainment' },
      { keywords: ['electricity', 'water', 'gas', 'broadband', 'wifi', 'internet'], category: 'bills' },
      { keywords: ['rent', 'housing', 'maintenance', 'society'], category: 'rent' },
      { keywords: ['emi', 'loan', 'hdfc emi', 'icici emi', 'sbi emi', 'axis emi', 'kotak emi', 'hdfc loan', 'icici loan'], category: 'emi' },
      { keywords: ['insurance', 'lic', 'policy', 'premium'], category: 'insurance' },
      { keywords: ['hospital', 'doctor', 'pharmacy', 'medical', 'apollo', 'medplus', 'health'], category: 'health' },
      { keywords: ['school', 'college', 'course', 'udemy', 'coursera', 'education', 'tuition', 'book'], category: 'education' },
      { keywords: ['mutual fund', 'stock', 'zerodha', 'groww', 'upstox', 'investment', 'sip', 'nps'], category: 'investment' },
      { keywords: ['subscription', 'renewal', 'monthly plan', 'annual plan'], category: 'subscription' },
      { keywords: ['salary', 'payroll', 'wages'], category: 'salary' },
      { keywords: ['bigbasket', 'blinkit', 'zepto', 'dmart', 'grocery', 'vegetables', 'supermarket'], category: 'grocery' },
      { keywords: ['petrol', 'diesel', 'fuel', 'petroleum', 'hp', 'iocl', 'bpcl', 'shell'], category: 'fuel' },
      { keywords: ['recharge', 'airtel', 'jio', 'vi', 'bsnl', 'prepaid', 'postpaid'], category: 'recharge' },
    ];

    for (const { keywords, category } of categories) {
      if (keywords.some(k => m.includes(k))) return category;
    }

    return 'other';
  }

  // --- Budget Management ---

  setBudget(category: TransactionCategory, limit: number, period: 'daily' | 'weekly' | 'monthly' = 'monthly'): void {
    const budget: Budget = { category, limit, currency: this.config.currency, period };
    this.ctx.storage.set('budgets', category, budget);
    this.ctx.logger.info(`Budget set: ${category} = ${this.config.currency} ${limit}/${period}`);
  }

  async checkBudgets(): Promise<void> {
    const budgets = this.ctx.storage.sqlite.list('budgets');
    const alerts: string[] = [];

    for (const row of budgets) {
      const budget = JSON.parse(row.value) as Budget;
      if (budget.limit <= 0) continue;
      const spent = this.getSpentInPeriod(budget.category, budget.period);
      const percentage = (spent / budget.limit) * 100;

      if (percentage >= 100) {
        alerts.push(`🚨 <b>${budget.category}</b>: Over budget! ₹${spent.toFixed(0)} / ₹${budget.limit} (${percentage.toFixed(0)}%)`);
      } else if (percentage >= this.config.alertThreshold) {
        alerts.push(`⚠️ <b>${budget.category}</b>: ₹${spent.toFixed(0)} / ₹${budget.limit} (${percentage.toFixed(0)}%)`);
      }
    }

    if (alerts.length > 0) {
      await this.ctx.notify(`💰 <b>Budget Alert</b>\n\n${alerts.join('\n')}`);
    }
  }

  private getSpentInPeriod(category: TransactionCategory, period: string): number {
    const now = new Date();
    let startDate: string;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        break;
      case 'weekly': {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        startDate = weekStart.toISOString();
        break;
      }
      case 'monthly':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        break;
    }

    const transactions = this.getTransactions({
      startDate,
      category,
      type: 'debit',
    });

    return transactions.reduce((sum, tx) => sum + tx.amount, 0);
  }

  // --- Subscription Detection ---

  detectSubscriptions(): Array<{ merchant: string; amount: number; frequency: string; lastCharge: string }> {
    const transactions = this.getTransactions({ type: 'debit' });

    // Group by merchant
    const merchantTx = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const list = merchantTx.get(tx.merchant) ?? [];
      list.push(tx);
      merchantTx.set(tx.merchant, list);
    }

    const subscriptions: Array<{ merchant: string; amount: number; frequency: string; lastCharge: string }> = [];

    for (const [merchant, txs] of merchantTx) {
      if (txs.length < 2) continue;

      // Check if amounts are consistent (within 10%)
      const amounts = txs.map(t => t.amount);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const isConsistent = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.1);

      if (!isConsistent) continue;

      // Check frequency
      const dates = txs.map(t => new Date(t.date).getTime()).sort();
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      let frequency = 'unknown';
      if (avgInterval >= 25 && avgInterval <= 35) frequency = 'monthly';
      else if (avgInterval >= 85 && avgInterval <= 95) frequency = 'quarterly';
      else if (avgInterval >= 350 && avgInterval <= 380) frequency = 'yearly';
      else if (avgInterval >= 6 && avgInterval <= 8) frequency = 'weekly';

      if (frequency !== 'unknown') {
        subscriptions.push({
          merchant,
          amount: avgAmount,
          frequency,
          lastCharge: txs[0].date,
        });
      }
    }

    return subscriptions;
  }

  // --- Summaries ---

  getDailySummary(): string | null {
    const today = new Date().toISOString().slice(0, 10);
    const txs = this.getTransactions({ startDate: `${today}T00:00:00Z`, type: 'debit' });

    if (txs.length === 0) return null;

    const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
    const lines = txs.slice(0, 10).map(tx =>
      `  • ${tx.merchant}: ₹${tx.amount.toFixed(0)} (${tx.category})`
    );

    return `💰 <b>Today's Spending</b>\n\nTotal: ₹${total.toFixed(0)}\n\n${lines.join('\n')}`;
  }

  getWeeklySummary(): string | null {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const txs = this.getTransactions({ startDate: weekStart.toISOString(), type: 'debit' });
    if (txs.length === 0) return null;

    const total = txs.reduce((sum, tx) => sum + tx.amount, 0);

    // By category
    const byCategory = new Map<string, number>();
    for (const tx of txs) {
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }

    const categoryLines = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([cat, amount]) => `  • ${cat}: ₹${amount.toFixed(0)}`);

    return `📊 <b>Weekly Spending</b>\n\nTotal: ₹${total.toFixed(0)} (${txs.length} transactions)\n\n${categoryLines.join('\n')}`;
  }

  getMonthlySummary(): string | null {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const debits = this.getTransactions({ startDate: monthStart, type: 'debit' });
    const credits = this.getTransactions({ startDate: monthStart, type: 'credit' });

    const totalSpent = debits.reduce((sum, tx) => sum + tx.amount, 0);
    const totalIncome = credits.reduce((sum, tx) => sum + tx.amount, 0);

    // Top merchants
    const merchantSpend = new Map<string, number>();
    for (const tx of debits) {
      merchantSpend.set(tx.merchant, (merchantSpend.get(tx.merchant) ?? 0) + tx.amount);
    }
    const topMerchants = Array.from(merchantSpend.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, a]) => `  • ${m}: ₹${a.toFixed(0)}`);

    // Subscriptions (normalized to monthly)
    const subs = this.detectSubscriptions();
    const normalizeToMonthly = (amount: number, freq: string): number => {
      switch (freq) {
        case 'weekly': return amount * 52 / 12;
        case 'quarterly': return amount / 3;
        case 'yearly': return amount / 12;
        default: return amount; // monthly
      }
    };
    const subTotal = subs.reduce((sum, s) => sum + normalizeToMonthly(s.amount, s.frequency), 0);

    const sections = [
      `📊 <b>Monthly Summary</b>\n`,
      `💰 Income: ₹${totalIncome.toFixed(0)}`,
      `💸 Spent: ₹${totalSpent.toFixed(0)}`,
      `📈 Net: ₹${(totalIncome - totalSpent).toFixed(0)}\n`,
      `🏪 <b>Top Merchants</b>`,
      topMerchants.join('\n'),
    ];

    if (subs.length > 0) {
      sections.push(`\n🔄 <b>Subscriptions:</b> ${subs.length} active (₹${subTotal.toFixed(0)}/month)`);
    }

    return sections.join('\n');
  }

  // --- Export ---

  exportTransactions(format: 'json' | 'csv', filter?: { startDate?: string; endDate?: string }): string {
    const txs = this.getTransactions(filter);

    if (format === 'json') {
      return JSON.stringify(txs, null, 2);
    }

    // CSV
    const headers = 'Date,Type,Amount,Currency,Category,Merchant,Description,Source,Reference\n';
    const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    const rows = txs.map(tx =>
      `${tx.date},${tx.type},${tx.amount},${tx.currency},${tx.category},${esc(tx.merchant)},${esc(tx.description)},${tx.source},${tx.reference ?? ''}`
    ).join('\n');

    return headers + rows;
  }
}
