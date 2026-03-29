#!/usr/bin/env node

/**
 * Aura CLI — manage your Aura instance from the command line.
 * 
 * Usage:
 *   aura start          — Start Aura
 *   aura setup          — Interactive setup wizard
 *   aura status         — Show system status
 *   aura plugins        — List plugins
 *   aura chat "message" — Send a message to the agent
 *   aura emails         — Show recent emails
 *   aura calendar       — Show today's events
 *   aura spend          — Today's spending
 *   aura summary        — Monthly finance summary
 *   aura docs           — Document vault summary
 *   aura subs           — Subscription costs
 *   aura export [type]  — Export data (finance-csv, finance-json)
 *   aura doctor         — Check system health
 */

import { loadConfig } from './core/config.js';
import { createLogger, childLogger } from './core/logger.js';
import { MemoryStore } from './core/storage/index.js';
import { createAiAdapter } from './core/ai/index.js';
import { Agent } from './core/agent.js';
import { PluginBus } from './core/plugin-bus.js';
import { Scheduler } from './core/scheduler.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

async function main(): Promise<void> {
  switch (command) {
    case 'start':
      // Delegate to main entry
      await import('./index.js');
      break;

    case 'setup':
      await import('./setup.js');
      break;

    case 'status':
      await showStatus();
      break;

    case 'plugins':
      await showPlugins();
      break;

    case 'chat':
      await chat(args.slice(1).join(' '));
      break;

    case 'emails':
      await showEmails();
      break;

    case 'calendar':
      await showCalendar();
      break;

    case 'spend':
      await showSpending();
      break;

    case 'summary':
      await showSummary();
      break;

    case 'docs':
      await showDocs();
      break;

    case 'subs':
      await showSubs();
      break;

    case 'export':
      await exportData(args[1] ?? 'finance-csv');
      break;

    case 'doctor':
      await doctor();
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    case 'version':
    case '--version':
    case '-v':
      console.log('Aura v0.4.0');
      break;

    default:
      console.log(`Unknown command: ${command}\nRun 'aura help' for usage.`);
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
🔱 Aura CLI v0.4.0

Usage: aura <command> [options]

Commands:
  start          Start Aura (Telegram bot + all plugins)
  setup          Interactive setup wizard
  status         System status (AI, storage, plugins)
  plugins        List active plugins
  chat "msg"     Chat with the AI agent
  emails         Show recent classified emails
  calendar       Show today's calendar events
  spend          Today's spending summary
  summary        Monthly finance summary
  docs           Document vault summary
  subs           Subscription cost breakdown
  export <type>  Export data (finance-csv, finance-json)
  doctor         Check system health
  version        Show version
  help           Show this message
  `);
}

function getStorage() {
  const config = loadConfig();
  const log = createLogger('error');
  return { config, log, storage: new MemoryStore(config.storage, childLogger(log, 'cli')) };
}

async function showStatus(): Promise<void> {
  const { config, storage } = getStorage();
  const ai = createAiAdapter(config.ai, createLogger('error'));
  const reachable = await ai.ping();

  console.log(`\n🔱 Aura Status\n`);
  console.log(`  AI: ${config.ai.provider} / ${config.ai.model} (${reachable ? '✅ connected' : '❌ offline'})`);
  console.log(`  Telegram: ${config.telegram.botToken ? '✅ configured' : '❌ not set'}`);
  console.log(`  Google: ${config.google.clientId ? '✅ configured' : '❌ not set'}`);
  console.log(`  Encryption: ${config.masterPassword ? '✅ enabled' : '⚠️  disabled'}`);

  const emails = storage.sqlite.list('emails').length;
  const events = storage.sqlite.list('calendar-events').length;
  const txns = storage.sqlite.list('transactions').length;
  const docs = storage.sqlite.list('documents').length;
  const subs = storage.sqlite.list('subscriptions').length;

  console.log(`\n  Data:`);
  console.log(`    📧 Emails: ${emails}`);
  console.log(`    📅 Calendar events: ${events}`);
  console.log(`    💰 Transactions: ${txns}`);
  console.log(`    📄 Documents: ${docs}`);
  console.log(`    🔔 Subscriptions: ${subs}`);

  storage.close();
}

async function showPlugins(): Promise<void> {
  const { storage } = getStorage();
  // List known plugin collections
  const plugins = ['finance', 'briefing', 'calendar', 'email', 'documents', 'subscriptions'];
  console.log('\n🔌 Available Plugins:\n');
  for (const p of plugins) {
    console.log(`  • ${p}`);
  }
  storage.close();
}

async function chat(message: string): Promise<void> {
  if (!message) {
    console.log('Usage: aura chat "your message"');
    return;
  }

  const { config, log, storage } = getStorage();
  const ai = createAiAdapter(config.ai, childLogger(log, 'ai'));
  const plugins = new PluginBus(storage, childLogger(log, 'plugins'));
  const scheduler = new Scheduler(childLogger(log, 'sched'));
  const agent = new Agent({ ai, storage, plugins, scheduler, logger: childLogger(log, 'agent') });

  const response = await agent.processMessage(message);
  console.log(`\n${response}\n`);

  scheduler.stopAll();
  storage.close();
}

async function showEmails(): Promise<void> {
  const { storage } = getStorage();
  const emails = storage.sqlite.list('emails');

  if (emails.length === 0) {
    console.log('\n📧 No emails synced yet.\n');
    storage.close();
    return;
  }

  console.log(`\n📧 Recent Emails (${emails.length})\n`);
  for (const row of emails.slice(0, 20)) {
    const e = JSON.parse(row.value);
    const cat = `[${e.category}]`.padEnd(16);
    console.log(`  ${cat} ${e.fromName?.slice(0, 20)?.padEnd(20) ?? 'Unknown'.padEnd(20)} ${e.subject?.slice(0, 50) ?? ''}`);
  }
  storage.close();
}

async function showCalendar(): Promise<void> {
  const { storage } = getStorage();
  const events = storage.sqlite.list('calendar-events');

  if (events.length === 0) {
    console.log('\n📅 No calendar events synced.\n');
    storage.close();
    return;
  }

  console.log(`\n📅 Calendar Events (${events.length})\n`);
  for (const row of events.slice(0, 15)) {
    const e = JSON.parse(row.value);
    const time = e.allDay ? 'All day  ' : (e.start?.slice(11, 16) ?? '     ');
    console.log(`  ${time}  ${e.summary}${e.location ? ` (${e.location})` : ''}`);
  }
  storage.close();
}

async function showSpending(): Promise<void> {
  const { storage } = getStorage();
  const today = new Date().toISOString().slice(0, 10);
  const txns = storage.sqlite.list('transactions')
    .map(r => JSON.parse(r.value))
    .filter((t: { date: string; type: string }) => t.date?.startsWith(today) && t.type === 'debit');

  if (txns.length === 0) {
    console.log('\n💰 No spending today.\n');
    storage.close();
    return;
  }

  const total = txns.reduce((s: number, t: { amount: number }) => s + t.amount, 0);
  console.log(`\n💰 Today's Spending: ₹${total.toFixed(0)}\n`);
  for (const t of txns) {
    console.log(`  • ${(t as { merchant: string }).merchant}: ₹${(t as { amount: number }).amount} (${(t as { category: string }).category})`);
  }
  storage.close();
}

async function showSummary(): Promise<void> {
  const { storage } = getStorage();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const txns = storage.sqlite.list('transactions').map(r => JSON.parse(r.value));

  const debits = txns.filter((t: { type: string; date: string }) => t.type === 'debit' && t.date >= monthStart);
  const credits = txns.filter((t: { type: string; date: string }) => t.type === 'credit' && t.date >= monthStart);

  const spent = debits.reduce((s: number, t: { amount: number }) => s + t.amount, 0);
  const income = credits.reduce((s: number, t: { amount: number }) => s + t.amount, 0);

  console.log(`\n📊 Monthly Summary\n`);
  console.log(`  Income:  ₹${income.toFixed(0)}`);
  console.log(`  Spent:   ₹${spent.toFixed(0)}`);
  console.log(`  Net:     ₹${(income - spent).toFixed(0)}`);
  console.log(`  Transactions: ${debits.length + credits.length}`);
  storage.close();
}

async function showDocs(): Promise<void> {
  const { storage } = getStorage();
  const docs = storage.sqlite.list('documents');

  if (docs.length === 0) {
    console.log('\n📄 Document vault is empty.\n');
    storage.close();
    return;
  }

  console.log(`\n📄 Documents (${docs.length})\n`);
  for (const row of docs) {
    const d = JSON.parse(row.value);
    const cat = `[${d.category}]`.padEnd(14);
    console.log(`  ${cat} ${d.originalName}`);
  }
  storage.close();
}

async function showSubs(): Promise<void> {
  const { storage } = getStorage();
  const subs = storage.sqlite.list('subscriptions')
    .map(r => JSON.parse(r.value))
    .filter((s: { status: string }) => s.status === 'active');

  if (subs.length === 0) {
    console.log('\n🔔 No active subscriptions.\n');
    storage.close();
    return;
  }

  let total = 0;
  console.log(`\n🔔 Subscriptions (${subs.length} active)\n`);
  for (const s of subs) {
    const monthly = s.frequency === 'yearly' ? s.amount / 12 :
                    s.frequency === 'quarterly' ? s.amount / 3 :
                    s.frequency === 'weekly' ? s.amount * 52 / 12 : s.amount;
    total += monthly;
    console.log(`  • ${(s as { name: string }).name}: ₹${monthly.toFixed(0)}/mo (${(s as { frequency: string }).frequency})`);
  }
  console.log(`\n  Total: ₹${total.toFixed(0)}/mo (₹${(total * 12).toFixed(0)}/yr)`);
  storage.close();
}

async function exportData(type: string): Promise<void> {
  const { storage } = getStorage();
  const txns = storage.sqlite.list('transactions').map(r => JSON.parse(r.value));

  if (type === 'finance-csv') {
    console.log('Date,Type,Amount,Currency,Category,Merchant,Description,Source');
    for (const t of txns) {
      const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
      console.log(`${t.date},${t.type},${t.amount},${t.currency},${t.category},${esc(t.merchant)},${esc(t.description)},${t.source}`);
    }
  } else if (type === 'finance-json') {
    console.log(JSON.stringify(txns, null, 2));
  } else {
    console.log(`Unknown export type: ${type}\nAvailable: finance-csv, finance-json`);
  }
  storage.close();
}

async function doctor(): Promise<void> {
  console.log('\n🩺 Aura Health Check\n');

  const { config, storage } = getStorage();

  // AI
  const ai = createAiAdapter(config.ai, createLogger('error'));
  const aiOk = await ai.ping();
  console.log(`  AI Provider:    ${aiOk ? '✅' : '❌'} ${config.ai.provider} / ${config.ai.model}`);

  // Telegram
  if (config.telegram.botToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
      const data = await res.json() as { ok: boolean; result?: { username: string } };
      console.log(`  Telegram:       ${data.ok ? '✅ @' + data.result?.username : '❌ invalid token'}`);
    } catch {
      console.log(`  Telegram:       ❌ unreachable`);
    }
  } else {
    console.log(`  Telegram:       ⚠️  not configured`);
  }

  // Google
  if (config.google.refreshToken) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          refresh_token: config.google.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      console.log(`  Google OAuth:   ${res.ok ? '✅' : '❌'} (Gmail + Calendar)`);
    } catch {
      console.log(`  Google OAuth:   ❌ unreachable`);
    }
  } else {
    console.log(`  Google OAuth:   ⚠️  not configured`);
  }

  // Encryption
  console.log(`  Encryption:     ${config.masterPassword ? '✅ AES-256-GCM' : '⚠️  disabled'}`);

  // SQLite
  try {
    storage.sqlite.audit('doctor:check', {});
    console.log(`  SQLite:         ✅ WAL mode`);
  } catch {
    console.log(`  SQLite:         ❌ error`);
  }

  // OCR
  try {
    const { execSync } = await import('child_process');
    execSync('tesseract --version 2>&1', { encoding: 'utf-8' });
    console.log(`  Tesseract OCR:  ✅`);
  } catch {
    console.log(`  Tesseract OCR:  ❌ not installed`);
  }

  // Data counts
  const emails = storage.sqlite.list('emails').length;
  const events = storage.sqlite.list('calendar-events').length;
  const txns = storage.sqlite.list('transactions').length;
  const docs = storage.sqlite.list('documents').length;
  const subs = storage.sqlite.list('subscriptions').length;

  console.log(`\n  Data: ${emails} emails, ${events} events, ${txns} transactions, ${docs} docs, ${subs} subs\n`);

  storage.close();
}

main().catch(err => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
