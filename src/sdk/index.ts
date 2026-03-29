/**
 * Aura Plugin SDK
 * 
 * Use this to build custom plugins for Aura.
 * 
 * @example
 * ```typescript
 * import { AuraPlugin, PluginContext } from '@aura/sdk';
 * 
 * export default class MyPlugin implements AuraPlugin {
 *   name = 'my-plugin';
 *   version = '1.0.0';
 * 
 *   async onLoad(ctx: PluginContext) {
 *     ctx.logger.info('Hello from my plugin!');
 *     
 *     // Subscribe to events
 *     ctx.on('email:received', async (data) => {
 *       // React to emails
 *     });
 *     
 *     // Schedule recurring tasks
 *     ctx.schedule('0 9 * * *', async () => {
 *       await ctx.notify('Good morning!');
 *     });
 *     
 *     // Store data
 *     ctx.storage.set('my-data', 'key1', { value: 42 });
 *   }
 * 
 *   async onActivate() {}
 *   async onDeactivate() {}
 *   async onUnload() {}
 * }
 * ```
 */

// --- Core Interfaces ---

export interface AuraPlugin {
  /** Unique plugin name (kebab-case) */
  name: string;
  /** Semver version string */
  version: string;
  /** Called when plugin is loaded. Set up event handlers, storage, etc. */
  onLoad(ctx: PluginContext): Promise<void>;
  /** Called when plugin is activated. Start scheduled tasks. */
  onActivate?(): Promise<void>;
  /** Called when plugin is deactivated. Clean up. */
  onDeactivate?(): Promise<void>;
  /** Called when plugin is unloaded. Final cleanup. */
  onUnload?(): Promise<void>;
}

export interface PluginContext {
  /** Plugin-scoped logger */
  logger: PluginLogger;
  /** Plugin-scoped storage (key-value + structured) */
  storage: PluginStorage;
  /** Plugin configuration from user's config */
  config: Record<string, unknown>;
  /** Emit an event on the plugin bus */
  emit: (event: string, data: unknown) => void;
  /** Schedule a recurring cron job. Returns task ID for cancellation. */
  schedule: (cronExpr: string, handler: () => void | Promise<void>) => string;
  /** Send a notification to the user via configured channels */
  notify: (message: string, options?: NotifyOptions) => Promise<void>;
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface PluginStorage {
  /** Set a value in a collection */
  set(collection: string, key: string, value: object, metadata?: Record<string, unknown>): void;
  /** Get a value from a collection */
  get<T extends object = Record<string, unknown>>(collection: string, key: string): T | null;
  /** Delete a value */
  delete(collection: string, key: string): boolean;
  /** List all entries in a collection */
  sqlite: {
    list(collection: string): Array<{ key: string; value: string; collection: string }>;
    query(collection: string, filter: Record<string, unknown>): Array<{ key: string; value: string }>;
  };
  /** Audit log */
  audit(action: string, details?: Record<string, unknown>, actor?: string): void;
}

export interface NotifyOptions {
  /** Target channel (telegram, email, push) */
  channel?: string;
  /** Message urgency */
  urgency?: 'low' | 'normal' | 'high' | 'critical';
}

// --- Helper Types ---

export type PluginState = 'loaded' | 'active' | 'inactive' | 'error';

export interface PluginInfo {
  name: string;
  version: string;
  state: PluginState;
}

// --- Plugin Metadata ---

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  aura: {
    minVersion: string;
    categories?: string[];
    permissions?: string[];
    configSchema?: Record<string, {
      type: string;
      description: string;
      required?: boolean;
      default?: unknown;
    }>;
  };
}

// --- Event Types (common events plugins can listen to) ---

export interface EmailEvent {
  id: string;
  from: string;
  subject: string;
  category: string;
  date: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
}

export interface TransactionEvent {
  id: string;
  amount: number;
  currency: string;
  type: 'credit' | 'debit';
  category: string;
  merchant: string;
}

export interface DocumentEvent {
  id: string;
  name: string;
  category: string;
}

// Event name constants
export const Events = {
  EMAIL_RECEIVED: 'email:received',
  EMAIL_CHECKED: 'email:checked',
  CALENDAR_SYNCED: 'calendar:synced',
  CALENDAR_CONFLICT: 'calendar:conflict',
  TRANSACTION_ADDED: 'finance:transaction',
  BUDGET_ALERT: 'finance:budget-alert',
  DOCUMENT_INGESTED: 'documents:ingested',
  SUBSCRIPTION_DETECTED: 'subscriptions:detected',
  SUBSCRIPTION_RENEWAL: 'subscriptions:renewal',
  BRIEFING_MORNING: 'briefing:morning',
  BRIEFING_EVENING: 'briefing:evening',
  AGENT_RESPONSE: 'agent:response',
} as const;
