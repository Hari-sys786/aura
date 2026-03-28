import { LRUCache } from 'lru-cache';
import type { Logger } from '../logger.js';

export class HotCache {
  private cache: LRUCache<string, object>;
  private log: Logger;
  private hits = 0;
  private misses = 0;

  constructor(logger: Logger, maxSize = 1000, ttlMs = 5 * 60 * 1000) {
    this.log = logger;
    this.cache = new LRUCache<string, object>({
      max: maxSize,
      ttl: ttlMs,
      updateAgeOnGet: true,
    });
    this.log.info(`Hot cache initialized (max=${maxSize}, ttl=${ttlMs}ms)`);
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get(key) as T | undefined;
    if (value !== undefined) {
      this.hits++;
    } else {
      this.misses++;
    }
    return value;
  }

  set(key: string, value: object, ttlMs?: number): void {
    this.cache.set(key, value, ttlMs ? { ttl: ttlMs } : undefined);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    const rate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A';
    return { size: this.cache.size, hits: this.hits, misses: this.misses, hitRate: rate };
  }
}
