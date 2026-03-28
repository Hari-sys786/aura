import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Logger } from '../logger.js';

export interface KeyValue {
  key: string;
  value: string;
  collection: string;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export class SQLiteStore {
  private db: Database.Database;
  private log: Logger;

  constructor(dbPath: string, logger: Logger) {
    this.log = logger;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('busy_timeout = 5000');
    this.initTables();
    this.log.info(`SQLite initialized at ${dbPath} (WAL mode)`);
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT NOT NULL,
        collection TEXT NOT NULL DEFAULT 'default',
        value TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (collection, key)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        actor TEXT NOT NULL DEFAULT 'system',
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        plugin TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_kv_collection ON kv(collection);
    `);
  }

  set(collection: string, key: string, value: unknown, metadata?: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv (collection, key, value, metadata, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(collection, key) DO UPDATE SET
        value = excluded.value,
        metadata = excluded.metadata,
        updated_at = datetime('now')
    `);
    stmt.run(collection, key, JSON.stringify(value), metadata ? JSON.stringify(metadata) : null);
  }

  get<T = unknown>(collection: string, key: string): T | null {
    const stmt = this.db.prepare('SELECT value FROM kv WHERE collection = ? AND key = ?');
    const row = stmt.get(collection, key) as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as T;
  }

  delete(collection: string, key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM kv WHERE collection = ? AND key = ?');
    const result = stmt.run(collection, key);
    return result.changes > 0;
  }

  list(collection: string): KeyValue[] {
    const stmt = this.db.prepare('SELECT * FROM kv WHERE collection = ? ORDER BY updated_at DESC');
    return stmt.all(collection) as KeyValue[];
  }

  query(collection: string, filter: Record<string, unknown>): KeyValue[] {
    const rows = this.list(collection);
    return rows.filter(row => {
      if (!row.metadata) return false;
      const meta = JSON.parse(row.metadata);
      return Object.entries(filter).every(([k, v]) => meta[k] === v);
    });
  }

  // Audit logging
  audit(action: string, details?: Record<string, unknown>, actor = 'system', target?: string, plugin?: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO audit_log (actor, action, target, details, plugin) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(actor, action, target ?? null, details ? JSON.stringify(details) : null, plugin ?? null);
  }

  auditQuery(options: { action?: string; after?: string; before?: string; limit?: number }): unknown[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.action) {
      conditions.push('action = ?');
      params.push(options.action);
    }
    if (options.after) {
      conditions.push('timestamp >= ?');
      params.push(options.after);
    }
    if (options.before) {
      conditions.push('timestamp <= ?');
      params.push(options.before);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    const stmt = this.db.prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`);
    return stmt.all(...params, limit);
  }

  auditDeleteAll(): number {
    const stmt = this.db.prepare('DELETE FROM audit_log');
    const result = stmt.run();
    return result.changes;
  }

  // Transaction helper
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
    this.log.info('SQLite connection closed');
  }
}
