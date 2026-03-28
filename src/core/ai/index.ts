import type { AiAdapter } from './adapter.js';
import type { AiConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';

export type { AiAdapter, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './adapter.js';

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};

export function createAiAdapter(config: AiConfig, logger: Logger): AiAdapter {
  if (config.provider === 'ollama') {
    return new OllamaAdapter(config.baseUrl, config.model, logger);
  }

  const baseUrl = config.provider === 'custom'
    ? config.baseUrl
    : PROVIDER_URLS[config.provider] ?? config.baseUrl;

  return new OpenAICompatibleAdapter(
    config.provider,
    baseUrl,
    config.model,
    config.apiKey,
    logger,
  );
}
