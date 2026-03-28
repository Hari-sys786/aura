# Aura — Full Development Plan

**Self-hosted AI life management agent. Privacy-first. Plugin-driven. Runs anywhere.**

---

## Vision

An autonomous agent that connects to your email, calendar, finances, documents, and smart home. It learns your patterns, acts proactively, and manages your life — without cloud dependency or recurring costs. Runs on anything from a Raspberry Pi to a VPS.

---

## Architecture

```
+------------------------------------------------------------------+
|                          USER INTERFACES                          |
|  Telegram | WhatsApp | Web Dashboard | CLI | REST API | WebSocket |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------+-----------------------------------+
|                        NOTIFICATION ENGINE                        |
|  Multi-channel delivery | Smart batching | DND | Urgency routing  |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|                          AURA CORE ENGINE                         |
|                                                                   |
|  +------------------+  +----------------+  +------------------+   |
|  |  Agent Runtime   |  |  Memory Store  |  |   Scheduler      |   |
|  |  - Event loop    |  |  - SQLite WAL  |  |   - Cron jobs    |   |
|  |  - AI reasoning  |  |  - LanceDB    |  |   - Event-driven |   |
|  |  - Decision exec |  |  - Hot cache   |  |   - Task queue   |   |
|  +------------------+  +----------------+  +------------------+   |
|                                                                   |
|  +------------------+  +----------------------------------------+ |
|  |  Crypto Vault    |  |            Audit Logger                | |
|  |  - libsodium     |  |  - Every action logged                | |
|  |  - Key derivation|  |  - Queryable + deletable              | |
|  |  - AES-256       |  |  - GDPR export                       | |
|  +------------------+  +----------------------------------------+ |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|                     PLUGIN BUS (Event-Driven)                     |
|  Typed events | Lifecycle management | Isolated plugin contexts   |
+--+-----+-----+-----+-----+-----+-----+-----+--------------------+
   |     |     |     |     |     |     |     |
   v     v     v     v     v     v     v     v
+----+ +----+ +----+ +----+ +----+ +----+ +----+ +--------+
|Cal | |Mail| |Fin | |Doc | |Hlth| |Sub | |Home| |Custom  |
+----+ +----+ +----+ +----+ +----+ +----+ +----+ +--------+
   |      |      |      |      |      |      |        |
   v      v      v      v      v      v      v        v
+------------------------------------------------------------------+
|                      EXTERNAL SERVICES                            |
|  Google Calendar | Gmail/IMAP | Bank SMS/UPI | Alexa | HA/MQTT   |
+------------------------------------------------------------------+
```

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Bun (primary), Node.js (fallback) | 3-5x faster startup, native SQLite bindings |
| Structured Storage | SQLite WAL | Sub-ms reads, concurrent access, zero-config |
| Vector Storage | LanceDB (embedded) | Sub-10ms semantic search, no server process |
| AI Inference | Pluggable adapter | Ollama, OpenAI, Anthropic, NVIDIA, Groq, custom |
| Encryption | libsodium + AES-256 | Industry-standard authenticated encryption |
| Task Queue | Built-in (no Redis) | Zero external deps, zero-latency dispatch |
| API Layer | REST + WebSocket | HTTP for integrations, WS for real-time |
| Plugin SDK | TypeScript package | npm-publishable, typed interfaces, lifecycle hooks |
| Voice | Alexa Skills Kit, Google Actions SDK | Standard platform SDKs |

---

## Core Features

### 1. Email Intelligence
- Connect via IMAP or Gmail API
- Classify: Bills, Action Required, FYI, Newsletters
- Extract structured data (amounts, due dates, account IDs) from bills
- Draft replies, actionable summaries
- Detect dormant subscriptions → suggest unsubscribe

### 2. Calendar Management
- Google Calendar, Apple Calendar, CalDAV
- Conflict detection across multiple calendars
- Auto-insert travel time between location-based meetings
- Protect focus time blocks
- Meeting prep context from previous interactions
- Overcommitment pattern detection

### 3. Financial Tracking
- Ingest from bank SMS, email receipts, UPI, manual entry
- Auto-categorize: food, transport, subscriptions, rent, investments
- Recurring charge detection + pre-renewal alerts
- Budget thresholds with alerts
- Tax-ready expense summaries
- Split expense tracking

### 4. Document Vault
- OCR on ingest
- Auto-categorize: medical, financial, legal, personal, work
- Expiry tracking (passport, insurance, licenses) with proactive alerts
- Semantic search across all documents
- Version history
- AES-256 encryption at rest

