import http from 'http';
import { URL } from 'url';
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
      if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); return; }
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
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aura</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#060608;--s1:#0c0c10;--s2:#121218;--s3:#1a1a22;
  --b1:#1e1e28;--b2:#2a2a36;
  --t1:#f0f0f5;--t2:#a0a0b5;--t3:#65657a;
  --acc:#e8a03e;--acc2:#f0b860;--accdim:rgba(232,160,62,.08);
  --g:#34d399;--gdim:rgba(52,211,153,.08);
  --r:#f87171;--rdim:rgba(248,113,113,.08);
  --b:#60a5fa;--bdim:rgba(96,165,250,.08);
  --p:#c084fc;--pdim:rgba(192,132,252,.08);
  --rad:10px;--trans:all .2s ease;
}
body{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased}

/* HEADER */
header{position:sticky;top:0;z-index:50;background:rgba(6,6,8,.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--b1);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px}
.logo h1{font-size:18px;font-weight:700;letter-spacing:2px;color:var(--acc)}
.logo .v{font-size:10px;padding:2px 8px;background:var(--accdim);color:var(--acc);border-radius:10px;font-weight:600}
.meta{font:12px/1 'JetBrains Mono',monospace;color:var(--t3)}

/* LAYOUT */
main{max-width:1440px;margin:0 auto;padding:24px 28px}
.row{display:grid;gap:14px;margin-bottom:14px}
.r6{grid-template-columns:repeat(6,1fr)}
.r3{grid-template-columns:repeat(3,1fr)}
.r2{grid-template-columns:1fr 1fr}
.r1{grid-template-columns:1fr}

/* STAT CARD */
.sc{background:var(--s1);border:1px solid var(--b1);border-radius:var(--rad);padding:18px 20px;transition:var(--trans)}
.sc:hover{border-color:var(--b2);background:var(--s2)}
.sc .n{font:600 28px/1 'JetBrains Mono',monospace;margin-bottom:4px}
.sc .l{font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:1px;font-weight:500}
.sc.a .n{color:var(--acc)}.sc.g .n{color:var(--g)}.sc.b .n{color:var(--b)}.sc.p .n{color:var(--p)}.sc.r .n{color:var(--r)}

/* CARD */
.cd{background:var(--s1);border:1px solid var(--b1);border-radius:var(--rad);overflow:hidden;transition:var(--trans)}
.cd:hover{border-color:var(--b2)}
.cd-h{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--b1)}
.cd-t{font-size:12px;color:var(--t3);text-transform:uppercase;letter-spacing:1px;font-weight:600}
.cd-c{font:11px/1 'JetBrains Mono',monospace;color:var(--t3)}
.cd-b{padding:6px 0;max-height:360px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b1) transparent}

