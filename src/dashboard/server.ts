import http from 'http';
import { URL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { MemoryStore } from '../core/storage/index.js';
import type { PluginBus } from '../core/plugin-bus.js';
import type { Agent } from '../core/agent.js';
import type { Scheduler } from '../core/scheduler.js';
import type { Logger } from '../core/logger.js';

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
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
      if (p === '/api/calendar') return this.json(res, this.data('calendar-events', 30));
      if (p === '/api/transactions') return this.json(res, this.data('transactions', 50));
      if (p === '/api/documents') return this.json(res, this.data('documents', 50));
      if (p === '/api/subscriptions') return this.json(res, this.data('subscriptions', 50));
      if (p === '/api/audit') return this.json(res, this.storage.sqlite.auditQuery({ limit: 50 }));
      if (p === '/api/cache') return this.json(res, this.storage.cache.stats());
      if (p === '/api/whatsapp' && req.method === 'POST') {
        const body = await this.body(req);
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
        const body = await this.body(req);
        const { AlexaChannel } = await import('../channels/alexa.js');
        return this.json(res, await new AlexaChannel(this.agent, this.log).handleRequest(body));
      }
      if (p === '/api/google-home' && req.method === 'POST') {
        const body = await this.body(req);
        const { GoogleHomeChannel } = await import('../channels/google-home.js');
        return this.json(res, await new GoogleHomeChannel(this.agent, this.log).handleRequest(body));
      }
      if (p === '/api/ha/states') return this.json(res, this.data('ha-states', 100));
      if (p === '/api/push/register' && req.method === 'POST') {
        const { userId, platform, token, deviceName } = JSON.parse(await this.body(req));
        this.storage.set('push-tokens', `${userId}:${platform}`, { userId, platform, token, deviceName, registeredAt: new Date().toISOString() });
        return this.json(res, { ok: true });
      }
      if (p === '/api/chat' && req.method === 'POST') {
        const { message } = JSON.parse(await this.body(req));
        if (!message) return this.json(res, { error: 'message required' }, 400);
        const response = await this.agent.processMessage(message, { channel: 'dashboard' });
        return this.json(res, { response });
      }
      this.json(res, { error: 'Not found' }, 404);
    } catch (err) { this.log.error(`Dashboard: ${err}`); this.json(res, { error: String(err) }, 500); }
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
  private body(req: http.IncomingMessage): Promise<string> { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); req.on('error', no); }); }
  stop() { this.server.close(); }
}

// ─────────────────────────── HTML ───────────────────────────

