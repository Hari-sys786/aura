import type { AiAdapter, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './adapter.js';
import type { Logger } from '../logger.js';

export class OllamaAdapter implements AiAdapter {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private log: Logger;

  constructor(baseUrl: string, model: string, logger: Logger, embeddingModel = 'all-minilm') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.embeddingModel = embeddingModel;
    this.log = logger;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 2048,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama chat failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      message: { content: string };
      model: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message.content,
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { embedding: number[] };
    return { vector: data.embedding, model: this.embeddingModel };
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
