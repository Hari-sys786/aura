import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  nextRenewal: string;
  lastCharge?: string;
  category: 'streaming' | 'productivity' | 'cloud' | 'fitness' | 'news' | 'gaming' | 'finance' | 'other';
  status: 'active' | 'paused' | 'cancelled';
  autoDetected: boolean;
  source: 'email' | 'transaction' | 'manual';
  notes?: string;
}

export class SubscriptionPlugin implements AuraPlugin {
  name = 'subscriptions';
  version = '0.3.0';
  private ctx!: PluginContext;

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;

    // Listen for email and transaction events to auto-detect subscriptions
    ctx.logger.info('Subscription watchdog loaded');
  }

  async onActivate(): Promise<void> {
    // Daily renewal check at 9 AM
    this.ctx.schedule('0 9 * * *', async () => {
      await this.checkUpcomingRenewals();
    });

    // Weekly subscription audit on Sundays
    this.ctx.schedule('0 10 * * 0', async () => {
      const summary = this.getMonthlyCostSummary();
      await this.ctx.notify(summary);
    });

    // Scan emails for subscription keywords every 6 hours
    this.ctx.schedule('0 */6 * * *', async () => {
      await this.scanForNewSubscriptions();
    });

    this.ctx.logger.info(`Subscription watchdog activated — ${this.listSubscriptions().length} tracked`);
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Subscription watchdog deactivated');
  }

  // --- Subscription Management ---

  addSubscription(sub: Omit<Subscription, 'id'>): Subscription {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const subscription: Subscription = { id, ...sub };

    this.ctx.storage.set('subscriptions', id, subscription, {
      name: sub.name,
      status: sub.status,
      frequency: sub.frequency,
    });

    this.ctx.logger.info(`Subscription added: ${sub.name} — ${sub.currency} ${sub.amount}/${sub.frequency}`);
    return subscription;
  }

  updateSubscription(id: string, updates: Partial<Subscription>): Subscription | null {
    const existing = this.ctx.storage.get<Subscription>('subscriptions', id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    this.ctx.storage.set('subscriptions', id, updated);
    return updated;
  }

  cancelSubscription(id: string): boolean {
    const sub = this.ctx.storage.get<Subscription>('subscriptions', id);
    if (!sub) return false;

    sub.status = 'cancelled';
    this.ctx.storage.set('subscriptions', id, sub);
    this.ctx.logger.info(`Subscription cancelled: ${sub.name}`);
    return true;
  }

  listSubscriptions(filter?: { status?: string; category?: string }): Subscription[] {
    const all = this.ctx.storage.sqlite.list('subscriptions');

    return all
      .map(row => JSON.parse(row.value) as Subscription)
      .filter(sub => {
        if (filter?.status && sub.status !== filter.status) return false;
        if (filter?.category && sub.category !== filter.category) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Auto-Detection from Emails ---

  async scanForNewSubscriptions(): Promise<void> {
    try {
      const emails = this.ctx.storage.sqlite.list('emails');
      const existingSubs = this.listSubscriptions();
      const existingNames = new Set(existingSubs.map(s => s.name.toLowerCase()));

      const subKeywords: Array<{ pattern: RegExp; name: string; category: Subscription['category'] }> = [
        { pattern: /netflix/i, name: 'Netflix', category: 'streaming' },
        { pattern: /spotify/i, name: 'Spotify', category: 'streaming' },
        { pattern: /amazon\s*prime/i, name: 'Amazon Prime', category: 'streaming' },
        { pattern: /disney\s*\+|hotstar/i, name: 'Disney+ Hotstar', category: 'streaming' },
        { pattern: /youtube\s*premium/i, name: 'YouTube Premium', category: 'streaming' },
        { pattern: /apple\s*music|apple\s*one/i, name: 'Apple Music', category: 'streaming' },
        { pattern: /jio\s*cinema/i, name: 'JioCinema', category: 'streaming' },
        { pattern: /notion/i, name: 'Notion', category: 'productivity' },
        { pattern: /github\s*(pro|copilot|team)/i, name: 'GitHub', category: 'productivity' },
        { pattern: /chatgpt|openai/i, name: 'ChatGPT Plus', category: 'productivity' },
        { pattern: /claude|anthropic/i, name: 'Claude Pro', category: 'productivity' },
        { pattern: /google\s*(one|workspace)/i, name: 'Google One', category: 'cloud' },
        { pattern: /icloud/i, name: 'iCloud+', category: 'cloud' },
        { pattern: /dropbox/i, name: 'Dropbox', category: 'cloud' },
        { pattern: /aws|amazon\s*web/i, name: 'AWS', category: 'cloud' },
        { pattern: /digital\s*ocean/i, name: 'DigitalOcean', category: 'cloud' },
        { pattern: /zerodha/i, name: 'Zerodha', category: 'finance' },
        { pattern: /groww/i, name: 'Groww', category: 'finance' },
        { pattern: /cult\s*fit|cure\s*fit/i, name: 'Cult.fit', category: 'fitness' },
      ];

      let detected = 0;

      for (const email of emails) {
        const val = JSON.parse(email.value);
        const combined = `${val.fromName ?? ''} ${val.subject ?? ''} ${val.from ?? ''}`.toLowerCase();

        for (const { pattern, name, category } of subKeywords) {
          if (pattern.test(combined) && !existingNames.has(name.toLowerCase())) {
            // Check if it mentions subscription/renewal/billing
            const subIndicators = ['subscription', 'renewal', 'billing', 'charged', 'payment', 'invoice', 'receipt', 'plan', 'membership'];
            const isSubEmail = subIndicators.some(k => combined.includes(k) || (val.bodyPlain ?? '').toLowerCase().includes(k));

            if (isSubEmail) {
              // Extract amount if possible
              const amountMatch = (val.bodyPlain ?? '').match(/(?:₹|rs\.?\s*|inr\s*|\$)\s*([\d,]+(?:\.\d{2})?)/i);
              const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

              this.addSubscription({
                name,
                amount,
                currency: /₹|rs|inr/i.test(val.bodyPlain ?? '') ? 'INR' : 'USD',
                frequency: 'monthly',
                nextRenewal: this.estimateNextRenewal(val.date),
                lastCharge: val.date,
                category,
                status: 'active',
                autoDetected: true,
                source: 'email',
              });

              existingNames.add(name.toLowerCase());
              detected++;
            }
          }
        }
      }

      if (detected > 0) {
        this.ctx.logger.info(`Detected ${detected} new subscription(s) from emails`);
        await this.ctx.notify(`🔔 Detected ${detected} new subscription(s). Use /subs to review.`);
      }
    } catch (err) {
      this.ctx.logger.error(`Subscription scan failed: ${err}`);
    }
  }

  // --- Renewal Alerts ---

  async checkUpcomingRenewals(): Promise<void> {
    const subs = this.listSubscriptions({ status: 'active' });
    const now = new Date();
    const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const alerts: string[] = [];

    for (const sub of subs) {
      if (!sub.nextRenewal) continue;

      try {
        const renewal = new Date(sub.nextRenewal);
        if (isNaN(renewal.getTime())) continue;

        const daysUntil = Math.ceil((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntil <= 0) {
          alerts.push(`🔄 <b>${sub.name}</b> — renewed today (${sub.currency} ${sub.amount})`);
          // Advance next renewal
          sub.nextRenewal = this.advanceRenewal(renewal, sub.frequency);
          sub.lastCharge = now.toISOString();
          this.ctx.storage.set('subscriptions', sub.id, sub);
        } else if (daysUntil <= 3) {
          alerts.push(`⏰ <b>${sub.name}</b> — renews in ${daysUntil} day(s) (${sub.currency} ${sub.amount})`);
        }
      } catch { /* skip */ }
    }

    if (alerts.length > 0) {
      await this.ctx.notify(`🔔 <b>Subscription Renewals</b>\n\n${alerts.join('\n')}`);
    }
  }

  // --- Cost Analysis ---

  getMonthlyCostSummary(): string {
    const subs = this.listSubscriptions({ status: 'active' });
    if (subs.length === 0) return '🔔 No active subscriptions tracked.';

    let totalMonthly = 0;
    const lines: string[] = [];

    const normalize = (amount: number, freq: string): number => {
      switch (freq) {
        case 'weekly': return amount * 52 / 12;
        case 'quarterly': return amount / 3;
        case 'yearly': return amount / 12;
        default: return amount;
      }
    };

    const byCategory = new Map<string, number>();

    for (const sub of subs) {
      const monthly = normalize(sub.amount, sub.frequency);
      totalMonthly += monthly;
      byCategory.set(sub.category, (byCategory.get(sub.category) ?? 0) + monthly);
      lines.push(`  • ${sub.name}: ₹${monthly.toFixed(0)}/mo (${sub.frequency})`);
    }

    const yearly = totalMonthly * 12;

    let summary = `🔔 <b>Subscription Costs</b>\n\n`;
    summary += `Monthly: ₹${totalMonthly.toFixed(0)}\n`;
    summary += `Yearly: ₹${yearly.toFixed(0)}\n\n`;
    summary += `<b>Subscriptions (${subs.length})</b>\n${lines.join('\n')}`;

    // Category breakdown
    const catLines = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, cost]) => `  • ${cat}: ₹${cost.toFixed(0)}/mo`);

    summary += `\n\n<b>By Category</b>\n${catLines.join('\n')}`;

    return summary;
  }

  // --- Helpers ---

  private estimateNextRenewal(lastDate?: string): string {
    const base = lastDate ? new Date(lastDate) : new Date();
    base.setMonth(base.getMonth() + 1);
    return base.toISOString();
  }

  private advanceRenewal(current: Date, frequency: string): string {
    const next = new Date(current);
    switch (frequency) {
      case 'weekly': next.setDate(next.getDate() + 7); break;
      case 'monthly': next.setMonth(next.getMonth() + 1); break;
      case 'quarterly': next.setMonth(next.getMonth() + 3); break;
      case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
    }
    return next.toISOString();
  }
}
