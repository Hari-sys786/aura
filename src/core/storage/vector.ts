import type { Logger } from '../logger.js';

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorSearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
}

/**
 * Vector store abstraction.
 * LanceDB integration will be added once the package is available.
 * For now, provides an in-memory fallback with brute-force cosine similarity.
 */
export class VectorStore {
  private collections: Map<string, VectorRecord[]> = new Map();
  private log: Logger;

  constructor(dataDir: string, logger: Logger) {
    this.log = logger;
    this.log.info(`Vector store initialized (in-memory mode, data dir: ${dataDir})`);
  }

  async add(collection: string, records: VectorRecord[]): Promise<void> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, []);
    }
    const col = this.collections.get(collection)!;

    for (const record of records) {
      const existing = col.findIndex(r => r.id === record.id);
      if (existing >= 0) {
        col[existing] = record;
      } else {
        col.push(record);
      }
    }

    this.log.debug(`Added ${records.length} vectors to "${collection}" (total: ${col.length})`);
  }

  async search(collection: string, queryVector: number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    const { topK = 10, filter } = options;
    const col = this.collections.get(collection);
    if (!col || col.length === 0) return [];

    let candidates = col;

    // Pre-filter by metadata
    if (filter) {
      candidates = candidates.filter(record =>
        Object.entries(filter).every(([k, v]) => record.metadata[k] === v)
      );
    }

    // Compute cosine similarity
    const scored = candidates.map(record => ({
      id: record.id,
      text: record.text,
      score: cosineSimilarity(queryVector, record.vector),
      metadata: record.metadata,
    }));

    // Sort by score descending, return top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(collection: string, ids: string[]): Promise<number> {
    const col = this.collections.get(collection);
    if (!col) return 0;

    const idSet = new Set(ids);
    const before = col.length;
    const filtered = col.filter(r => !idSet.has(r.id));
    this.collections.set(collection, filtered);
    return before - filtered.length;
  }

  async count(collection: string): Promise<number> {
    return this.collections.get(collection)?.length ?? 0;
  }

  async drop(collection: string): Promise<void> {
    this.collections.delete(collection);
  }

  close(): void {
    this.collections.clear();
    this.log.info('Vector store closed');
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
