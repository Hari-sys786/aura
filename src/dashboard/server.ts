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
      } else if (path === '/api/alexa' && req.method === 'POST') {
        // Alexa webhook endpoint
        const body = await this.readBody(req);
        const { AlexaChannel } = await import('../channels/alexa.js');
        const alexa = new AlexaChannel(this.agent, this.log);
        const alexaRes = await alexa.handleRequest(body);
        this.json(res, alexaRes);
      } else if (path === '/api/google-home' && req.method === 'POST') {
        // Google Home webhook endpoint
        const body = await this.readBody(req);
        const { GoogleHomeChannel } = await import('../channels/google-home.js');
        const gh = new GoogleHomeChannel(this.agent, this.log);
        const ghRes = await gh.handleRequest(body);
        this.json(res, ghRes);
      } else if (path === '/api/ha/states') {
        this.json(res, this.getData('ha-states', 100));
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
<title>Aura — Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #09090b;
  --surface: #18181b;
  --surface-2: #1f1f23;
  --border: #27272a;
  --border-hover: #3f3f46;
  --text: #fafafa;
  --text-muted: #a1a1aa;
  --text-dim: #71717a;
  --accent: #f59e0b;
  --accent-dim: rgba(245,158,11,0.1);
  --green: #22c55e;
  --green-dim: rgba(34,197,94,0.1);
  --red: #ef4444;
  --red-dim: rgba(239,68,68,0.1);
  --blue: #3b82f6;
  --blue-dim: rgba(59,130,246,0.1);
  --radius: 12px;
}

* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; -webkit-font-smoothing:antialiased; }

/* Header */
.hdr { padding:20px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); position:sticky; top:0; background:rgba(9,9,11,0.85); backdrop-filter:blur(12px); z-index:100; }
.hdr-left { display:flex; align-items:center; gap:12px; }
.hdr h1 { font-size:20px; font-weight:700; letter-spacing:1px; }
.hdr h1 span { color:var(--accent); }
.hdr-badge { font-size:11px; padding:3px 10px; border-radius:20px; background:var(--accent-dim); color:var(--accent); font-weight:600; }
.hdr-meta { font-size:12px; color:var(--text-dim); font-family:'JetBrains Mono',monospace; }

/* Layout */
.container { max-width:1400px; margin:0 auto; padding:20px; }
.stats-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:20px; }
.main-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }

/* Cards */
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; transition:border-color 0.2s; }
.card:hover { border-color:var(--border-hover); }
.card-hdr { padding:16px 20px 12px; display:flex; justify-content:space-between; align-items:center; }
.card-title { font-size:13px; font-weight:600; color:var(--text-muted); letter-spacing:0.5px; text-transform:uppercase; }
.card-count { font-size:12px; color:var(--text-dim); font-family:'JetBrains Mono',monospace; }
.card-body { padding:0 20px 16px; }

/* Stat cards */
.stat-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:20px; }
.stat-val { font-size:32px; font-weight:700; font-family:'JetBrains Mono',monospace; line-height:1; }
.stat-label { font-size:12px; color:var(--text-dim); margin-top:6px; }
.stat-card.accent .stat-val { color:var(--accent); }
.stat-card.green .stat-val { color:var(--green); }
.stat-card.blue .stat-val { color:var(--blue); }

