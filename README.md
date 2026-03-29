# 🔱 Aura

**Self-hosted AI life management agent. Privacy-first. Plugin-driven. Runs anywhere.**

Aura connects to your email, calendar, finances, documents, and smart home — learns your patterns, acts proactively, and manages your life without cloud dependency.

## Quick Start

```bash
git clone https://github.com/Hari-sys786/aura.git
cd aura
npm install
npm run setup    # Interactive wizard
npm start
```

### Docker

```bash
docker-compose up -d
```

### One Command

```bash
npm run setup && npm start
```

## What It Does

| Feature | Description |
|---------|-------------|
| 📧 **Email Intelligence** | Gmail auto-classification, bill extraction, action detection |
| 📅 **Calendar** | Google Calendar sync, conflict detection, schedule summaries |
| 💰 **Finance Tracker** | Bank SMS parsing, 16 categories, budgets, subscription detection |
| 📋 **Daily Briefings** | Morning/evening/weekly summaries with tasks, bills, schedule |
| 📄 **Document Vault** | OCR (Tesseract), auto-categorize, expiry tracking, search |
| 🔔 **Subscription Watchdog** | Auto-detect from emails, renewal alerts, cost analysis |
| 🏠 **Smart Home** | Home Assistant integration, device control via any channel |

## Channels

Talk to Aura from anywhere:

| Channel | Status |
|---------|--------|
| 💬 Telegram | ✅ Built-in |
| 📱 WhatsApp | ✅ Business API |
| 🔊 Alexa | ✅ Custom Skill |
| 🏠 Google Home | ✅ Actions |
| 🌐 Web Dashboard | ✅ localhost:3001 |
| ⌨️ CLI | ✅ `aura chat` |
| 📲 Push (iOS/Android/Watch) | ✅ FCM + APNS |

## Architecture

```
User → [Telegram | WhatsApp | Alexa | Web | CLI]
         ↓
    Agent Runtime (AI reasoning)
         ↓
    Plugin Bus (event-driven)
         ↓
    [Email | Calendar | Finance | Docs | Subscriptions | Smart Home]
         ↓
    Storage: SQLite WAL + LanceDB vectors + LRU cache
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Storage | SQLite WAL + LanceDB |
| AI | Pluggable (Ollama, NVIDIA, OpenAI, Anthropic, Groq) |
| Encryption | libsodium (AES-256-GCM) |
| OCR | Tesseract |
| Push | FCM + APNS |

## Configuration

Copy `.env.example` to `.env` or run `npm run setup`:

```env
# AI (required)
AI_PROVIDER=ollama           # ollama|nvidia|openai|anthropic|groq|custom
AI_MODEL=llama3.2
AI_BASE_URL=http://localhost:11434

# Telegram (recommended)
TELEGRAM_BOT_TOKEN=your-token

# Google (optional — enables email + calendar)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Security (optional — enables encryption at rest)
MASTER_PASSWORD=your-secret

# Smart Home (optional)
HA_URL=http://192.168.1.100:8123
HA_TOKEN=your-long-lived-token
```

## CLI

```bash
aura start          # Start all services
aura setup          # Interactive setup
aura status         # System health
aura doctor         # Full health check
aura chat "msg"     # Chat with Aura
aura emails         # Recent emails
aura calendar       # Today's events
aura spend          # Today's spending
aura summary        # Monthly finance
aura docs           # Document vault
aura subs           # Subscription costs
aura export csv     # Export data
```

## Plugin SDK

Build custom plugins:

```typescript
import { AuraPlugin, PluginContext, Events } from '@aura/sdk';

export default class MyPlugin implements AuraPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  async onLoad(ctx: PluginContext) {
    ctx.schedule('0 9 * * *', async () => {
      await ctx.notify('Good morning! ☀️');
    });
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | System status |
| `/api/emails` | GET | Recent emails |
| `/api/calendar` | GET | Calendar events |
| `/api/transactions` | GET | Finance data |
| `/api/documents` | GET | Document vault |
| `/api/subscriptions` | GET | Subscriptions |
| `/api/chat` | POST | Chat with AI |
| `/api/alexa` | POST | Alexa webhook |
| `/api/google-home` | POST | Google Home webhook |
| `/api/whatsapp` | POST | WhatsApp webhook |
| `/api/push/register` | POST | Register push device |

## System Requirements

- **Minimum:** 1 CPU, 512MB RAM, Node.js 20+
- **Recommended:** 2 CPU, 2GB RAM
- **Cost:** $0 (Ollama) to $5/mo (VPS + free AI tier)

## Privacy

- Zero telemetry
- All data stored locally
- AES-256-GCM encryption at rest
- Full audit log (queryable + deletable)
- Works offline with Ollama

## License

MIT

---

Built with 🔱 by [Hari](https://github.com/Hari-sys786)
