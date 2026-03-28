# Aura

**Self-hosted AI life management agent. Privacy-first. Plugin-driven. Runs anywhere.**

Aura is an autonomous agent that connects to your email, calendar, finances, documents, and smart home devices. It learns your patterns, acts proactively, and manages your life without cloud dependency or recurring costs.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Architecture](#architecture)
- [Plugin System](#plugin-system)
- [Supported Integrations](#supported-integrations)
- [Performance](#performance)
- [Security](#security)
- [Roadmap](#roadmap)
- [Comparison](#comparison)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Aura is a modular, event-driven AI agent designed for personal life administration. It operates as a background service on any Linux/macOS/Docker host and communicates through Telegram, WhatsApp, Web UI, CLI, or voice assistants.

**Core capabilities:**
- Email triage and bill extraction
- Calendar conflict detection and scheduling intelligence
- Financial tracking with auto-categorization
- Document OCR, storage, and semantic search
- Subscription monitoring and renewal alerts
- Relationship tracking (birthdays, follow-ups)
- Smart home and voice assistant integration
- Daily/weekly/monthly automated briefings
- Rule-based and AI-powered automation workflows

**Design goals:**
- Zero mandatory external services
- Sub-100ms response for local operations
- Under 5 minutes from install to first interaction
- Plugin-extensible without modifying core
- Runs on hardware as minimal as a Raspberry Pi

---

## Key Features

### Email Intelligence

Connects via IMAP or Gmail API. Classifies incoming email into Bills, Action Required, FYI, and Newsletters. Extracts structured data from bill emails including amounts, due dates, and account identifiers. Generates actionable summaries and draft replies. Detects dormant subscriptions and suggests unsubscribe.

### Calendar Management

Integrates with Google Calendar, Apple Calendar, and CalDAV providers. Detects scheduling conflicts across multiple calendars. Automatically inserts travel time between location-based meetings. Protects configurable focus time blocks. Provides meeting prep context from previous interactions. Flags overcommitment patterns.

### Financial Tracking

Ingests transaction data from bank SMS, email receipts, UPI notifications, and manual entry. Auto-categorizes transactions by type (food, transport, subscriptions, rent, investments). Detects recurring charges and alerts before renewal. Tracks budgets with threshold alerts. Generates tax-ready expense summaries. Supports split expense tracking.

### Document Vault

Processes documents via OCR on ingest. Auto-categorizes into medical, financial, legal, personal, and work buckets. Tracks expiry dates for passports, insurance, licenses, and certificates with proactive alerts. Provides semantic search across all stored documents. Maintains version history. All documents encrypted at rest with AES-256.

### Daily Briefings

Generates automated briefings at configurable intervals:
- Morning: weather, schedule, pending tasks, due bills, priority emails
- Evening: completed items, overdue tasks, next-day preview
- Weekly: spending summary, upcoming deadlines, relationship nudges
- Monthly: subscription audit, financial overview, goal tracking

Delivered via text or TTS (text-to-speech) on any connected channel.

### Relationship Manager

Tracks birthdays, anniversaries, and user-defined important dates with advance reminders. Monitors contact frequency and nudges when communication gaps exceed configurable thresholds. Stores gift history and meeting notes per contact.

### Smart Home and Device Integration

Exposes functionality via custom Alexa Skill, Google Home Action, and Apple Shortcuts. Integrates with Home Assistant and MQTT for IoT device automation. Pushes briefings and alerts to wearables (Apple Watch, Wear OS) and smart displays (Echo Show, Nest Hub). Maintains full functionality on local network when internet is unavailable.

### Notification Engine

Delivers notifications across Telegram, WhatsApp, Email, Push, and SMS. Batches low-priority items into configurable digest intervals. Respects Do Not Disturb schedules with urgency-based override. Implements snooze with automatic escalation on repeated deferrals.

### Automation Engine

Supports user-defined rules combining conditions and actions:
- Threshold triggers: "Alert if electricity bill exceeds 3000"
- Pattern triggers: "Suggest deep work when calendar has 2-hour gap"
- Cross-system triggers: "Check service usage when renewal email arrives"

Rules are chainable into multi-step workflows. Supports both scheduled (cron) and event-driven execution.

---

## System Requirements

### Minimum

- 1 CPU core
- 512MB RAM
- 1GB disk space
- Linux, macOS, or Docker

### Recommended

- 2+ CPU cores
- 2GB RAM
- 10GB disk space (for document vault)
- Linux (Ubuntu 22.04+ recommended)

### Cost

| Setup | Monthly Cost |
|-------|-------------|
| Raspberry Pi + Ollama (local AI) | Hardware only, no recurring cost |
| VPS (1GB) + Ollama | ~5 USD |
| VPS + free-tier AI API (NVIDIA, Groq) | ~5 USD |
| VPS + paid AI API (OpenAI, Anthropic) | ~5 USD + 2-5 USD API usage |
| Existing home server or laptop | No cost |

No cloud accounts, subscriptions, or credit cards required for base functionality.

---

## Installation

### One-line install

```bash
curl -fsSL https://aura.sh/install | bash
```

Installs Aura, sets up local AI via Ollama, and launches the interactive setup wizard.

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

### Setup Wizard

First run presents three configuration steps:

1. Select communication channel (Telegram, Web, or CLI)
2. Select initial modules to activate (Calendar, Email, Finance)
3. Select AI provider (Ollama local, NVIDIA free, OpenAI, Anthropic, or custom)

Default configuration works without modification.

---

## Architecture

### Architecture Diagram

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
|    | |    | |    | |    | |    | |    | |    | |Plugins |
+--+-+ +--+-+ +--+-+ +--+-+ +--+-+ +--+-+ +--+-+ +---+----+
   |      |      |      |      |      |      |        |
   v      v      v      v      v      v      v        v
+------------------------------------------------------------------+
|                      EXTERNAL SERVICES                            |
|                                                                   |
|  Google Calendar    Gmail / IMAP       Bank SMS / UPI             |
|  Apple Calendar     Outlook            Investment APIs            |
|  CalDAV             SMTP               Payment gateways          |
|                                                                   |
|  Amazon Alexa       Google Home        Apple HomePod              |
|  Home Assistant     MQTT broker        Wearables (Watch/WearOS)  |
|  Echo Show          Nest Hub           Apple Shortcuts            |
+------------------------------------------------------------------+
```

### Component Details

**Core Engine** contains four subsystems:
- Agent Runtime: main event loop, AI-powered reasoning, and action execution
- Memory Store: SQLite in WAL mode for structured data, LanceDB for vector/semantic search, in-memory hot cache for active context
- Scheduler: cron-based recurring tasks and event-driven reactive execution
- Crypto Vault: libsodium encryption for credentials, AES-256 for data at rest

**Plugin Bus** provides event-driven communication between core and plugins with standardized lifecycle management (load, activate, deactivate, unload) and isolated plugin contexts with a defined API surface.

**Plugins** are independently installable modules covering Calendar, Email, Finance, Documents, Health, Subscriptions, Smart Home, and user-built custom plugins.

**Interfaces** include Telegram, WhatsApp, Web Dashboard, CLI, Alexa Skill, Google Home Action, REST API, and WebSocket API.

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Bun (primary), Node.js (fallback) | Bun provides 3-5x faster startup and native SQLite bindings |
| Structured Storage | SQLite with WAL mode | Sub-millisecond reads, concurrent access, zero-config |
| Vector Storage | LanceDB | Sub-10ms semantic search, embedded, no server process |
| AI Inference | Pluggable adapter | Supports Ollama, OpenAI, Anthropic, NVIDIA, Groq, custom endpoints |
| Encryption | libsodium | Industry-standard authenticated encryption |
| Task Queue | Built-in (no Redis) | Eliminates external dependency, zero-latency dispatch |
| API Layer | REST + WebSocket | HTTP for integrations, WebSocket for real-time channels |
| Plugin SDK | TypeScript package | npm-publishable, typed interfaces, lifecycle hooks |
| Voice Integration | Alexa Skills Kit, Google Actions SDK | Standard platform SDKs for voice assistant integration |

### Data Flow

1. Event source (email received, calendar updated, SMS parsed) triggers plugin
2. Plugin emits typed event on the Plugin Bus
3. Agent Runtime receives event, queries Memory Store for context
4. Agent reasons using configured AI provider (or rule engine for simple cases)
5. Agent executes actions: send notification, update state, trigger automation
6. All actions logged to audit trail

---

## Plugin System

### Installing Plugins

```bash
aura plugin add calendar
aura plugin add finance-india
aura plugin add alexa
aura plugin list
```

### Writing Plugins

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

  private isInvoice(email: Email): boolean {
    return email.subject.match(/invoice|bill|statement|payment due/i) !== null;
  }
}
```

### Plugin API Surface

- EventBus: subscribe/emit typed events
- Storage: key-value and structured storage per plugin
- Notify: send messages to user via configured channels
- Schedule: register cron jobs and delayed tasks
- Config: access plugin-specific user configuration
- AI: call the configured AI provider for reasoning tasks

---

## Supported Integrations

### Communication Channels

| Channel | Protocol | Status |
|---------|----------|--------|
| Telegram | Bot API | Core |
| WhatsApp | WhatsApp Business API | Plugin |
| Web Dashboard | HTTP/WebSocket | Core |
| CLI | stdin/stdout | Core |
| Email (outbound) | SMTP | Core |
| SMS | Twilio/custom | Plugin |

### Data Sources

| Source | Protocol | Status |
|-------|----------|--------|
| Gmail | OAuth2 + Gmail API | Plugin |
| IMAP (any provider) | IMAP4 | Plugin |
| Google Calendar | OAuth2 + Calendar API | Plugin |
| Apple Calendar | CalDAV | Plugin |
| Bank SMS (India) | SMS parsing | Plugin |
| UPI notifications | Notification parsing | Plugin |
| Manual entry | CLI/Web/Chat | Core |

### Voice and Smart Home

| Platform | Integration Method | Status |
|----------|-------------------|--------|
| Amazon Alexa | Custom Skill (ASK) | Plugin |
| Google Home | Conversational Action | Plugin |
| Apple HomePod | Apple Shortcuts | Plugin |
| Home Assistant | REST API + MQTT | Plugin |
| Apple Watch | Push notifications | Plugin |
| Wear OS | Push notifications | Plugin |
| Echo Show / Nest Hub | Display cards | Plugin |

---

## Performance

### Targets

| Operation | Target Latency |
|-----------|---------------|
| Chat response (cached context) | Under 50ms |
| Chat response (AI reasoning) | Under 2s (depends on provider) |
| Database read | Under 1ms |
| Vector search (semantic) | Under 10ms |
| Event processing (plugin bus) | Under 5ms |
| Notification dispatch | Under 100ms |
| Full daily briefing generation | Under 3s |
| Cold start to ready | Under 2s (Bun), under 5s (Node) |

### Design Decisions for Speed

- In-memory hot cache for active context (today's calendar, recent emails, pending tasks)
- Event-driven architecture with zero polling
- SQLite WAL mode for non-blocking concurrent reads
- Lazy plugin loading: inactive plugins consume zero memory
- Streaming responses: output begins before full processing completes
- WebSocket-first for real-time channels, avoiding HTTP request overhead
- Built-in task queue eliminates Redis round-trip latency

### Vector Search Optimizations

**Speed:**
- Vector quantization: store embeddings as `uint8` instead of `float32` — 4x less memory, negligible accuracy loss for personal-scale data
- Pre-filtering: apply metadata filters (date, source type, category) BEFORE vector search to reduce search space
- Query embedding cache: LRU cache on recent query embeddings to avoid re-computation on repeated/similar searches
- Incremental indexing: append new documents without full index rebuild (LanceDB native support)
- 384-dimension embeddings (`all-MiniLM-L6-v2`) over 768/1536 — half memory, 2x faster search, sufficient for personal data

**Quality:**
- Hybrid search: combine vector similarity + BM25 keyword matching — vectors catch semantic intent ("find my flight booking"), BM25 catches exact terms ("PNR 4X7J2K")
- Cross-encoder re-ranking: fetch top-50 with fast approximate search, re-rank top-10 with cross-encoder for precise final results
- Smart chunking: split by paragraphs/sections with overlap instead of fixed character count — bad chunks degrade retrieval regardless of speed
- Metadata enrichment: tag every chunk with source type (email/doc/calendar), timestamp, and mentioned entities — enables smart pre-filtering

**Hardware Independence:**
- No GPU required: embedding models run on CPU with SIMD (AVX2/NEON) acceleration
- Embedded DB (LanceDB): no separate server process, no network hop, runs in-process
- Sub-50ms search on $5/month VPS or Raspberry Pi for typical personal datasets (under 50K records)
- Lazy-load indexes: only load what's actively needed into memory
- Batch embedding on ingest, never on query path

---

## Security

### Data Protection

- All stored data encrypted at rest using AES-256 via libsodium
- API keys and credentials stored in encrypted vault, never plaintext
- Database encryption key derived from user-set master password
- File-level encryption for document vault contents

### Privacy

- Zero telemetry: no usage data, analytics, or crash reports transmitted
- No external service required: operates fully air-gapped with Ollama
- All processing local by default; external APIs used only when explicitly configured
- Full audit log of every agent action, queryable and deletable
- GDPR-friendly: single command exports or deletes all user data

### Network

- All external API communication over TLS 1.3
- Webhook endpoints authenticated with HMAC signatures
- Rate limiting on all API endpoints
- Optional Tailscale/WireGuard integration for secure remote access

---

## Roadmap

| Version | Scope | Status |
|---------|-------|--------|
| 0.1 | Core engine, Telegram channel, Calendar plugin, Daily briefing | In progress |
| 0.2 | Email intelligence, Finance tracker | Planned |
| 0.3 | Document vault, OCR, Subscription watchdog | Planned |
| 0.4 | Plugin SDK, Web dashboard, CLI improvements | Planned |
| 0.5 | Alexa Skill, Google Home Action, Home Assistant | Planned |
| 0.6 | WhatsApp channel, Wearable notifications | Planned |
| 1.0 | Production hardening, documentation site, Docker Hub publish | Planned |

---

## Comparison

| Capability | Aura | Google Assistant | Notion AI | Todoist AI | Apple Reminders |
|-----------|------|-----------------|-----------|-----------|-----------------|
| Self-hosted | Yes | No | No | No | No |
| Open source | Yes | No | No | No | No |
| Privacy (zero telemetry) | Yes | No | No | No | No |
| Offline capable | Yes | No | No | No | Partial |
| Free (no subscription) | Yes | Freemium | Paid | Paid | Free (Apple only) |
| Email intelligence | Yes | Basic | No | No | No |
| Finance tracking | Yes | No | No | No | No |
| Document vault with OCR | Yes | No | Limited | No | No |
| Plugin ecosystem | Yes | No | No | No | No |
| Proactive agent behavior | Yes | Limited | No | No | No |
| Voice assistant support | Alexa + Google + HomePod | Google only | No | No | Siri only |
| Smart home integration | Alexa + HA + MQTT | Google Home | No | No | HomeKit |
| Custom automations | Yes | Limited | No | Limited | Shortcuts |
| Runs on Raspberry Pi | Yes | No | No | No | No |

---

## Contributing

Contributions welcome. See CONTRIBUTING.md for development setup, coding standards, and PR process.

Issues tagged "good first issue" are available for new contributors.

---

## License

MIT
