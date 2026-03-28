export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingResponse {
  vector: number[];
  model: string;
}

/**
 * Abstract AI adapter — all providers implement this interface.
 */
export interface AiAdapter {
  readonly name: string;

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  embed(text: string): Promise<EmbeddingResponse>;

  /** Health check — returns true if the provider is reachable */
  ping(): Promise<boolean>;
}
