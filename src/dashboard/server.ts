import http from 'http';
import { URL } from 'url';
import type { MemoryStore } from '../core/storage/index.js';
import type { PluginBus } from '../core/plugin-bus.js';
import type { Agent } from '../core/agent.js';
import type { Scheduler } from '../core/scheduler.js';
import type { Logger } from '../core/logger.js';

interface DashboardConfig {
  port: number;
  host: string;
}

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

    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    this.server.listen(config.port, config.host, () => {
      this.log.info(`Dashboard running at http://${config.host}:${config.port}`);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const path = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getHtml());
        return;
      }

      // API routes
      if (path === '/api/status') {
        this.json(res, await this.getStatus());
      } else if (path === '/api/plugins') {
        this.json(res, this.plugins.listPlugins());
      } else if (path === '/api/emails') {
        const limit = parseInt(url.searchParams.get('limit') ?? '20');
        this.json(res, this.getData('emails', limit));
      } else if (path === '/api/calendar') {
        this.json(res, this.getData('calendar-events', 30));
      } else if (path === '/api/transactions') {
        const limit = parseInt(url.searchParams.get('limit') ?? '50');
        this.json(res, this.getData('transactions', limit));
      } else if (path === '/api/documents') {
        this.json(res, this.getData('documents', 50));
      } else if (path === '/api/subscriptions') {
        this.json(res, this.getData('subscriptions', 50));
      } else if (path === '/api/audit') {
        const limit = parseInt(url.searchParams.get('limit') ?? '50');
        this.json(res, this.storage.sqlite.auditQuery({ limit }));
      } else if (path === '/api/cache') {
        this.json(res, this.storage.cache.stats());
      } else if (path === '/api/chat' && req.method === 'POST') {
        const body = await this.readBody(req);
        const { message } = JSON.parse(body);
        if (!message) { this.json(res, { error: 'message required' }, 400); return; }
        const response = await this.agent.processMessage(message, { channel: 'dashboard' });
        this.json(res, { response });
      } else {
        this.json(res, { error: 'Not found' }, 404);
      }
    } catch (err) {
      this.log.error(`Dashboard error: ${err}`);
      this.json(res, { error: String(err) }, 500);
    }
  }

  private getData(collection: string, limit: number): unknown[] {
    return this.storage.sqlite.list(collection)
      .slice(0, limit)
      .map(row => JSON.parse(row.value));
  }

  private async getStatus() {
    const mem = process.memoryUsage();
    return {
      version: '0.4.0',
      uptime: Math.floor(process.uptime()),
      memory: { heapUsed: Math.round(mem.heapUsed / 1024 / 1024), heapTotal: Math.round(mem.heapTotal / 1024 / 1024) },
      plugins: this.plugins.listPlugins(),
      scheduler: this.scheduler.list().length,
      cache: this.storage.cache.stats(),
      data: {
        emails: this.storage.sqlite.list('emails').length,
        events: this.storage.sqlite.list('calendar-events').length,
        transactions: this.storage.sqlite.list('transactions').length,
        documents: this.storage.sqlite.list('documents').length,
        subscriptions: this.storage.sqlite.list('subscriptions').length,
      },
    };
  }

  private json(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  stop(): void {
    this.server.close();
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aura Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0F0F0F; color: #E0E0E0; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #1a0a05, #2a1510); padding: 20px 30px; border-bottom: 1px solid #3a2015; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 24px; color: #D4A843; letter-spacing: 3px; }
  .header .status { font-size: 12px; color: #6B8F71; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; padding: 20px; }
  .card { background: #1A1A1A; border: 1px solid #2A2A2A; border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 14px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
  .stat { font-size: 36px; font-weight: 700; color: #D4A843; }
  .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
  .list-item { padding: 8px 0; border-bottom: 1px solid #222; font-size: 13px; }
  .list-item:last-child { border: none; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: #2a1510; color: #D4A843; }
  .chat-box { grid-column: 1 / -1; }
  .chat-input { display: flex; gap: 8px; margin-top: 12px; }
  .chat-input input { flex: 1; padding: 10px; background: #222; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 14px; outline: none; }
  .chat-input button { padding: 10px 20px; background: #D4A843; color: #000; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .chat-messages { max-height: 300px; overflow-y: auto; margin-top: 12px; }
  .msg { padding: 8px 12px; margin: 4px 0; border-radius: 8px; font-size: 13px; }
  .msg.user { background: #2a1510; text-align: right; }
  .msg.bot { background: #1a2a1a; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11px; }
  .pill.active { background: #1a2a1a; color: #6B8F71; }
  .pill.inactive { background: #2a1a1a; color: #8F6B6B; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>🔱 AURA</h1>
  <div class="status" id="status">Loading...</div>
</div>
<div class="grid" id="grid"></div>

<script>
async function load() {
  const status = await (await fetch('/api/status')).json();
  document.getElementById('status').textContent = 'v' + status.version + ' • ' + formatUptime(status.uptime) + ' • ' + status.memory.heapUsed + 'MB';

  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  // Stats row
  grid.innerHTML += card('📊 Overview', \`
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      <div><div class="stat">\${status.data.emails}</div><div class="stat-label">Emails</div></div>
      <div><div class="stat">\${status.data.transactions}</div><div class="stat-label">Transactions</div></div>
      <div><div class="stat">\${status.data.documents}</div><div class="stat-label">Documents</div></div>
    </div>
  \`);

  // Plugins
  const pluginHtml = status.plugins.map(p => \`<span class="pill \${p.state}">\${p.name} v\${p.version}</span>\`).join(' ');
  grid.innerHTML += card('🔌 Plugins (' + status.plugins.length + ')', pluginHtml);

  // Emails
  const emails = await (await fetch('/api/emails?limit=10')).json();
  const emailHtml = emails.map(e => \`<div class="list-item"><span class="tag">\${e.category}</span> <b>\${esc(e.fromName || 'Unknown')}</b> — \${esc((e.subject||'').slice(0,40))}</div>\`).join('');
  grid.innerHTML += card('📧 Recent Emails', emailHtml || '<div style="color:#666">No emails yet</div>');

  // Subscriptions
  const subs = await (await fetch('/api/subscriptions')).json();
  const subHtml = subs.filter(s=>s.status==='active').map(s => \`<div class="list-item">\${esc(s.name)}: ₹\${s.amount}/\${s.frequency}</div>\`).join('');
  grid.innerHTML += card('🔔 Subscriptions', subHtml || '<div style="color:#666">None tracked</div>');

  // Chat
  grid.innerHTML += \`<div class="card chat-box"><h2>💬 Chat with Aura</h2><div class="chat-messages" id="msgs"></div><div class="chat-input"><input id="chatIn" placeholder="Ask Aura anything..." onkeypress="if(event.key==='Enter')sendMsg()"><button onclick="sendMsg()">Send</button></div></div>\`;
}

async function sendMsg() {
  const input = document.getElementById('chatIn');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  const msgs = document.getElementById('msgs');
  msgs.innerHTML += '<div class="msg user">' + esc(msg) + '</div>';
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await (await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})})).json();
    msgs.innerHTML += '<div class="msg bot">' + esc(res.response) + '</div>';
  } catch(e) {
    msgs.innerHTML += '<div class="msg bot" style="color:#8F6B6B">Error: ' + e.message + '</div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function card(title, body) { return '<div class="card"><h2>' + title + '</h2>' + body + '</div>'; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatUptime(s) { const h=Math.floor(s/3600),m=Math.floor(s%3600/60); return h+'h '+m+'m'; }

load();
setInterval(load, 30000);
</script>
</body>
</html>`;
  }
}
