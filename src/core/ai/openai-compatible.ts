import type { AiAdapter, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './adapter.js';
import type { Logger } from '../logger.js';

/**
 * OpenAI-compatible adapter — works with OpenAI, NVIDIA, Groq, and any compatible endpoint.
 */
export class OpenAICompatibleAdapter implements AiAdapter {
  readonly name: string;
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private apiKey: string;
  private log: Logger;

  constructor(
    providerName: string,
    baseUrl: string,
    model: string,
    apiKey: string,
    logger: Logger,
    embeddingModel = 'text-embedding-3-small',
  ) {
    this.name = providerName;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.embeddingModel = embeddingModel;
    this.log = logger;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} chat failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} embedding failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }>; model: string };
    return { vector: data.data[0].embedding, model: data.model };
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