/* List items */
.li { padding:10px 0; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; font-size:13px; }
.li:last-child { border:none; }
.li-tag { font-size:10px; padding:2px 8px; border-radius:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; flex-shrink:0; }
.li-tag.bill { background:var(--red-dim); color:var(--red); }
.li-tag.newsletter { background:var(--blue-dim); color:var(--blue); }
.li-tag.personal { background:var(--green-dim); color:var(--green); }
.li-tag.work { background:rgba(168,85,247,0.1); color:#a855f7; }
.li-tag.action_required { background:var(--accent-dim); color:var(--accent); }
.li-tag.fyi { background:rgba(100,116,139,0.1); color:#94a3b8; }
.li-from { font-weight:600; color:var(--text); min-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.li-subject { color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.li-date { color:var(--text-dim); font-size:11px; font-family:'JetBrains Mono',monospace; flex-shrink:0; }

/* Plugins */
.pill { display:inline-flex; align-items:center; gap:5px; padding:5px 12px; border-radius:20px; font-size:12px; font-weight:500; margin:3px; }
.pill::before { content:''; width:6px; height:6px; border-radius:50%; }
.pill.active { background:var(--green-dim); color:var(--green); }
.pill.active::before { background:var(--green); }
.pill.inactive { background:var(--red-dim); color:var(--red); }
.pill.inactive::before { background:var(--red); }

/* Chat */
.chat-card { grid-column:1/-1; }
.chat-msgs { max-height:280px; overflow-y:auto; padding:0; scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
.msg { padding:10px 14px; margin:6px 0; border-radius:10px; font-size:13px; line-height:1.5; max-width:85%; word-wrap:break-word; }
.msg.user { background:var(--accent-dim); color:var(--accent); margin-left:auto; text-align:right; border-bottom-right-radius:3px; }
.msg.bot { background:var(--surface-2); color:var(--text); border-bottom-left-radius:3px; }
.chat-input { display:flex; gap:8px; margin-top:12px; }
.chat-input input { flex:1; padding:12px 16px; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; color:var(--text); font-size:14px; font-family:'DM Sans',sans-serif; outline:none; transition:border 0.2s; }
.chat-input input:focus { border-color:var(--accent); }
.chat-input input::placeholder { color:var(--text-dim); }
.chat-input button { padding:12px 24px; background:var(--accent); color:#000; border:none; border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:opacity 0.2s; }
.chat-input button:hover { opacity:0.85; }

/* Empty state */
.empty { text-align:center; padding:30px; color:var(--text-dim); font-size:13px; }

/* Responsive */
@media(max-width:900px) {
  .main-grid { grid-template-columns:1fr; }
  .stats-row { grid-template-columns:repeat(2,1fr); }
}
@media(max-width:480px) {
  .container { padding:12px; }
  .stats-row { grid-template-columns:1fr; }
  .hdr { padding:14px 16px; }
  .hdr h1 { font-size:16px; }
  .stat-val { font-size:24px; }
  .li-from { min-width:80px; }
}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-left">
    <h1>🔱 <span>AURA</span></h1>
    <span class="hdr-badge" id="ver">v0.4</span>
  </div>
  <div class="hdr-meta" id="meta">loading...</div>
</div>

<div class="container">
  <div class="stats-row" id="stats"></div>
  <div class="main-grid" id="grid"></div>
</div>

<script>
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ago = d => { if(!d)return''; const s=Math.floor((Date.now()-new Date(d).getTime())/1000); if(s<60)return s+'s'; if(s<3600)return Math.floor(s/60)+'m'; if(s<86400)return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d'; };

async function load() {
  try {
    const [status, emails, subs] = await Promise.all([
      fetch('/api/status').then(r=>r.json()),
      fetch('/api/emails?limit=12').then(r=>r.json()),
      fetch('/api/subscriptions').then(r=>r.json()),
    ]);

    // Header
    const up = status.uptime;
    const h = Math.floor(up/3600), m = Math.floor(up%3600/60);
    document.getElementById('meta').textContent = h+'h '+m+'m · '+status.memory.heapUsed+'MB · '+status.plugins.length+' plugins';

    // Stats
    document.getElementById('stats').innerHTML = [
      statCard(status.data.emails, 'Emails', 'accent'),
      statCard(status.data.transactions, 'Transactions', 'blue'),
      statCard(status.data.documents, 'Documents', 'green'),
      statCard(status.data.subscriptions, 'Subscriptions', 'accent'),
      statCard(status.scheduler, 'Scheduled Tasks', 'blue'),
      statCard(status.data.events, 'Calendar Events', 'green'),
    ].join('');

    // Grid
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // Plugins
    grid.innerHTML += card('🔌 Plugins', status.plugins.map(p=>'<span class="pill '+p.state+'">'+esc(p.name)+' v'+esc(p.version)+'</span>').join(''));

    // Subscriptions
    const activeSubs = subs.filter(s=>s.status==='active');
    if (activeSubs.length) {
      const subLines = activeSubs.map(s=>'<div class="li"><span class="li-from">'+esc(s.name)+'</span><span class="li-subject">'+s.currency+' '+s.amount+'/'+s.frequency+'</span><span class="li-tag active">'+s.category+'</span></div>').join('');
      grid.innerHTML += card('🔔 Subscriptions', subLines, activeSubs.length);
    } else {
      grid.innerHTML += card('🔔 Subscriptions', '<div class="empty">No subscriptions tracked yet</div>');
    }

    // Emails
    if (emails.length) {
      const emailLines = emails.map(e=>'<div class="li"><span class="li-tag '+(e.category||'fyi')+'">'+esc(e.category||'?')+'</span><span class="li-from">'+esc(e.fromName||'Unknown')+'</span><span class="li-subject">'+esc((e.subject||'').slice(0,50))+'</span><span class="li-date">'+ago(e.date)+'</span></div>').join('');
      grid.innerHTML += card('📧 Emails', emailLines, emails.length);
    } else {
      grid.innerHTML += card('📧 Emails', '<div class="empty">No emails synced yet</div>');
    }

    // Chat (always last, full width)
    if (!document.getElementById('chatMsgs')) {
      grid.innerHTML += '<div class="card chat-card"><div class="card-hdr"><span class="card-title">💬 Chat with Aura</span></div><div class="card-body"><div class="chat-msgs" id="chatMsgs"></div><div class="chat-input"><input id="chatIn" placeholder="Ask anything..." onkeypress="if(event.key===\\'Enter\\')sendMsg()"><button onclick="sendMsg()">Send</button></div></div></div>';
    }
  } catch(e) { console.error('Load failed:', e); }
}

function statCard(val, label, cls) {
  return '<div class="stat-card '+cls+'"><div class="stat-val">'+val+'</div><div class="stat-label">'+label+'</div></div>';
}

function card(title, body, count) {
  const c = count !== undefined ? '<span class="card-count">'+count+'</span>' : '';
  return '<div class="card"><div class="card-hdr"><span class="card-title">'+title+'</span>'+c+'</div><div class="card-body">'+body+'</div></div>';
}

async function sendMsg() {
  const input = document.getElementById('chatIn');
  const msg = input.value.trim();
  if(!msg) return;
  input.value = '';
  const msgs = document.getElementById('chatMsgs');
  msgs.innerHTML += '<div class="msg user">'+esc(msg)+'</div>';
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await(await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})})).json();
    msgs.innerHTML += '<div class="msg bot">'+esc(res.response||res.error)+'</div>';
  } catch(e) {
    msgs.innerHTML += '<div class="msg bot" style="color:var(--red)">Error: '+e.message+'</div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

load();
// No auto-refresh - load once, user can refresh manually
</script>
</body>
</html>`;
  }
}
