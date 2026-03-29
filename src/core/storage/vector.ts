import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import type { Logger } from '../logger.js';

const require = createRequire(import.meta.url);

// LanceDB types
type Connection = { openTable(name: string): Promise<Table>; createTable(name: string, data: unknown[]): Promise<Table>; dropTable(name: string): Promise<void> };
type Table = { add(data: unknown[]): Promise<void>; search(vector: number[]): { limit(n: number): { toArray(): Promise<Record<string, unknown>[]> } }; delete(filter: string): Promise<void>; countRows(): Promise<number> };

let lancedbConnect: ((uri: string) => Promise<Connection>) | null = null;
try {
  const lancedb = require('@lancedb/lancedb');
  lancedbConnect = lancedb.connect;
} catch {
  // LanceDB not available, will use fallback
}

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

export class VectorStore {
  private db: Connection | null = null;
  private tables: Map<string, Table> = new Map();
  private log: Logger;
  private dataDir: string;
  private ready = false;

  // In-memory fallback for when LanceDB isn't available
  private fallbackCollections: Map<string, VectorRecord[]> = new Map();
  private useFallback = false;

  constructor(dataDir: string, logger: Logger) {
    this.dataDir = dataDir;
    this.log = logger;
    // Init is async — will fall back to in-memory until ready
    this.init().catch(err => {
      this.log.warn(`Vector store async init failed: ${err}`);
      this.useFallback = true;
      this.ready = true;
    });
  }

  private async init(): Promise<void> {
    if (!lancedbConnect) {
      this.log.warn('LanceDB not available, using in-memory fallback');
      this.useFallback = true;
      this.ready = true;
      return;
    }
    try {
      const dbPath = `${this.dataDir}/lancedb`;
      mkdirSync(dbPath, { recursive: true });
      this.db = await lancedbConnect(dbPath);
      this.ready = true;
      this.log.info(`LanceDB initialized at ${dbPath}`);
    } catch (err) {
      this.log.warn(`LanceDB init failed, using in-memory fallback: ${err}`);
      this.useFallback = true;
      this.ready = true;
    }
  }

  private async ensureReady(): Promise<void> {
    // Wait for async init (max 2 seconds)
    let attempts = 0;
    while (!this.ready && attempts < 20) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (!this.ready) {
      this.useFallback = true;
      this.ready = true;
    }
  }

  async add(collection: string, records: VectorRecord[]): Promise<void> {
    await this.ensureReady();

    if (this.useFallback) {
      return this.fallbackAdd(collection, records);
    }

    try {
      const data = records.map(r => ({
        id: r.id,
        text: r.text,
        vector: r.vector,
        metadata_json: JSON.stringify(r.metadata),
      }));

      let table = this.tables.get(collection);
      if (!table) {
        try {
          table = await this.db!.openTable(collection);
        } catch {
          // Table doesn't exist, create it
          table = await this.db!.createTable(collection, data);
          this.tables.set(collection, table);
          this.log.debug(`Created LanceDB table "${collection}" with ${records.length} records`);
          return;
        }
        this.tables.set(collection, table);
      }

      await table.add(data);
      this.log.debug(`Added ${records.length} vectors to "${collection}"`);
    } catch (err) {
      this.log.error(`LanceDB add failed, falling back: ${err}`);
      this.fallbackAdd(collection, records);
    }
  }

  async search(collection: string, queryVector: number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    await this.ensureReady();

    if (this.useFallback) {
      return this.fallbackSearch(collection, queryVector, options);
    }

    const { topK = 10, filter } = options;

    try {
      let table = this.tables.get(collection);
      if (!table) {
        try {
          table = await this.db!.openTable(collection);
          this.tables.set(collection, table);
        } catch {
          return [];
        }
      }

      const query = table.search(queryVector).limit(topK);
      const results = await query.toArray();

      let mapped = results.map((row: Record<string, unknown>) => ({
        id: row['id'] as string,
        text: row['text'] as string,
        score: 1 - ((row['_distance'] as number) ?? 0), // LanceDB returns distance, convert to similarity
        metadata: JSON.parse((row['metadata_json'] as string) ?? '{}'),
      }));

      // Apply metadata filter
      if (filter) {
        mapped = mapped.filter(r =>
          Object.entries(filter).every(([k, v]) => r.metadata[k] === v)
        );
      }

      return mapped;
    } catch (err) {
      this.log.error(`LanceDB search failed: ${err}`);
      return this.fallbackSearch(collection, queryVector, options);
    }
  }

  async delete(collection: string, ids: string[]): Promise<number> {
    await this.ensureReady();

    if (this.useFallback) {
      return this.fallbackDelete(collection, ids);
    }

    try {
      let table = this.tables.get(collection);
      if (!table) {
        try {
          table = await this.db!.openTable(collection);
          this.tables.set(collection, table);
        } catch {
          return 0;
        }
      }

      const filter = ids.map(id => `id = '${id.replace(/'/g, "''")}'`).join(' OR ');
      await table.delete(filter);
      return ids.length;
    } catch (err) {
      this.log.error(`LanceDB delete failed: ${err}`);
      return 0;
    }
  }

  async count(collection: string): Promise<number> {
    await this.ensureReady();

    if (this.useFallback) {
      return this.fallbackCollections.get(collection)?.length ?? 0;
    }

    try {
      let table = this.tables.get(collection);
      if (!table) {
        try {
          table = await this.db!.openTable(collection);
          this.tables.set(collection, table);
        } catch {
          return 0;
        }
      }
      return await table.countRows();
    } catch {
      return 0;
    }
  }

  async drop(collection: string): Promise<void> {
    await this.ensureReady();

    if (this.useFallback) {
      this.fallbackCollections.delete(collection);
      return;
    }

    try {
      await this.db!.dropTable(collection);
      this.tables.delete(collection);
    } catch { /* table may not exist */ }
  }

  close(): void {
    this.tables.clear();
    this.fallbackCollections.clear();
    this.db = null;
    this.log.info('Vector store closed');
  }

  // --- In-memory fallback (same as original) ---

  private fallbackAdd(collection: string, records: VectorRecord[]): void {
    if (!this.fallbackCollections.has(collection)) {
      this.fallbackCollections.set(collection, []);
    }
    const col = this.fallbackCollections.get(collection)!;

    for (const record of records) {
      const existing = col.findIndex(r => r.id === record.id);
      if (existing >= 0) {
        col[existing] = record;
      } else {
        col.push(record);
      }
    }
  }

  private fallbackSearch(collection: string, queryVector: number[], options: VectorSearchOptions = {}): VectorSearchResult[] {
    const { topK = 10, filter } = options;
    const col = this.fallbackCollections.get(collection);
    if (!col || col.length === 0) return [];

    let candidates = col;

    if (filter) {
      candidates = candidates.filter(record =>
        Object.entries(filter).every(([k, v]) => record.metadata[k] === v)
      );
    }

    const scored = candidates.map(record => ({
      id: record.id,
      text: record.text,
      score: cosineSimilarity(queryVector, record.vector),
      metadata: record.metadata,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private fallbackDelete(collection: string, ids: string[]): number {
    const col = this.fallbackCollections.get(collection);
    if (!col) return 0;

    const idSet = new Set(ids);
    const before = col.length;
    const filtered = col.filter(r => !idSet.has(r.id));
    this.fallbackCollections.set(collection, filtered);
    return before - filtered.length;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