### 5. Daily Briefings
- **Morning:** weather, schedule, pending tasks, due bills, priority emails
- **Evening:** completed items, overdue tasks, next-day preview
- **Weekly:** spending summary, upcoming deadlines, relationship nudges
- **Monthly:** subscription audit, financial overview, goal tracking
- Delivered via text or TTS on any connected channel

### 6. Relationship Manager
- Track birthdays, anniversaries, important dates with advance reminders
- Monitor contact frequency → nudge when communication gaps exceed threshold
- Store gift history and meeting notes per contact

### 7. Smart Home & Device Integration
- Alexa Skill, Google Home Action, Apple Shortcuts
- Home Assistant + MQTT for IoT automation
- Push to wearables (Apple Watch, Wear OS) and smart displays (Echo Show, Nest Hub)
- Full local-network functionality when internet is down

### 8. Notification Engine
- Channels: Telegram, WhatsApp, Email, Push, SMS
- Smart batching for low-priority items
- DND schedules with urgency-based override
- Snooze with auto-escalation on repeated deferrals

### 9. Automation Engine
- Threshold triggers: "Alert if electricity bill > ₹3000"
- Pattern triggers: "Suggest deep work when calendar has 2-hour gap"
- Cross-system triggers: "Check service usage when renewal email arrives"
- Chainable multi-step workflows
- Cron-based + event-driven execution

---

## Plugin System

### Lifecycle
```
load → activate → [running] → deactivate → unload
```

### Plugin API Surface
- **EventBus:** subscribe/emit typed events
- **Storage:** key-value and structured storage per plugin
- **Notify:** send messages via configured channels
- **Schedule:** register cron jobs and delayed tasks
- **Config:** access plugin-specific user configuration
- **AI:** call configured AI provider for reasoning

### Example Plugin
```typescript
import { AuraPlugin, EventBus } from '@aura/sdk';

export default class InvoiceTracker extends AuraPlugin {
  name = 'invoice-tracker';
  version = '1.0.0';

  async onLoad(bus: EventBus) {
    bus.on('email:received', async (email) => {
      if (this.isInvoice(email)) {
        const data = await this.extractInvoiceData(email);
        await this.store('invoices', data);
        await this.notify(`Invoice: ${data.vendor} - ${data.amount} due ${data.dueDate}`);
      }
    });
  }
}
```

### Install
```bash
aura plugin add calendar
aura plugin add finance-india
aura plugin list
```

---

## Vector Search Optimizations

### Speed
- **Quantization:** store vectors as `uint8` instead of `float32` — 4x less memory, negligible accuracy loss
- **Pre-filtering:** apply metadata filters (date, source, category) BEFORE vector search
- **Query cache:** LRU cache on recent query embeddings — skip re-computation
- **Incremental indexing:** append without full rebuild (LanceDB native)
- **384-dim embeddings** (`all-MiniLM-L6-v2`) — half the memory, 2x faster, sufficient for personal data

### Quality
- **Hybrid search:** vector similarity + BM25 keyword matching — semantic ("find my flight booking") + exact ("PNR 4X7J2K")
- **Cross-encoder re-ranking:** fetch top-50 fast, re-rank top-10 with cross-encoder
- **Smart chunking:** split by paragraphs/sections with overlap, not fixed character count
- **Metadata enrichment:** tag chunks with source type, timestamp, mentioned entities

### Hardware Independence
- No GPU required — CPU with SIMD (AVX2/NEON) is enough
- Embedded DB — no server process, no network hop
- Sub-50ms search on $5/month VPS or Raspberry Pi (under 50K records)
- Lazy-load indexes — only what's active goes into memory
- Batch embedding on ingest, never on query path

---

## Performance Targets

| Operation | Target |
|-----------|--------|
| Chat response (cached) | < 50ms |
| Chat response (AI reasoning) | < 2s |
| Database read | < 1ms |
| Vector search | < 10ms |
| Event processing | < 5ms |
| Notification dispatch | < 100ms |
| Full daily briefing | < 3s |
| Cold start | < 2s (Bun), < 5s (Node) |

---

## Security

### Data Protection
- AES-256 encryption at rest via libsodium
- Encrypted credential vault (never plaintext)
- DB encryption key derived from user master password
- File-level encryption for document vault

### Privacy
- Zero telemetry — no usage data transmitted
- Fully air-gapped with Ollama — no external service required
- All processing local by default
- Full audit log — queryable, deletable
- GDPR-compliant: single command exports/deletes all user data

### Network
- TLS 1.3 for all external APIs
- HMAC-authenticated webhooks
- Rate limiting on all endpoints
- Optional Tailscale/WireGuard for remote access

---

## System Requirements

### Minimum
- 1 CPU core, 512MB RAM, 1GB disk
- Linux, macOS, or Docker

