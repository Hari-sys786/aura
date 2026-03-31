import { loadConfig } from './core/config.js';
import { createLogger, childLogger } from './core/logger.js';
import { MemoryStore } from './core/storage/index.js';
import { PluginBus } from './core/plugin-bus.js';
import { createAiAdapter } from './core/ai/index.js';
import { Scheduler } from './core/scheduler.js';
import { CryptoVault } from './core/crypto.js';
import { Agent } from './core/agent.js';
import { TelegramChannel } from './channels/telegram.js';
import { Dashboard } from './dashboard/server.js';
import { HomeAssistantChannel } from './channels/homeassistant.js';
import { EmailPlugin } from './plugins/email.js';
import { FinancePlugin } from './plugins/finance.js';
import { CalendarPlugin } from './plugins/calendar.js';
import { BriefingPlugin } from './plugins/briefing.js';
import { DocumentPlugin } from './plugins/documents.js';
import { SubscriptionPlugin } from './plugins/subscriptions.js';

async function main(): Promise<void> {
  console.log(`
   █████╗ ██╗   ██╗██████╗  █████╗
  ██╔══██╗██║   ██║██╔══██╗██╔══██╗
  ███████║██║   ██║██████╔╝███████║
  ██╔══██║██║   ██║██╔══██╗██╔══██║
  ██║  ██║╚██████╔╝██║  ██║██║  ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
  v0.1.0 — Your life, your agent, your rules.
  `);

  // 1. Load config
  const config = loadConfig();
  const log = createLogger(config.server.logLevel);
  log.info('Configuration loaded');

  // 2. Initialize storage
  const storage = new MemoryStore(config.storage, childLogger(log, 'storage'));
  log.info('Memory store ready (SQLite + Vector + Cache)');

  // 3. Initialize crypto vault
  const crypto = new CryptoVault(childLogger(log, 'crypto'));
  await crypto.init(config.masterPassword);

  // 4. Initialize scheduler
  const scheduler = new Scheduler(childLogger(log, 'scheduler'));
  log.info('Scheduler ready');

  // 5. Initialize plugin bus
  const plugins = new PluginBus(storage, childLogger(log, 'plugins'));

  plugins.setScheduleHandler((cronExpr, handler) => {
    return scheduler.add(cronExpr, handler);
  });

  // Register built-in plugins
  const financePlugin = new FinancePlugin();
  await plugins.register(financePlugin, config as unknown as Record<string, unknown>);
  await plugins.activate('finance');

  const briefingPlugin = new BriefingPlugin();
  await plugins.register(briefingPlugin, config as unknown as Record<string, unknown>);
  await plugins.activate('briefing');

  // Email and Calendar require OAuth config — register but only activate if configured
  if (config.google.clientId && config.google.clientSecret && config.google.refreshToken) {
    const calendarPlugin = new CalendarPlugin();
    await plugins.register(calendarPlugin, {
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      redirectUri: config.google.redirectUri,
      refreshToken: config.google.refreshToken,
    });
    await plugins.activate('calendar');

    const emailPlugin = new EmailPlugin();
    await plugins.register(emailPlugin, {
      accounts: [
        {
          id: 'primary',
          label: 'Primary Gmail',
          purpose: 'personal',
          provider: 'gmail',
          gmail: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            refreshToken: config.google.refreshToken,
          },
          enabled: true,
        },
        {
          id: 'secondary',
          label: 'Hari Gmail',
          purpose: 'personal',
          provider: 'gmail',
          gmail: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            refreshToken: process.env.GOOGLE_REFRESH_TOKEN_2 || '',
          },
          enabled: true,
        },
      ],
    });
    await plugins.activate('email');
  } else {
    log.info('Google OAuth not configured — Calendar & Email plugins skipped');
  }

  // Document vault
  const docPlugin = new DocumentPlugin();
  await plugins.register(docPlugin, {
    vaultPath: config.storage.dataDir + '/vault',
    encryptionKey: config.masterPassword || undefined,
  });
  await plugins.activate('documents');

  // Subscription watchdog
  const subPlugin = new SubscriptionPlugin();
  await plugins.register(subPlugin);
  await plugins.activate('subscriptions');

  log.info('Plugin bus ready');

  // 6. Initialize AI adapter
  const ai = createAiAdapter(config.ai, childLogger(log, 'ai'));
  const aiReachable = await ai.ping();
  if (aiReachable) {
    log.info(`AI provider "${config.ai.provider}" connected (model: ${config.ai.model})`);
  } else {
    log.warn(`AI provider "${config.ai.provider}" not reachable — agent reasoning will fail until connected`);
  }

  // 7. Initialize agent
  const agent = new Agent({
    ai,
    storage,
    plugins,
    scheduler,
    logger: childLogger(log, 'agent'),
  });
  log.info('Agent runtime ready');

  // 8. Initialize Telegram channel (if configured)
  let telegram: TelegramChannel | null = null;
  if (config.telegram.botToken) {
    telegram = new TelegramChannel(
      config.telegram.botToken,
      agent,
      childLogger(log, 'telegram'),
    );

    // Wire notifications through Telegram
    plugins.setNotifyHandler(async (message, options) => {
      // For now, send to the first chat that messaged the bot
      // In production, this would use stored user chat IDs
      log.info(`Notification: ${message}`);
    });

    try {
      await telegram.start();
    } catch (err) {
      log.error(`Telegram failed to start: ${err}`);
    }
  } else {
    log.info('Telegram not configured — skipping (set TELEGRAM_BOT_TOKEN)');
  }

  // 9. Home Assistant (if configured)
  let ha: HomeAssistantChannel | null = null;
  if (config.homeAssistant.url && config.homeAssistant.token) {
    ha = new HomeAssistantChannel(
      config.homeAssistant,
      agent,
      storage,
      plugins,
      childLogger(log, 'ha'),
    );
    await ha.connect();
  } else {
    log.info('Home Assistant not configured — skipping (set HA_URL + HA_TOKEN)');
  }

  // 10. Start web dashboard
  const dashboard = new Dashboard(
    { port: config.server.port, host: config.server.host },
    storage, plugins, agent, scheduler,
    childLogger(log, 'dashboard'),
  );

  // 10. Boot summary
  const cacheStats = storage.cache.stats();
  log.info('=== Aura Boot Summary ===');
  log.info(`  AI: ${config.ai.provider} / ${config.ai.model} (${aiReachable ? 'connected' : 'offline'})`);
  log.info(`  Storage: SQLite WAL + Vector (in-memory) + LRU Cache`);
  log.info(`  Plugins: ${plugins.listPlugins().length} loaded`);
  log.info(`  Scheduler: ${scheduler.list().length} tasks`);
  log.info(`  Crypto: ${crypto.isReady() ? 'active' : 'disabled'}`);
  log.info(`  Telegram: ${telegram ? 'connected' : 'not configured'}`);
  log.info('=========================');
  log.info('Aura is ready. Waiting for events...');

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal} — shutting down...`);

    dashboard.stop();
    if (telegram) telegram.stop();
    scheduler.stopAll();
    await plugins.shutdownAll();
    crypto.destroy();
    storage.close();

    log.info('Aura stopped. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