/* LIST ITEM */
.li{display:flex;align-items:center;gap:10px;padding:9px 18px;font-size:13px;border-bottom:1px solid rgba(30,30,40,.5);transition:background .15s}
.li:last-child{border:none}
.li:hover{background:var(--s2)}
.tag{font-size:9px;padding:2px 7px;border-radius:4px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;flex-shrink:0;min-width:70px;text-align:center}
.tag.bill{background:var(--rdim);color:var(--r)}
.tag.newsletter{background:var(--bdim);color:var(--b)}
.tag.personal{background:var(--gdim);color:var(--g)}
.tag.work{background:var(--pdim);color:var(--p)}
.tag.action_required{background:var(--accdim);color:var(--acc)}
.tag.fyi{background:rgba(100,116,139,.1);color:#94a3b8}
.from{font-weight:600;color:var(--t1);min-width:110px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.subj{color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.tm{color:var(--t3);font:11px/1 'JetBrains Mono',monospace;flex-shrink:0}

/* PILLS */
.pills{display:flex;flex-wrap:wrap;gap:6px;padding:14px 18px}
.pill{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:500}
.pill .dot{width:6px;height:6px;border-radius:50%}
.pill.on{background:var(--gdim);color:var(--g)}.pill.on .dot{background:var(--g)}
.pill.off{background:var(--rdim);color:var(--r)}.pill.off .dot{background:var(--r)}

/* CHAT */
.chat{grid-column:1/-1}
.msgs{max-height:260px;overflow-y:auto;padding:8px 18px;scrollbar-width:thin;scrollbar-color:var(--b1) transparent}
.msg{padding:10px 14px;margin:5px 0;border-radius:10px;font-size:13px;line-height:1.55;max-width:80%;word-break:break-word}
.msg.u{background:var(--accdim);color:var(--acc2);margin-left:auto;text-align:right;border-bottom-right-radius:3px}
.msg.a{background:var(--s3);color:var(--t2);border-bottom-left-radius:3px}
.cin{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--b1)}
.cin input{flex:1;padding:11px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font:14px 'Outfit',sans-serif;outline:none;transition:border .2s}
.cin input:focus{border-color:var(--acc)}
.cin input::placeholder{color:var(--t3)}
.cin button{padding:11px 22px;background:var(--acc);color:#000;border:none;border-radius:8px;font:600 14px 'Outfit',sans-serif;cursor:pointer;transition:opacity .15s}
.cin button:hover{opacity:.85}

/* EMPTY */
.empty{padding:28px;text-align:center;color:var(--t3);font-size:13px}

/* RESPONSIVE */
@media(max-width:1100px){.r6{grid-template-columns:repeat(3,1fr)}.r3,.r2{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.r6{grid-template-columns:repeat(2,1fr)}.r3,.r2{grid-template-columns:1fr}main{padding:16px 14px}header{padding:0 14px}.sc .n{font-size:22px}}
@media(max-width:400px){.r6{grid-template-columns:1fr 1fr}.from{min-width:70px;max-width:90px}}
</style>
</head>
<body>
<header>
  <div class="logo"><h1>🔱 AURA</h1><span class="v">v1.0</span></div>
  <div class="meta" id="m">—</div>
</header>
<main id="app"></main>
<script>
const E=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const A=d=>{if(!d)return'';const s=Math.floor((Date.now()-new Date(d).getTime())/1e3);if(s<60)return s+'s';if(s<3600)return(s/60|0)+'m';if(s<86400)return(s/3600|0)+'h';return(s/86400|0)+'d'};
const F=async u=>{try{return await(await fetch(u)).json()}catch{return null}};

async function init(){
  const[st,em,sb]=await Promise.all([F('/api/status'),F('/api/emails?limit=15'),F('/api/subscriptions')]);
  if(!st)return;

  const u=st.uptime,h=u/3600|0,mn=u%3600/60|0;
  document.getElementById('m').textContent=h+'h '+mn+'m · '+st.memory.heap+'MB · '+st.plugins.length+' plugins · '+st.scheduler+' tasks';

  const D=st.data,app=document.getElementById('app');
  app.innerHTML='';

  // Stats
  app.innerHTML+=\`<div class="row r6">
    \${SC(D.emails,'Emails','a')}\${SC(D.transactions,'Transactions','b')}
    \${SC(D.documents,'Documents','g')}\${SC(D.subscriptions,'Subscriptions','p')}
    \${SC(D.events,'Calendar','b')}\${SC(st.scheduler,'Tasks','a')}
  </div>\`;

  // Plugins + Subs
  const plugH=st.plugins.map(p=>\`<span class="pill \${p.state==='active'?'on':'off'}"><span class="dot"></span>\${E(p.name)} \${E(p.version)}</span>\`).join('');
  const actSub=(sb||[]).filter(s=>s.status==='active');
  const subH=actSub.length?actSub.map(s=>\`<div class="li"><span class="from">\${E(s.name)}</span><span class="subj">\${s.currency} \${s.amount}/\${s.frequency}</span><span class="tag on">\${E(s.category)}</span></div>\`).join(''):\`<div class="empty">No subscriptions tracked</div>\`;

  app.innerHTML+=\`<div class="row r2">
    <div class="cd"><div class="cd-h"><span class="cd-t">Plugins</span><span class="cd-c">\${st.plugins.length}</span></div><div class="pills">\${plugH}</div></div>
    <div class="cd"><div class="cd-h"><span class="cd-t">Subscriptions</span><span class="cd-c">\${actSub.length}</span></div><div class="cd-b">\${subH}</div></div>
  </div>\`;

  // Emails
  const emH=(em||[]).length?(em||[]).map(e=>\`<div class="li"><span class="tag \${e.category||'fyi'}">\${E(e.category||'—')}</span><span class="from">\${E(e.fromName||'?')}</span><span class="subj">\${E((e.subject||'').slice(0,60))}</span><span class="tm">\${A(e.date)}</span></div>\`).join(''):\`<div class="empty">No emails synced</div>\`;

  app.innerHTML+=\`<div class="row r1">
    <div class="cd"><div class="cd-h"><span class="cd-t">Recent Emails</span><span class="cd-c">\${(em||[]).length}</span></div><div class="cd-b">\${emH}</div></div>
  </div>\`;

  // Chat
  app.innerHTML+=\`<div class="row r1">
    <div class="cd chat"><div class="cd-h"><span class="cd-t">Chat with Aura</span></div>
    <div class="msgs" id="msgs"></div>
    <div class="cin"><input id="ci" placeholder="Ask anything..." onkeydown="if(event.key==='Enter')S()"><button onclick="S()">Send</button></div></div>
  </div>\`;
}

function SC(v,l,c){return \`<div class="sc \${c}"><div class="n">\${v}</div><div class="l">\${l}</div></div>\`}

async function S(){
  const i=document.getElementById('ci'),t=i.value.trim();if(!t)return;i.value='';
  const ms=document.getElementById('msgs');
  ms.innerHTML+=\`<div class="msg u">\${E(t)}</div>\`;ms.scrollTop=9e9;
  try{
    const r=await(await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:t})})).json();
    ms.innerHTML+=\`<div class="msg a">\${E(r.response||r.error)}</div>\`;
  }catch(e){ms.innerHTML+=\`<div class="msg a" style="color:var(--r)">Error</div>\`}
  ms.scrollTop=9e9;
}

init();
</script>
</body>
</html>`;
