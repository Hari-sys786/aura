# Contributing to Aura

Thanks for your interest! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/Hari-sys786/aura.git
cd aura
npm install
cp .env.example .env
# Edit .env with your config
npm run dev    # Watch mode
npm run build  # Compile TypeScript
npm start      # Run compiled
npm run setup  # Interactive setup wizard
```

## Project Structure

```
src/
├── core/           # Engine: config, storage, AI, scheduler, crypto
│   ├── ai/         # AI provider adapters (Ollama, OpenAI, NVIDIA, etc.)
│   └── storage/    # SQLite, LanceDB vectors, LRU cache
├── channels/       # Communication interfaces
│   ├── telegram.ts # Telegram bot
│   ├── whatsapp.ts # WhatsApp Business
│   ├── alexa.ts    # Alexa Skill
│   ├── google-home.ts # Google Home Actions
│   ├── homeassistant.ts # Home Assistant
│   └── push.ts     # FCM + APNS push notifications
├── plugins/        # Feature plugins
│   ├── calendar.ts # Google Calendar
│   ├── email.ts    # Gmail intelligence
│   ├── finance.ts  # Finance tracker
│   ├── briefing.ts # Daily briefings
│   ├── documents.ts # Document vault + OCR
│   └── subscriptions.ts # Subscription watchdog
├── dashboard/      # Web UI + REST API
├── sdk/            # Plugin SDK (TypeScript interfaces)
├── index.ts        # Entry point
├── cli.ts          # CLI tool
└── setup.ts        # Setup wizard
```

## Writing Plugins

```typescript
import { AuraPlugin, PluginContext } from '../sdk/index.js';

export class MyPlugin implements AuraPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  async onLoad(ctx: PluginContext) {
    // Set up event handlers, storage, schedules
  }

  async onActivate() {
    // Start background tasks
  }

  async onDeactivate() {
    // Clean up
  }
}
```

## Testing

```bash
npx tsx test.ts      # Unit tests (31)
npx tsx test-v02.ts  # v0.2 tests (23)
npx tsx test-e2e.ts  # E2E tests (36)
```

All tests must pass before submitting a PR.

## Code Style

- TypeScript strict mode
- No `any` types
- Error handling on all async functions
- HTML format for Telegram messages (not Markdown)
- Comments only for non-obvious logic

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Write tests for new features
4. Run all test suites
5. Submit PR with clear description

## Issues

Use the issue tracker for bugs, feature requests, and questions.
Tag issues with: `bug`, `feature`, `plugin`, `channel`, `docs`.