### Recommended
- 2+ CPU cores, 2GB RAM, 10GB disk
- Ubuntu 22.04+

### Cost

| Setup | Monthly |
|-------|---------|
| Raspberry Pi + Ollama | $0 (hardware only) |
| VPS (1GB) + Ollama | ~$5 |
| VPS + free-tier API (NVIDIA, Groq) | ~$5 |
| VPS + paid API (OpenAI, Anthropic) | ~$5 + $2-5 API |
| Existing home server/laptop | $0 |

---

## Integrations

### Communication Channels
| Channel | Protocol | Status |
|---------|----------|--------|
| Telegram | Bot API | Core |
| WhatsApp | Business API | Plugin |
| Web Dashboard | HTTP/WS | Core |
| CLI | stdin/stdout | Core |
| Email (outbound) | SMTP | Core |
| SMS | Twilio/custom | Plugin |

### Data Sources
| Source | Protocol | Status |
|--------|----------|--------|
| Gmail | OAuth2 + Gmail API | Plugin |
| IMAP (any) | IMAP4 | Plugin |
| Google Calendar | OAuth2 + Calendar API | Plugin |
| Apple Calendar | CalDAV | Plugin |
| Bank SMS (India) | SMS parsing | Plugin |
| UPI notifications | Notification parsing | Plugin |
| Manual entry | CLI/Web/Chat | Core |

### Voice & Smart Home
| Platform | Method | Status |
|----------|--------|--------|
| Amazon Alexa | Custom Skill (ASK) | Plugin |
| Google Home | Conversational Action | Plugin |
| Apple HomePod | Shortcuts | Plugin |
| Home Assistant | REST + MQTT | Plugin |
| Apple Watch / Wear OS | Push notifications | Plugin |
| Echo Show / Nest Hub | Display cards | Plugin |

---

## Roadmap

| Version | Scope | Build Order |
|---------|-------|-------------|
| **0.1** | Core engine, Telegram, Calendar, Daily briefing | 1. Project scaffold (Bun, TS, folder structure) |
| | | 2. Config system + setup wizard |
| | | 3. SQLite + LanceDB memory store |
| | | 4. Plugin bus (event-driven lifecycle) |
| | | 5. Agent runtime (AI adapter, reasoning loop) |
| | | 6. Telegram interface |
| | | 7. Calendar plugin (Google Calendar) |
| | | 8. Daily briefing (morning/evening) |
| **0.2** | Email intelligence, Finance tracker | |
| **0.3** | Document vault, OCR, Subscription watchdog | |
| **0.4** | Plugin SDK, Web dashboard, CLI improvements | |
| **0.5** | Alexa Skill, Google Home, Home Assistant | |
| **0.6** | WhatsApp channel, Wearable notifications | |
| **1.0** | Production hardening, docs site, Docker Hub | |

---

## Installation

### One-line
```bash
curl -fsSL https://aura.sh/install | bash
```

### Docker
```bash
docker run -d --name aura -p 3000:3000 -v aura-data:/data aura/aura
```

### Manual
```bash
git clone https://github.com/YourUsername/aura.git
cd aura
npm install
cp .env.example .env
npm start
```

### Setup Wizard (first run)
1. Select communication channel (Telegram, Web, CLI)
2. Select initial modules (Calendar, Email, Finance)
3. Select AI provider (Ollama, NVIDIA free, OpenAI, Anthropic, custom)

---

## Comparison

| Capability | Aura | Google Assistant | Notion AI | Todoist AI | Apple Reminders |
|-----------|------|-----------------|-----------|-----------|-----------------|
| Self-hosted | ✅ | ❌ | ❌ | ❌ | ❌ |
| Open source | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zero telemetry | ✅ | ❌ | ❌ | ❌ | ❌ |
| Offline capable | ✅ | ❌ | ❌ | ❌ | Partial |
| Free (no subscription) | ✅ | Freemium | Paid | Paid | Apple only |
| Email intelligence | ✅ | Basic | ❌ | ❌ | ❌ |
| Finance tracking | ✅ | ❌ | ❌ | ❌ | ❌ |
| Document vault + OCR | ✅ | ❌ | Limited | ❌ | ❌ |
| Plugin ecosystem | ✅ | ❌ | ❌ | ❌ | ❌ |
| Proactive agent | ✅ | Limited | ❌ | ❌ | ❌ |
| Voice assistants | All 3 | Google only | ❌ | ❌ | Siri only |
| Smart home | Alexa+HA+MQTT | Google Home | ❌ | ❌ | HomeKit |
| Custom automations | ✅ | Limited | ❌ | Limited | Shortcuts |
| Runs on Pi | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## License

MIT
