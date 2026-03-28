import { SQLiteStore } from './sqlite.js';
import { VectorStore } from './vector.js';
import { HotCache } from './cache.js';
import type { VectorRecord, VectorSearchResult, VectorSearchOptions } from './vector.js';
import type { Logger } from '../logger.js';
import type { StorageConfig } from '../config.js';

export { SQLiteStore } from './sqlite.js';
export { VectorStore } from './vector.js';
export { HotCache } from './cache.js';
export type { VectorRecord, VectorSearchResult, VectorSearchOptions } from './vector.js';

/**
 * Unified memory store combining SQLite (structured), LanceDB (vectors), and LRU cache (hot).
 */
export class MemoryStore {
  readonly sqlite: SQLiteStore;
  readonly vector: VectorStore;
  readonly cache: HotCache;

  constructor(config: StorageConfig, logger: Logger) {
    this.sqlite = new SQLiteStore(config.sqlitePath, logger);
    this.vector = new VectorStore(config.dataDir, logger);
    this.cache = new HotCache(logger);
  }

  // Structured data (with cache layer)
  set(collection: string, key: string, value: object, metadata?: Record<string, unknown>): void {
    this.sqlite.set(collection, key, value, metadata);
    this.cache.set(`${collection}:${key}`, value);
  }

  get<T extends object = Record<string, unknown>>(collection: string, key: string): T | null {
    const cached = this.cache.get<T>(`${collection}:${key}`);
    if (cached !== undefined) return cached;

    const value = this.sqlite.get<T>(collection, key);
    if (value !== null) {
      this.cache.set(`${collection}:${key}`, value as object);
    }
    return value;
  }

  delete(collection: string, key: string): boolean {
    this.cache.delete(`${collection}:${key}`);
    return this.sqlite.delete(collection, key);
  }

  // Vector operations (pass-through)
  async vectorAdd(collection: string, records: VectorRecord[]): Promise<void> {
    return this.vector.add(collection, records);
  }

  async vectorSearch(collection: string, query: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
    return this.vector.search(collection, query, options);
  }

  // Audit (pass-through)
  audit(action: string, details?: Record<string, unknown>, actor?: string): void {
    this.sqlite.audit(action, details, actor);
  }

  // Lifecycle
  close(): void {
    this.sqlite.close();
    this.vector.close();
    this.cache.clear();
  }
}
