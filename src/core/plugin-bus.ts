import EventEmitter from 'eventemitter3';
import type { MemoryStore } from './storage/index.js';
import type { Logger } from './logger.js';

export interface PluginContext {
  storage: MemoryStore;
  logger: Logger;
  config: Record<string, unknown>;
  emit: (event: string, data: unknown) => void;
  schedule: (cronExpr: string, handler: () => void | Promise<void>) => string;
  notify: (message: string, options?: NotifyOptions) => Promise<void>;
}

export interface NotifyOptions {
  channel?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
}

export interface AuraPlugin {
  name: string;
  version: string;
  onLoad(ctx: PluginContext): Promise<void>;
  onActivate?(): Promise<void>;
  onDeactivate?(): Promise<void>;
  onUnload?(): Promise<void>;
}

export type PluginState = 'loaded' | 'active' | 'inactive' | 'error';

interface PluginEntry {
  plugin: AuraPlugin;
  state: PluginState;
  context: PluginContext;
}

export class PluginBus {
  private emitter = new EventEmitter.EventEmitter();
  private plugins = new Map<string, PluginEntry>();
  private log: Logger;
  private storage: MemoryStore;
  private notifyHandler: ((message: string, options?: NotifyOptions) => Promise<void>) | null = null;
  private scheduleHandler: ((cronExpr: string, handler: () => void | Promise<void>) => string) | null = null;

  constructor(storage: MemoryStore, logger: Logger) {
    this.storage = storage;
    this.log = logger;
  }

  setNotifyHandler(handler: (message: string, options?: NotifyOptions) => Promise<void>): void {
    this.notifyHandler = handler;
  }

  setScheduleHandler(handler: (cronExpr: string, fn: () => void | Promise<void>) => string): void {
    this.scheduleHandler = handler;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler);
  }

  emit(event: string, data?: unknown): void {
    this.log.debug(`Event: ${event}`);
    this.emitter.emit(event, data);
  }

  async register(plugin: AuraPlugin, pluginConfig: Record<string, unknown> = {}): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    const context: PluginContext = {
      storage: this.storage,
      logger: this.log.child({ module: `plugin:${plugin.name}` }),
      config: pluginConfig,
      emit: (event: string, data: unknown) => this.emit(`${plugin.name}:${event}`, data),
      schedule: (cronExpr: string, handler: () => void | Promise<void>) => {
        if (!this.scheduleHandler) throw new Error('Scheduler not initialized');
        return this.scheduleHandler(cronExpr, handler);
      },
      notify: async (message: string, options?: NotifyOptions) => {
        if (!this.notifyHandler) {
          this.log.warn(`Notification dropped (no handler): ${message}`);
          return;
        }
        return this.notifyHandler(message, options);
      },
    };

    try {
      await plugin.onLoad(context);
      this.plugins.set(plugin.name, { plugin, state: 'loaded', context });
      this.storage.audit('plugin:loaded', { plugin: plugin.name, version: plugin.version });
      this.log.info(`Plugin loaded: ${plugin.name} v${plugin.version}`);
    } catch (err) {
      this.plugins.set(plugin.name, { plugin, state: 'error', context });
      this.log.error(`Failed to load plugin "${plugin.name}": ${err}`);
      throw err;
    }
  }

  async activate(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);
    if (entry.state === 'active') return;

    try {
      if (entry.plugin.onActivate) {
        await entry.plugin.onActivate();
      }
      entry.state = 'active';
      this.storage.audit('plugin:activated', { plugin: name });
      this.log.info(`Plugin activated: ${name}`);
      this.emit('plugin:activated', { name });
    } catch (err) {
      entry.state = 'error';
      this.log.error(`Failed to activate plugin "${name}": ${err}`);
      throw err;
    }
  }

  async deactivate(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);
    if (entry.state !== 'active') return;

    try {
      if (entry.plugin.onDeactivate) {
        await entry.plugin.onDeactivate();
      }
      entry.state = 'inactive';
      this.storage.audit('plugin:deactivated', { plugin: name });
      this.log.info(`Plugin deactivated: ${name}`);
    } catch (err) {
      this.log.error(`Error deactivating plugin "${name}": ${err}`);
    }
  }

  async unregister(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) return;

    if (entry.state === 'active') {
      await this.deactivate(name);
    }

    if (entry.plugin.onUnload) {
      await entry.plugin.onUnload();
    }

    this.plugins.delete(name);
    this.storage.audit('plugin:unloaded', { plugin: name });
    this.log.info(`Plugin unloaded: ${name}`);
  }

  getPlugin(name: string): AuraPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  getState(name: string): PluginState | undefined {
    return this.plugins.get(name)?.state;
  }

  listPlugins(): Array<{ name: string; version: string; state: PluginState }> {
    return Array.from(this.plugins.entries()).map(([, entry]) => ({
      name: entry.plugin.name,
      version: entry.plugin.version,
      state: entry.state,
    }));
  }

  async shutdownAll(): Promise<void> {
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      await this.unregister(name);
    }
    this.emitter.removeAllListeners();
  }
}
