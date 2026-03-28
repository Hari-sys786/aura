import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import 'dotenv/config';

export interface AiConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'nvidia' | 'groq' | 'custom';
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface StorageConfig {
  dataDir: string;
  sqlitePath: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
}

export interface TelegramConfig {
  botToken: string;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

export interface AuraConfig {
  ai: AiConfig;
  storage: StorageConfig;
  server: ServerConfig;
  telegram: TelegramConfig;
  google: GoogleConfig;
  masterPassword: string;
  plugins: string[];
}

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function loadYamlConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function get(yaml: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = yaml;
  for (const part of parts) {
    if (DANGEROUS_KEYS.has(part)) return undefined;
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined && current !== null ? String(current) : undefined;
}

export function loadConfig(): AuraConfig {
  const yamlPath = resolve(process.cwd(), 'config.yaml');
  const yaml = loadYamlConfig(yamlPath);

  const config: AuraConfig = {
    ai: {
      provider: (get(yaml, 'ai.provider') ?? env('AI_PROVIDER', 'ollama')) as AiConfig['provider'],
      model: get(yaml, 'ai.model') ?? env('AI_MODEL', 'llama3.2'),
      baseUrl: get(yaml, 'ai.baseUrl') ?? env('AI_BASE_URL', 'http://localhost:11434'),
      apiKey: get(yaml, 'ai.apiKey') ?? env('AI_API_KEY'),
    },
    storage: {
      dataDir: get(yaml, 'storage.dataDir') ?? env('DATA_DIR', './data'),
      sqlitePath: get(yaml, 'storage.sqlitePath') ?? env('SQLITE_PATH', './data/aura.db'),
    },
    server: {
      port: parseInt(get(yaml, 'server.port') ?? env('PORT', '3000'), 10),
      host: get(yaml, 'server.host') ?? env('HOST', '0.0.0.0'),
      logLevel: get(yaml, 'server.logLevel') ?? env('LOG_LEVEL', 'info'),
    },
    telegram: {
      botToken: get(yaml, 'telegram.botToken') ?? env('TELEGRAM_BOT_TOKEN'),
    },
    google: {
      clientId: get(yaml, 'google.clientId') ?? env('GOOGLE_CLIENT_ID'),
      clientSecret: get(yaml, 'google.clientSecret') ?? env('GOOGLE_CLIENT_SECRET'),
      redirectUri: get(yaml, 'google.redirectUri') ?? env('GOOGLE_REDIRECT_URI', 'http://localhost:3000/auth/google/callback'),
      refreshToken: get(yaml, 'google.refreshToken') ?? env('GOOGLE_REFRESH_TOKEN'),
    },
    masterPassword: get(yaml, 'masterPassword') ?? env('MASTER_PASSWORD'),
    plugins: [],
  };

  const yamlPlugins = get(yaml, 'plugins');
  if (yamlPlugins) {
    config.plugins = String(yamlPlugins).split(',').map(p => p.trim()).filter(Boolean);
  }

  validate(config);
  return config;
}

function validate(config: AuraConfig): void {
  const errors: string[] = [];

  if (!config.ai.provider) {
    errors.push('AI_PROVIDER is required (ollama|openai|anthropic|nvidia|groq|custom)');
  }

  if (!config.ai.model) {
    errors.push('AI_MODEL is required');
  }

  if (config.ai.provider !== 'ollama' && !config.ai.apiKey) {
    errors.push(`AI_API_KEY is required for provider "${config.ai.provider}"`);
  }

  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
