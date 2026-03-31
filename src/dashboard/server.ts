import http from 'http';
import { URL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import type { MemoryStore } from '../core/storage/index.js';
import type { PluginBus } from '../core/plugin-bus.js';
import type { Agent } from '../core/agent.js';
import type { Scheduler } from '../core/scheduler.js';
import type { Logger } from '../core/logger.js';

// ─── Auth Config ──────────────────────────────────────────────────────────────
const DASHBOARD_USER = process.env['DASHBOARD_USER'] || 'admin';
const DASHBOARD_PASSWORD = process.env['DASHBOARD_PASSWORD'] || 'aura2026';
const JWT_SECRET = process.env['JWT_SECRET'] || createHmac('sha256', 'aura-default').update(DASHBOARD_PASSWORD).digest('hex');
const JWT_EXPIRY = '7d';

// Public paths that don't require auth
const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/check']);

interface DashboardConfig { port: number; host: string; }

export class Dashboard {
  private server: http.Server;
  private storage: MemoryStore;
  private plugins: PluginBus;
  private agent: Agent;
  private scheduler: Scheduler;
  private log: Logger;

  constructor(config: DashboardConfig, storage: MemoryStore, plugins: PluginBus, agent: Agent, scheduler: Scheduler, logger: Logger) {
    this.storage = storage;
    this.plugins = plugins;
    this.agent = agent;
    this.scheduler = scheduler;
    this.log = logger;
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.listen(config.port, config.host, () => {
      this.log.info(`Dashboard running at http://${config.host}:${config.port}`);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      // ── Login endpoint ────────────────────────────────────────────────────
      if (p === '/api/auth/login' && req.method === 'POST') {
        const body = await this.body(req) as { username?: string; password?: string };
        const userOk = body.username === DASHBOARD_USER;
        const passOk = (() => {
          try {
            const a = Buffer.from(body.password ?? '');
            const b = Buffer.from(DASHBOARD_PASSWORD);
            return a.length === b.length && timingSafeEqual(a, b);
          } catch { return false; }
        })();
        if (userOk && passOk) {
          const token = jwt.sign({ user: DASHBOARD_USER, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
          return this.json(res, { ok: true, token, user: DASHBOARD_USER });
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
        return;
      }

      // ── Auth check (validate existing token) ──────────────────────────────
      if (p === '/api/auth/check') {
        const token = this.extractToken(req);
        if (!token) { res.writeHead(401); res.end(JSON.stringify({ ok: false })); return; }
        try {
          const payload = jwt.verify(token, JWT_SECRET) as { user: string; role: string };
          return this.json(res, { ok: true, user: payload.user, role: payload.role });
        } catch {
          res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'Token expired or invalid' })); return;
        }
      }

      // ── Auth middleware: protect all /api/* except public paths ──────────
      if (p.startsWith('/api') && !PUBLIC_PATHS.has(p)) {
        const token = this.extractToken(req);
        if (!token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized — login required' }));
          return;
        }
        try {
          jwt.verify(token, JWT_SECRET);
        } catch {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token expired — please login again' }));
          return;
        }
      }

      // Serve React dashboard (static files)
      if (!p.startsWith('/api')) {
        const dashDir = join(process.cwd(), 'dist-dashboard');
        if (existsSync(dashDir)) {
          let filePath = join(dashDir, p === '/' ? 'index.html' : p);
          if (!existsSync(filePath)) filePath = join(dashDir, 'index.html'); // SPA fallback
          const mimeTypes: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
          const mime = mimeTypes[extname(filePath)] ?? 'application/octet-stream';
          try {
            const content = readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': p === '/index.html' || p === '/' ? 'no-cache' : 'public,max-age=31536000,immutable' });
            res.end(content);
          } catch { res.writeHead(404); res.end('Not found'); }
          return;
        }
        // Fallback if no React build
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body style="background:#060608;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Run npm run build in dashboard-ui/ first</h1></body></html>'); return;
      }
      if (p === '/api/status') return this.json(res, await this.status());
      if (p === '/api/plugins') return this.json(res, this.plugins.listPlugins());
      if (p === '/api/emails') return this.json(res, this.data('emails', +(url.searchParams.get('limit') ?? 30)));
      if (p === '/api/calendar') {
        const events = this.data('calendar-events', 100);
        const now = new Date().toISOString();
        const upcoming = events.filter((e: any) => (e.end || e.start) >= now);
        return this.json(res, upcoming.slice(0, 30));
      }
      if (p === '/api/transactions') return this.json(res, this.data('transactions', +(url.searchParams.get('limit') ?? 200)));

      // ── Finance Query API (for Alexa, Google Assistant, future voice integrations) ──
      if (p === '/api/finance/query' && req.method === 'POST') {
        const body = await this.body(req) as { query?: string; intent?: string; params?: Record<string, string> };
        const txs = this.data('transactions', 500) as Array<Record<string, unknown>>;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const q = (body.query || '').toLowerCase();
        const intent = body.intent;

        // Natural language finance queries
        let result: Record<string, unknown> = {};

        // "How much did I spend this month?"
        if (intent === 'monthly_spend' || /spend.*month|month.*spend|this month/i.test(q)) {
          const total = txs.filter((t: any) => t.type === 'debit' && t.date >= monthStart)
            .reduce((s: number, t: any) => s + (t.amount || 0), 0);
          result = { intent: 'monthly_spend', amount: total, currency: 'INR',
            answer: `You spent ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} this month` };
        }
        // "What did I spend on food?"
        else if (intent === 'category_spend' || /spend.*on\s+(\w+)|(\w+)\s+spend/i.test(q)) {
          const catMatch = q.match(/spend.*on\s+(\w+)|(\w+)\s+spend|(\w+)\s+expense/i);
          const cat = catMatch?.[1] || catMatch?.[2] || catMatch?.[3] || body.params?.category;
          if (cat) {
            const total = txs.filter((t: any) => t.type === 'debit' && t.category?.toLowerCase().includes(cat.toLowerCase()))
              .reduce((s: number, t: any) => s + (t.amount || 0), 0);
            result = { intent: 'category_spend', category: cat, amount: total, currency: 'INR',
              answer: `You spent ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} on ${cat}` };
          }
        }
        // "What's my biggest expense?"
        else if (intent === 'biggest_expense' || /biggest|largest|highest|most expensive/i.test(q)) {
          const top = [...txs].filter((t: any) => t.type === 'debit').sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0))[0] as any;
          if (top) result = { intent: 'biggest_expense', transaction: top,
            answer: `Your biggest expense is ₹${(top.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} to ${top.merchant || 'unknown'} for ${top.category}` };
        }
        // "Show my recent transactions"
        else if (intent === 'recent' || /recent|latest|last.*transaction/i.test(q)) {
          const recent = txs.slice(0, 5);
          result = { intent: 'recent', transactions: recent,
            answer: `Your last ${recent.length} transactions: ${(recent as any[]).map((t: any) => `${t.type === 'debit' ? '-' : '+'}₹${(t.amount || 0).toFixed(0)} ${t.merchant || t.category}`).join(', ')}` };
        }
        // "How much did I spend this week?"
        else if (intent === 'weekly_spend' || /this week|week.*spend/i.test(q)) {
          const total = txs.filter((t: any) => t.type === 'debit' && t.date >= weekStart)
            .reduce((s: number, t: any) => s + (t.amount || 0), 0);
          result = { intent: 'weekly_spend', amount: total, currency: 'INR',
            answer: `You spent ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} this week` };
        }
        // Summary
        else {
          const totalDebit = txs.filter((t: any) => t.type === 'debit').reduce((s: number, t: any) => s + (t.amount || 0), 0);
          const totalCredit = txs.filter((t: any) => t.type === 'credit').reduce((s: number, t: any) => s + (t.amount || 0), 0);
          const thisMonth = txs.filter((t: any) => t.type === 'debit' && t.date >= monthStart).reduce((s: number, t: any) => s + (t.amount || 0), 0);
          const categories = [...new Map(txs.filter((t: any) => t.type === 'debit').map((t: any) => [t.category, t])).values()];
          result = { intent: 'summary', totalDebit, totalCredit, thisMonth, topCategories: categories.slice(0, 5),
            answer: `Total spent: ₹${totalDebit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}. This month: ₹${thisMonth.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` };
        }

        return this.json(res, result);
      }
      if (p === '/api/documents') return this.json(res, this.data('documents', 50));

      // Bills with due dates extracted from email
      if (p === '/api/bills') {
        const emails = this.data('emails', 500) as Array<Record<string, unknown>>;
        const bills = emails
          .filter((e: any) => e.category === 'bill' && e.extractedData)
          .map((e: any) => ({
            id: e.id,
            vendor: e.extractedData?.vendor || e.fromName || 'Unknown',
            subject: e.subject,
            amount: e.extractedData?.amount || 0,
            minimumDue: e.extractedData?.minimumDue,
            currency: e.extractedData?.currency || 'INR',
            dueDate: e.extractedData?.dueDate || '',
            billType: e.extractedData?.billType || 'other',
            cardLast4: e.extractedData?.cardLast4,
            date: e.date,
            accountId: e.accountId,
          }))
          .sort((a: any, b: any) => {
            // Sort by due date (soonest first)
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          });
        return this.json(res, bills);
      }
      if (p === '/api/subscriptions') return this.json(res, this.data('subscriptions', 50));
      if (p === '/api/audit') return this.json(res, this.storage.sqlite.auditQuery({ limit: 50 }));
      if (p === '/api/cache') return this.json(res, this.storage.cache.stats());
      if (p === '/api/whatsapp' && req.method === 'POST') {
        const body = await this.bodyRaw(req);
        const { WhatsAppChannel } = await import('../channels/whatsapp.js');
        const wa = new WhatsAppChannel({ phoneNumberId: process.env['WA_PHONE_NUMBER_ID'] ?? '', accessToken: process.env['WA_ACCESS_TOKEN'] ?? '', verifyToken: process.env['WA_VERIFY_TOKEN'] ?? '' }, this.agent, this.log);
        await wa.handleWebhook(body); return this.json(res, { ok: true });
      }
      if (p === '/api/whatsapp' && req.method === 'GET') {
        const mode = url.searchParams.get('hub.mode') ?? '';
        const tok = url.searchParams.get('hub.verify_token') ?? '';
        const ch = url.searchParams.get('hub.challenge') ?? '';
        if (mode === 'subscribe' && tok === (process.env['WA_VERIFY_TOKEN'] ?? 'aura-verify')) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(ch); return; }
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (p === '/api/alexa' && req.method === 'POST') {
        const body = await this.bodyRaw(req);
        const { AlexaChannel } = await import('../channels/alexa.js');
        return this.json(res, await new AlexaChannel(this.agent, this.log).handleRequest(body));
      }
      if (p === '/api/google-home' && req.method === 'POST') {
        const body = await this.bodyRaw(req);
        const { GoogleHomeChannel } = await import('../channels/google-home.js');
        return this.json(res, await new GoogleHomeChannel(this.agent, this.log).handleRequest(body));
      }
      if (p === '/api/ha/states') return this.json(res, this.data('ha-states', 100));
      if (p === '/api/push/register' && req.method === 'POST') {
        const { userId, platform, token, deviceName } = await this.body(req);
        this.storage.set('push-tokens', `${userId}:${platform}`, { userId, platform, token, deviceName, registeredAt: new Date().toISOString() });
        return this.json(res, { ok: true });
      }
      if (p === '/api/chat' && req.method === 'POST') {
        const { message } = await this.body(req);
        const msg = message as string;
        if (!msg) return this.json(res, { error: 'message required' }, 400);
        const response = await this.agent.processMessage(msg, { channel: 'dashboard' });
        return this.json(res, { response });
      }
      this.json(res, { error: 'Not found' }, 404);
    } catch (err) { this.log.error(`Dashboard: ${err}`); this.json(res, { error: String(err) }, 500); }
  }

  private extractToken(req: http.IncomingMessage): string | null {
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }

  private data(col: string, limit: number) { return this.storage.sqlite.list(col).slice(0, limit).map(r => JSON.parse(r.value)); }
  private async status() {
    const m = process.memoryUsage();
    return {
      version: '1.0.0', uptime: Math.floor(process.uptime()),
      memory: { heap: Math.round(m.heapUsed / 1048576), total: Math.round(m.heapTotal / 1048576) },
      plugins: this.plugins.listPlugins(), scheduler: this.scheduler.list().length, cache: this.storage.cache.stats(),
      data: { emails: this.storage.sqlite.list('emails').length, events: this.storage.sqlite.list('calendar-events').length, transactions: this.storage.sqlite.list('transactions').length, documents: this.storage.sqlite.list('documents').length, subscriptions: this.storage.sqlite.list('subscriptions').length },
    };
  }
  private json(res: http.ServerResponse, d: unknown, s = 200) { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); }
  private bodyRaw(req: http.IncomingMessage): Promise<string> {
    return new Promise((ok, no) => {
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => ok(b));
      req.on('error', no);
    });
  }

  private async body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await this.bodyRaw(req);
    try { return JSON.parse(raw); } catch { return {}; }
  }
  stop() { this.server.close(); }
}

// ─────────────────────────── HTML ───────────────────────────

