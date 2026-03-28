/**
 * Aura v0.2 Tests — Email Intelligence + Finance Tracker
 */

import { loadConfig } from './src/core/config.js';
import { createLogger, childLogger } from './src/core/logger.js';
import { MemoryStore } from './src/core/storage/index.js';
import { PluginBus } from './src/core/plugin-bus.js';
import { Scheduler } from './src/core/scheduler.js';
import { EmailPlugin } from './src/plugins/email.js';
import type { ParsedEmail } from './src/plugins/email.js';
import { FinancePlugin } from './src/plugins/finance.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err}`);
    failed++;
    failures.push(`${name}: ${err}`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n🧪 Aura v0.2 — Email + Finance Tests\n');

  const config = loadConfig();
  const log = createLogger('error');
  const storage = new MemoryStore(config.storage, childLogger(log, 'test'));
  const plugins = new PluginBus(storage, childLogger(log, 'test-plugins'));
  const scheduler = new Scheduler(childLogger(log, 'test-sched'));

  plugins.setScheduleHandler((expr, handler) => scheduler.add(expr, handler));

  // ============================================
  console.log('📧 Email Intelligence');
  // ============================================

  const emailPlugin = new EmailPlugin();
  await plugins.register(emailPlugin, { provider: 'gmail', autoClassify: true, extractBills: true });

  await test('email: classify bill email', async () => {
    const billEmail: ParsedEmail = {
      id: 'e1', messageId: '<bill@test>', from: 'billing@electricity.com',
      fromName: 'City Power', to: 'user@gmail.com',
      subject: 'Your Electricity Bill - Payment Due',
      body: 'Your electricity bill for March is Rs. 2,450.00. Due date: 05 Apr 2026.',
      bodyPlain: 'Your electricity bill for March is Rs. 2,450.00. Due date: 05 Apr 2026.',
      date: '2026-03-25T10:00:00Z', labels: ['INBOX', 'UNREAD'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(billEmail);
    assert(classified.category === 'bill', `should be bill, got ${classified.category}`);
    assert(classified.confidence >= 0.8, `confidence should be >= 0.8, got ${classified.confidence}`);

    // Check extracted bill data
    const billData = classified.extractedData as { amount: number; currency: string; vendor: string; billType: string };
    assert(billData !== undefined, 'should extract bill data');
    assert(billData.amount === 2450, `amount should be 2450, got ${billData.amount}`);
    assert(billData.currency === 'INR', `currency should be INR, got ${billData.currency}`);
    assert(billData.billType === 'electricity', `type should be electricity, got ${billData.billType}`);
  });

  await test('email: classify newsletter', async () => {
    const newsletter: ParsedEmail = {
      id: 'e2', messageId: '<news@test>', from: 'noreply@techblog.com',
      fromName: 'Tech Weekly', to: 'user@gmail.com',
      subject: 'This Week in AI - March Edition',
      body: 'View in browser. Top AI news this week... Click to unsubscribe from this mailing list.',
      bodyPlain: 'View in browser. Top AI news this week... Click to unsubscribe from this mailing list.',
      date: '2026-03-26T08:00:00Z', labels: ['INBOX'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(newsletter);
    assert(classified.category === 'newsletter', `should be newsletter, got ${classified.category}`);
  });

  await test('email: classify action required', async () => {
    const actionEmail: ParsedEmail = {
      id: 'e3', messageId: '<action@test>', from: 'boss@company.com',
      fromName: 'Boss', to: 'user@gmail.com',
      subject: 'Urgent: Please review the proposal',
      body: 'Action required: Please review the attached proposal and respond by Friday.',
      bodyPlain: 'Action required: Please review the attached proposal and respond by Friday.',
      date: '2026-03-27T09:00:00Z', labels: ['INBOX', 'UNREAD'],
      isRead: false, hasAttachments: true,
    };

    const classified = await emailPlugin.classifyEmail(actionEmail);
    assert(classified.category === 'action_required', `should be action_required, got ${classified.category}`);
  });

  await test('email: classify work email (GitHub)', async () => {
    const workEmail: ParsedEmail = {
      id: 'e4', messageId: '<gh@test>', from: 'notifications@github.com',
      fromName: 'GitHub', to: 'user@gmail.com',
      subject: 'Re: [org/repo] Fix memory leak in cache (#234)',
      body: 'A new comment was posted on the pull request.',
      bodyPlain: 'A new comment was posted on the pull request.',
      date: '2026-03-27T14:00:00Z', labels: ['INBOX'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(workEmail);
    assert(classified.category === 'work', `should be work, got ${classified.category}`);
  });

  await test('email: classify personal email', async () => {
    const personal: ParsedEmail = {
      id: 'e5', messageId: '<friend@test>', from: 'friend@gmail.com',
      fromName: 'Rahul', to: 'user@gmail.com',
      subject: 'Hey, lunch tomorrow?',
      body: 'Are you free for lunch tomorrow at 1 PM?',
      bodyPlain: 'Are you free for lunch tomorrow at 1 PM?',
      date: '2026-03-27T18:00:00Z', labels: ['INBOX'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(personal);
    assert(classified.category === 'personal', `should be personal, got ${classified.category}`);
  });

  await test('email: extract bill with dollar amount', async () => {
    const usBill: ParsedEmail = {
      id: 'e6', messageId: '<usbill@test>', from: 'billing@service.com',
      fromName: 'Cloud Service', to: 'user@gmail.com',
      subject: 'Your monthly invoice',
      body: 'Your invoice for March. Amount due: $49.99. Payment due by April 10.',
      bodyPlain: 'Your invoice for March. Amount due: $49.99. Payment due by April 10.',
      date: '2026-03-28T10:00:00Z', labels: ['INBOX'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(usBill);
    assert(classified.category === 'bill', `should be bill, got ${classified.category}`);
    const data = classified.extractedData as { amount: number; currency: string };
    assert(data.amount === 49.99, `amount should be 49.99, got ${data.amount}`);
    assert(data.currency === 'USD', `currency should be USD, got ${data.currency}`);
  });

  await test('email: extract bill with euro (European format)', async () => {
    const euroBill: ParsedEmail = {
      id: 'e7', messageId: '<euro@test>', from: 'billing@service.de',
      fromName: 'German Service', to: 'user@gmail.com',
      subject: 'Your monthly invoice - payment due',
      body: 'Your invoice for March. Amount due: €1.234,56. Payment due by 10 April.',
      bodyPlain: 'Your invoice for March. Amount due: €1.234,56. Payment due by 10 April.',
      date: '2026-03-28T10:00:00Z', labels: ['INBOX'],
      isRead: false, hasAttachments: false,
    };

    const classified = await emailPlugin.classifyEmail(euroBill);
    assert(classified.category === 'bill', `should be bill, got ${classified.category}`);
    const data = classified.extractedData as { amount: number; currency: string };
    assert(data.amount === 1234.56, `amount should be 1234.56, got ${data.amount}`);
    assert(data.currency === 'EUR', `currency should be EUR, got ${data.currency}`);
  });

  await test('email: summary generation', async () => {
    const emails = [
      await emailPlugin.classifyEmail({
        id: 's1', messageId: '', from: 'a@b.com', fromName: 'Alice', to: '',
        subject: 'Bill', body: 'invoice payment due Rs 100', bodyPlain: 'invoice payment due Rs 100',
        date: '', labels: [], isRead: false, hasAttachments: false,
      }),
      await emailPlugin.classifyEmail({
        id: 's2', messageId: '', from: 'noreply@news.com', fromName: 'News', to: '',
        subject: 'Weekly', body: 'unsubscribe from this mailing list view in browser',
        bodyPlain: 'unsubscribe from this mailing list view in browser',
        date: '', labels: [], isRead: false, hasAttachments: false,
      }),
    ];

    const summary = emailPlugin.generateSummary(emails);
    assert(summary.includes('Email Summary'), 'should have title');
    assert(summary.includes('bill') || summary.includes('💰'), 'should mention bill category');
  });

  // ============================================
  console.log('\n💰 Finance Tracker');
  // ============================================

  // Clean up any leftover data from previous runs
  storage.sqlite.transaction(() => {
    for (const row of storage.sqlite.list('transactions')) {
      storage.sqlite.delete('transactions', row.key);
    }
    for (const row of storage.sqlite.list('budgets')) {
      storage.sqlite.delete('budgets', row.key);
    }
  });

  const financePlugin = new FinancePlugin();
  await plugins.register(financePlugin, { currency: 'INR', alertThreshold: 80 });
  await plugins.activate('finance');

  await test('finance: add and retrieve transactions', () => {
    financePlugin.addTransaction({
      amount: 250, currency: 'INR', type: 'debit',
      category: 'food', description: 'Lunch at Swiggy',
      merchant: 'Swiggy', source: 'upi',
      date: new Date().toISOString(),
    });

    financePlugin.addTransaction({
      amount: 1500, currency: 'INR', type: 'debit',
      category: 'transport', description: 'Uber ride',
      merchant: 'Uber', source: 'upi',
      date: new Date().toISOString(),
    });

    financePlugin.addTransaction({
      amount: 50000, currency: 'INR', type: 'credit',
      category: 'salary', description: 'Monthly salary',
      merchant: 'Company', source: 'manual',
      date: new Date().toISOString(),
    });

    const all = financePlugin.getTransactions();
    assert(all.length === 3, `should have 3 transactions, got ${all.length}`);
  });

  await test('finance: filter by type', () => {
    const debits = financePlugin.getTransactions({ type: 'debit' });
    assert(debits.length === 2, `should have 2 debits, got ${debits.length}`);

    const credits = financePlugin.getTransactions({ type: 'credit' });
    assert(credits.length === 1, `should have 1 credit, got ${credits.length}`);
  });

  await test('finance: filter by category', () => {
    const food = financePlugin.getTransactions({ category: 'food' });
    assert(food.length === 1, `should have 1 food tx, got ${food.length}`);
    assert(food[0].merchant === 'Swiggy', 'should be Swiggy');
  });

  await test('finance: parse Indian bank SMS (debit)', () => {
    const sms = 'Rs.2,500.00 debited from A/c XX1234 on 28-Mar-26 to Swiggy. UPI Ref: 123456789.';
    const tx = financePlugin.parseBankSms(sms, 'HDFC-Bank');
    assert(tx !== null, 'should parse SMS');
    assert(tx!.amount === 2500, `amount should be 2500, got ${tx!.amount}`);
    assert(tx!.type === 'debit', 'should be debit');
    assert(tx!.category === 'food', `should categorize as food, got ${tx!.category}`);
  });

  await test('finance: parse Indian bank SMS (credit)', () => {
    const sms = 'Rs 25,000.00 credited to your A/c XX5678 on 28-Mar. Ref: NEFT12345.';
    const tx = financePlugin.parseBankSms(sms, 'SBI');
    assert(tx !== null, 'should parse credit SMS');
    assert(tx!.amount === 25000, `amount should be 25000, got ${tx!.amount}`);
    assert(tx!.type === 'credit', 'should be credit');
  });

  await test('finance: parse UPI SMS', () => {
    const sms = 'Paid Rs.350 to Zomato via UPI. UPI Ref: 789012345. Balance: Rs.15,000.';
    const tx = financePlugin.parseBankSms(sms, 'ICICI');
    assert(tx !== null, 'should parse UPI SMS');
    assert(tx!.amount === 350, `amount should be 350, got ${tx!.amount}`);
    assert(tx!.source === 'upi', 'source should be upi');
    assert(tx!.category === 'food', `should categorize as food (Zomato), got ${tx!.category}`);
  });

  await test('finance: parse rupee symbol SMS', () => {
    const sms = '₹1,200 spent at Amazon on card XX9876.';
    const tx = financePlugin.parseBankSms(sms, 'Axis');
    assert(tx !== null, 'should parse ₹ symbol');
    assert(tx!.amount === 1200, `amount should be 1200, got ${tx!.amount}`);
    assert(tx!.category === 'shopping', `should be shopping (Amazon), got ${tx!.category}`);
  });

  await test('finance: ignore non-transaction SMS', () => {
    const sms = 'Your OTP is 123456. Valid for 5 minutes.';
    const tx = financePlugin.parseBankSms(sms, 'Bank');
    assert(tx === null, 'should return null for non-transaction SMS');
  });

  await test('finance: merchant categorization', () => {
    const testCases: Array<{ merchant: string; expected: string }> = [
      { merchant: 'Swiggy', expected: 'food' },
      { merchant: 'Uber', expected: 'transport' },
      { merchant: 'Amazon', expected: 'shopping' },
      { merchant: 'Netflix', expected: 'entertainment' },
      { merchant: 'Zerodha', expected: 'investment' },
      { merchant: 'BigBasket', expected: 'grocery' },
      { merchant: 'HP Petrol', expected: 'fuel' },
      { merchant: 'Airtel Recharge', expected: 'recharge' },
      { merchant: 'Apollo Hospital', expected: 'health' },
      { merchant: 'LIC Insurance', expected: 'insurance' },
    ];

    for (const { merchant, expected } of testCases) {
      // Use parseBankSms to test categorization indirectly
      const sms = `Rs.100 debited at ${merchant}. Ref: 123.`;
      const tx = financePlugin.parseBankSms(sms, 'Bank');
      assert(tx !== null, `SMS for "${merchant}" should parse successfully`);
      assert(tx!.category === expected, `${merchant} should be ${expected}, got ${tx!.category}`);
    }
  });

  await test('finance: budget set and check', async () => {
    financePlugin.setBudget('food', 5000, 'monthly');

    // Add more food transactions
    for (let i = 0; i < 5; i++) {
      financePlugin.addTransaction({
        amount: 500, currency: 'INR', type: 'debit',
        category: 'food', description: `Food order ${i}`,
        merchant: 'Swiggy', source: 'upi',
        date: new Date().toISOString(),
      });
    }

    // Budget check should not crash and should NOT alert (55% < 80% threshold)
    let notified = false;
    plugins.setNotifyHandler(async () => { notified = true; });
    await financePlugin.checkBudgets();
    // With 250 + 5*500 = 2750 spent on food, budget is 5000, so 55% — below 80% threshold
    assert(notified === false, 'should not alert at 55% of budget (threshold is 80%)');
  });

  await test('finance: daily summary', () => {
    const summary = financePlugin.getDailySummary();
    // We added transactions today, so should have a summary
    assert(summary !== null, 'should have daily summary');
    assert(summary!.includes("Today's Spending"), 'should include title');
    assert(summary!.includes('₹'), 'should include currency symbol');
  });

  await test('finance: monthly summary', () => {
    const summary = financePlugin.getMonthlySummary();
    assert(summary !== null, 'should have monthly summary');
    assert(summary!.includes('Monthly Summary'), 'should include title');
    assert(summary!.includes('Income'), 'should include income');
    assert(summary!.includes('Spent'), 'should include spent');
  });

  await test('finance: CSV export', () => {
    const csv = financePlugin.exportTransactions('csv');
    assert(csv.includes('Date,Type,Amount'), 'should have CSV headers');
    const lines = csv.split('\n');
    assert(lines.length > 3, `should have data rows, got ${lines.length}`);
  });

  await test('finance: JSON export', () => {
    const json = financePlugin.exportTransactions('json');
    const data = JSON.parse(json);
    assert(Array.isArray(data), 'should be array');
    assert(data.length >= 3, `should have transactions, got ${data.length}`);
  });

  await test('finance: subscription detection', () => {
    // Add recurring transactions
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const date = new Date(now - i * 30 * 24 * 60 * 60 * 1000);
      financePlugin.addTransaction({
        amount: 199, currency: 'INR', type: 'debit',
        category: 'subscription', description: 'Netflix monthly',
        merchant: 'Netflix', source: 'manual',
        date: date.toISOString(),
      });
    }

    const subs = financePlugin.detectSubscriptions();
    const netflix = subs.find(s => s.merchant === 'Netflix');
    assert(netflix !== undefined, 'should detect Netflix subscription');
    assert(netflix!.frequency === 'monthly', `should be monthly, got ${netflix!.frequency}`);
    assert(Math.abs(netflix!.amount - 199) < 1, 'amount should be ~199');
  });

  // Cleanup
  scheduler.stopAll();
  storage.close();

  console.log('\n' + '='.repeat(50));
  console.log(`\n🏁 v0.2 Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  ⛔ ${f}`));
    console.log();
  }

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
