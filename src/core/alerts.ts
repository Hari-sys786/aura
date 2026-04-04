import type { MemoryStore } from './storage/index.js';

interface AlertRecord {
  firedAt: number;
}

/**
 * AlertRegistry — deduplication layer for proactive notifications.
 * Persists fired timestamps in SQLite so alerts survive restarts.
 */
export class AlertRegistry {
  private store: MemoryStore;
  private readonly collection = 'alerts';

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Returns true if the alert has already fired within the cooldown window.
   */
  hasFired(key: string, cooldownMs: number): boolean {
    const record = this.store.get<AlertRecord>(this.collection, key);
    if (!record) return false;
    return Date.now() - record.firedAt < cooldownMs;
  }

  /**
   * Mark an alert as fired right now.
   */
  markFired(key: string): void {
    this.store.set(this.collection, key, { firedAt: Date.now() });
  }

  /**
   * Check and mark in one atomic call.
   * Returns true if the alert should fire (not in cooldown), and marks it fired.
   */
  shouldFire(key: string, cooldownMs: number): boolean {
    if (this.hasFired(key, cooldownMs)) return false;
    this.markFired(key);
    return true;
  }
}
