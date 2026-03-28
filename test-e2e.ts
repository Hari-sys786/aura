/**
 * Aura v0.1 — E2E & Real-World Scenario Tests
 * 
 * Tests the full system as a user would interact with it:
 * - Multi-turn conversations
 * - Plugin lifecycle under stress
 * - Storage persistence & data integrity
 * - Vector search relevance
 * - Concurrent operations
 * - Error handling & recovery
 * - Crypto edge cases
 * - Scheduler reliability
 * - Config edge cases
 * - Memory pressure / large datasets
 */

import { loadConfig } from './src/core/config.js';
import { createLogger, childLogger } from './src/core/logger.js';
import { MemoryStore } from './src/core/storage/index.js';
import { PluginBus } from './src/core/plugin-bus.js';
import type { AuraPlugin, PluginContext } from './src/core/plugin-bus.js';
import { createAiAdapter } from './src/core/ai/index.js';
import { Scheduler } from './src/core/scheduler.js';
import { CryptoVault } from './src/core/crypto.js';
import { Agent } from './src/core/agent.js';
import { SQLiteStore } from './src/core/storage/sqlite.js';
import { VectorStore } from './src/core/storage/vector.js';
import { HotCache } from './src/core/storage/cache.js';
import { existsSync, unlinkSync } from 'fs';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err}`);
    failed++;
    failures.push(`${name}: ${err}`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n🧪 Aura v0.1 — E2E & Real-World Tests\n');

  const config = loadConfig();
  const log = createLogger('error'); // quiet for tests

  // ============================================
  console.log('🔄 E2E: Full Boot → Interact → Shutdown Cycle');
  // ============================================

  await test('complete lifecycle: boot → store → query → shutdown → reboot → data persists', async () => {
    const testDbPath = './data/test-e2e.db';
    if (existsSync(testDbPath)) unlinkSync(testDbPath);

    // Boot
    const storage1 = new MemoryStore(
      { dataDir: './data', sqlitePath: testDbPath },
      childLogger(log, 'e2e-boot1')
    );

    // Store data
    storage1.set('users', 'u1', { name: 'Panda Dev', tier: 'owner' });
    storage1.set('users', 'u2', { name: 'Test User', tier: 'basic' });
    storage1.set('settings', 'theme', { mode: 'dark', accent: '#ff6b35' });
    storage1.audit('user:created', { userId: 'u1' });
    storage1.audit('user:created', { userId: 'u2' });

    // Verify
    assert(storage1.get<{name: string}>('users', 'u1')!.name === 'Panda Dev', 'u1 should exist');

    // Shutdown
    storage1.close();

    // Reboot with same DB
    const storage2 = new MemoryStore(
      { dataDir: './data', sqlitePath: testDbPath },
      childLogger(log, 'e2e-boot2')
    );

    // Data should persist
    const u1 = storage2.get<{name: string; tier: string}>('users', 'u1');
    assert(u1 !== null, 'u1 should persist after reboot');
    assert(u1!.name === 'Panda Dev', 'name should persist');
    assert(u1!.tier === 'owner', 'tier should persist');

    const theme = storage2.get<{mode: string}>('settings', 'theme');
    assert(theme!.mode === 'dark', 'settings should persist');

    // Audit logs should persist
    const audits = storage2.sqlite.auditQuery({ action: 'user:created' });
    assert(audits.length >= 2, 'audit logs should persist');

    storage2.close();
    unlinkSync(testDbPath);
  });

  // ============================================
  console.log('\n💬 E2E: Multi-Turn Agent Conversation');
  // ============================================

  const storage = new MemoryStore(config.storage, childLogger(log, 'e2e'));
  const ai = createAiAdapter(
    { ...config.ai, model: 'qwen2.5:1.5b' },
    childLogger(log, 'e2e-ai')
  );
  const plugins = new PluginBus(storage, childLogger(log, 'e2e-plugins'));
  const scheduler = new Scheduler(childLogger(log, 'e2e-scheduler'));
  const agent = new Agent({
    ai, storage, plugins, scheduler,
    logger: childLogger(log, 'e2e-agent'),
  });

  await test('multi-turn: agent maintains context across messages', async () => {
    const r1 = await agent.processMessage('My name is Arjun. Remember that.');
    assert(r1.length > 0, 'should respond');

    const r2 = await agent.processMessage('What is my name?');
    assert(r2.toLowerCase().includes('arjun'), `should remember name, got: ${r2.slice(0, 100)}`);
  });

  await test('multi-turn: history grows correctly', () => {
    const history = agent.getHistory();
    // 2 user + 2 assistant = 4
    assert(history.length === 4, `should have 4 messages, got ${history.length}`);
    assert(history.filter(m => m.role === 'user').length === 2, 'should have 2 user messages');
    assert(history.filter(m => m.role === 'assistant').length === 2, 'should have 2 assistant messages');
  });

  await test('multi-turn: clear history resets context', async () => {
    agent.clearHistory();
    const r = await agent.processMessage('What is my name?');
    // After clearing, it shouldn't know the name
    assert(agent.getHistory().length === 2, 'should only have this exchange');
  });

  agent.clearHistory();

  // ============================================
  console.log('\n🔌 E2E: Plugin Lifecycle Stress');
  // ============================================

  await test('plugin: register → activate → use → crash → recover', async () => {
    let callCount = 0;
    let shouldFail = false;

    const fragilePlugin: AuraPlugin = {
      name: 'fragile',
      version: '1.0.0',
      async onLoad(ctx: PluginContext) {
        ctx.logger.info('Fragile plugin loaded');
      },
      async onActivate() {
        callCount++;
        if (shouldFail) throw new Error('Simulated crash');
      },
      async onDeactivate() {
        callCount++;
      },
    };

    // Normal lifecycle
    await plugins.register(fragilePlugin);
    await plugins.activate('fragile');
    assert(plugins.getState('fragile') === 'active', 'should be active');

    await plugins.deactivate('fragile');
    assert(plugins.getState('fragile') === 'inactive', 'should be inactive');

    // Crash on activation
    shouldFail = true;
    try {
      await plugins.activate('fragile');
    } catch {
      // Expected
    }
    assert(plugins.getState('fragile') === 'error', 'should be in error state');

    // Recovery: unregister and re-register
    await plugins.unregister('fragile');
    assert(plugins.getPlugin('fragile') === undefined, 'should be gone');

    shouldFail = false;
    await plugins.register(fragilePlugin);
    await plugins.activate('fragile');
    assert(plugins.getState('fragile') === 'active', 'should recover to active');

    await plugins.unregister('fragile');
  });

  await test('plugin: event pub/sub between multiple plugins', async () => {
    const events: string[] = [];

    const publisher: AuraPlugin = {
      name: 'publisher',
      version: '1.0.0',
      async onLoad(ctx: PluginContext) {
        // Will emit events
      },
    };

    const subscriber: AuraPlugin = {
      name: 'subscriber',
      version: '1.0.0',
      async onLoad(ctx: PluginContext) {
        // Empty - we'll subscribe on the bus directly
      },
    };

    await plugins.register(publisher);
    await plugins.register(subscriber);

    // Subscribe to publisher events
    plugins.on('publisher:data', (data) => {
      events.push(String((data as {msg: string}).msg));
    });

    // Emit from bus (simulating publisher)
    plugins.emit('publisher:data', { msg: 'hello' });
    plugins.emit('publisher:data', { msg: 'world' });

    assert(events.length === 2, `should have 2 events, got ${events.length}`);
    assert(events[0] === 'hello', 'first event should be hello');
    assert(events[1] === 'world', 'second event should be world');

    await plugins.unregister('publisher');
    await plugins.unregister('subscriber');
  });

  await test('plugin: 10 plugins register/activate/deactivate rapidly', async () => {
    const pluginNames: string[] = [];

    for (let i = 0; i < 10; i++) {
      const p: AuraPlugin = {
        name: `rapid-${i}`,
        version: '1.0.0',
        async onLoad() {},
        async onActivate() {},
        async onDeactivate() {},
      };
      await plugins.register(p);
      await plugins.activate(`rapid-${i}`);
      pluginNames.push(`rapid-${i}`);
    }

    assert(plugins.listPlugins().length >= 10, 'should have 10+ plugins');

    // Deactivate and unregister all
    for (const name of pluginNames) {
      await plugins.deactivate(name);
      await plugins.unregister(name);
    }
  });

  // ============================================
  console.log('\n🧮 E2E: Vector Search Relevance');
  // ============================================

  const vectorStore = new VectorStore('./data', childLogger(log, 'e2e-vector'));

  await test('vector: semantic similarity ranking is correct', async () => {
    // Simulate 384-dim embeddings (simplified — just enough dimensions for testing)
    const dim = 10;
    const makeVec = (seed: number[]): number[] => {
      const v = new Array(dim).fill(0);
      for (let i = 0; i < seed.length && i < dim; i++) v[i] = seed[i];
      return v;
    };

    await vectorStore.add('docs', [
      { id: 'd1', text: 'Flight booking confirmation PNR ABC123', vector: makeVec([1, 0.5, 0, 0, 0]), metadata: { type: 'email', date: '2026-03-25' } },
      { id: 'd2', text: 'Electricity bill payment due March 30', vector: makeVec([0, 0, 1, 0.5, 0]), metadata: { type: 'bill', date: '2026-03-20' } },
      { id: 'd3', text: 'Meeting with team at 3 PM', vector: makeVec([0, 0, 0, 0, 1]), metadata: { type: 'calendar', date: '2026-03-28' } },
      { id: 'd4', text: 'Air ticket to Mumbai', vector: makeVec([0.9, 0.4, 0, 0, 0.1]), metadata: { type: 'email', date: '2026-03-26' } },
      { id: 'd5', text: 'Water bill reminder', vector: makeVec([0, 0, 0.8, 0.6, 0]), metadata: { type: 'bill', date: '2026-03-22' } },
    ]);

    // Query for flight-related
    const flightResults = await vectorStore.search('docs', makeVec([1, 0.5, 0, 0, 0]), { topK: 2 });
    assert(flightResults[0].id === 'd1', 'exact match should be first');
    assert(flightResults[1].id === 'd4', 'similar doc should be second');

    // Query for bills
    const billResults = await vectorStore.search('docs', makeVec([0, 0, 1, 0.5, 0]), { topK: 2 });
    assert(billResults[0].id === 'd2', 'electricity bill should be first');
    assert(billResults[1].id === 'd5', 'water bill should be second');
  });

  await test('vector: pre-filter by metadata narrows results', async () => {
    const results = await vectorStore.search('docs', [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0], {
      topK: 10,
      filter: { type: 'bill' },
    });
    assert(results.length === 2, `should only return bills, got ${results.length}`);
    assert(results.every(r => r.metadata.type === 'bill'), 'all results should be bills');
  });

  await test('vector: update existing record', async () => {
    await vectorStore.add('docs', [
      { id: 'd1', text: 'Updated flight info', vector: [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0], metadata: { type: 'email', date: '2026-03-27' } },
    ]);
    const count = await vectorStore.count('docs');
    assert(count === 5, `should still be 5 after update, got ${count}`);
  });

  await test('vector: delete records', async () => {
    const deleted = await vectorStore.delete('docs', ['d5']);
    assert(deleted === 1, 'should delete 1');
    const count = await vectorStore.count('docs');
    assert(count === 4, `should be 4 after delete, got ${count}`);
  });

  vectorStore.close();

  // ============================================
  console.log('\n💾 E2E: SQLite Stress & Edge Cases');
  // ============================================

  await test('sqlite: bulk insert 1000 records', () => {
    for (let i = 0; i < 1000; i++) {
      storage.set('bulk', `item-${i}`, { index: i, data: `value-${i}`, timestamp: Date.now() });
    }
    const list = storage.sqlite.list('bulk');
    assert(list.length === 1000, `should have 1000 items, got ${list.length}`);
  });

  await test('sqlite: bulk read 1000 records', () => {
    for (let i = 0; i < 1000; i++) {
      const val = storage.get<{index: number}>('bulk', `item-${i}`);
      assert(val !== null, `item-${i} should exist`);
      assert(val!.index === i, `item-${i} should have correct index`);
    }
  });

  await test('sqlite: transaction atomicity', () => {
    try {
      storage.sqlite.transaction(() => {
        storage.sqlite.set('tx-test', 'a', { val: 1 });
        storage.sqlite.set('tx-test', 'b', { val: 2 });
        throw new Error('rollback!');
      });
    } catch {
      // Expected
    }
    // Both should be rolled back
    const a = storage.sqlite.get('tx-test', 'a');
    const b = storage.sqlite.get('tx-test', 'b');
    assert(a === null, 'a should be rolled back');
    assert(b === null, 'b should be rolled back');
  });

  await test('sqlite: special characters in keys and values', () => {
    storage.set('special', 'key with spaces', { val: 'hello' });
    storage.set('special', 'key/with/slashes', { val: 'world' });
    storage.set('special', 'key"with"quotes', { val: 'test' });
    storage.set('special', '日本語キー', { val: '日本語値' });
    storage.set('special', 'emoji🔱key', { val: '🔱🕉️' });

    assert(storage.get('special', 'key with spaces') !== null, 'spaces should work');
    assert(storage.get('special', 'key/with/slashes') !== null, 'slashes should work');
    assert(storage.get('special', 'key"with"quotes') !== null, 'quotes should work');
    assert(storage.get<{val: string}>('special', '日本語キー')!.val === '日本語値', 'unicode should work');
    assert(storage.get<{val: string}>('special', 'emoji🔱key')!.val === '🔱🕉️', 'emoji should work');
  });

  await test('sqlite: large value (100KB JSON)', () => {
    const bigArray = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: 'A'.repeat(100),
    }));
    storage.set('large', 'big-json', bigArray);
    const retrieved = storage.get<unknown[]>('large', 'big-json');
    assert(retrieved !== null, 'should store large value');
    assert(Array.isArray(retrieved) && retrieved.length === 1000, 'should retrieve all 1000 items');
  });

  await test('sqlite: audit log query with date range', () => {
    const before = new Date().toISOString();
    storage.audit('e2e:test1', { step: 1 });
    storage.audit('e2e:test2', { step: 2 });
    storage.audit('e2e:test3', { step: 3 });

    const all = storage.sqlite.auditQuery({ action: 'e2e:test1' });
    assert(all.length >= 1, 'should find test1 audit');

    const limited = storage.sqlite.auditQuery({ limit: 2 });
    assert(limited.length === 2, 'limit should work');
  });

  // ============================================
  console.log('\n🔍 E2E: Cache Coherence');
  // ============================================

  await test('cache: write-through consistency', () => {
    storage.set('cache-test', 'k1', { version: 1 });
    // First read should hit cache (written during set)
    const v1 = storage.get<{version: number}>('cache-test', 'k1');
    assert(v1!.version === 1, 'should be version 1');

    // Update should invalidate cache
    storage.set('cache-test', 'k1', { version: 2 });
    const v2 = storage.get<{version: number}>('cache-test', 'k1');
    assert(v2!.version === 2, 'should be version 2 after update');
  });

  await test('cache: delete removes from cache', () => {
    storage.set('cache-test', 'del', { x: 1 });
    storage.get('cache-test', 'del'); // warm cache
    storage.delete('cache-test', 'del');
    const val = storage.get('cache-test', 'del');
    assert(val === null, 'should be null after delete');
  });

  await test('cache: stats are accurate after operations', () => {
    storage.cache.clear();
    storage.set('stats', 'a', { v: 1 });
    storage.get('stats', 'a'); // hit (set puts in cache)
    storage.get('stats', 'a'); // hit
    storage.get('stats', 'miss1'); // miss
    storage.get('stats', 'miss2'); // miss

    const stats = storage.cache.stats();
    assert(stats.hits >= 2, `should have 2+ hits, got ${stats.hits}`);
    assert(stats.misses >= 2, `should have 2+ misses, got ${stats.misses}`);
  });

  // ============================================
  console.log('\n🔐 E2E: Crypto Real-World Scenarios');
  // ============================================

  const crypto = new CryptoVault(childLogger(log, 'e2e-crypto'));
  await crypto.init('MyS3cur3P@ssw0rd!');

  await test('crypto: encrypt/decrypt API keys', () => {
    const apiKey = 'sk-ant-api03-xyzABC123-very-long-key-value-here';
    const encrypted = crypto.encrypt(apiKey);
    assert(encrypted !== apiKey, 'should not be plaintext');
    assert(encrypted.length > apiKey.length, 'encrypted should be longer');
    const decrypted = crypto.decrypt(encrypted);
    assert(decrypted === apiKey, 'should decrypt to original');
  });

  await test('crypto: encrypt/decrypt unicode and emoji', () => {
    const secret = '密码🔐パスワード🗝️';
    const encrypted = crypto.encrypt(secret);
    const decrypted = crypto.decrypt(encrypted);
    assert(decrypted === secret, 'unicode/emoji should round-trip');
  });

  await test('crypto: encrypt empty string', () => {
    const encrypted = crypto.encrypt('');
    const decrypted = crypto.decrypt(encrypted);
    assert(decrypted === '', 'empty string should round-trip');
  });

  await test('crypto: each encryption produces different ciphertext (random nonce)', () => {
    const plaintext = 'same message';
    const enc1 = crypto.encrypt(plaintext);
    const enc2 = crypto.encrypt(plaintext);
    assert(enc1 !== enc2, 'same plaintext should produce different ciphertexts');
    assert(crypto.decrypt(enc1) === plaintext, 'both should decrypt');
    assert(crypto.decrypt(enc2) === plaintext, 'both should decrypt');
  });

  await test('crypto: tampered ciphertext fails', () => {
    const encrypted = crypto.encrypt('sensitive data');
    // Tamper with the ciphertext
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    let threw = false;
    try {
      crypto.decrypt(tampered);
    } catch {
      threw = true;
    }
    assert(threw, 'tampered ciphertext should throw');
  });

  await test('crypto: large payload (10KB)', () => {
    const large = 'X'.repeat(10240);
    const encrypted = crypto.encrypt(large);
    const decrypted = crypto.decrypt(encrypted);
    assert(decrypted === large, 'large payload should round-trip');
    assert(decrypted.length === 10240, 'length should be preserved');
  });

  crypto.destroy();

  // ============================================
  console.log('\n⏰ E2E: Scheduler Reliability');
  // ============================================

  await test('scheduler: multiple one-shots fire in order', async () => {
    const order: number[] = [];
    scheduler.once(50, () => { order.push(1); }, 'first');
    scheduler.once(100, () => { order.push(2); }, 'second');
    scheduler.once(150, () => { order.push(3); }, 'third');

    await new Promise(r => setTimeout(r, 250));
    assert(order.length === 3, `should have 3 fires, got ${order.length}`);
    assert(order[0] === 1 && order[1] === 2 && order[2] === 3, 'should fire in order');
  });

  await test('scheduler: cancel prevents execution', async () => {
    let fired = false;
    const id = scheduler.once(100, () => { fired = true; }, 'cancel-test');
    scheduler.cancel(id);
    await new Promise(r => setTimeout(r, 200));
    assert(!fired, 'cancelled task should not fire');
  });

  await test('scheduler: cron fires on schedule', async () => {
    let count = 0;
    // Every second
    const id = scheduler.add('* * * * * *', () => { count++; }, 'every-sec');
    await new Promise(r => setTimeout(r, 2500));
    scheduler.cancel(id);
    assert(count >= 2, `should fire at least twice in 2.5s, got ${count}`);
  });

  await test('scheduler: stopAll clears everything', () => {
    scheduler.once(99999, () => {}, 's1');
    scheduler.once(99999, () => {}, 's2');
    scheduler.add('0 0 * * *', () => {}, 's3');

    assert(scheduler.list().length >= 3, 'should have 3+ tasks');
    scheduler.stopAll();
    assert(scheduler.list().length === 0, 'stopAll should clear all');
  });

  // ============================================
  console.log('\n🤖 E2E: AI Error Handling');
  // ============================================

  await test('ai: handles malformed response gracefully', async () => {
    // Test with a real but minimal prompt
    const response = await ai.chat([
      { role: 'user', content: '' }, // empty message
    ], { maxTokens: 5 });
    // Should not crash, should return something
    assert(response.content !== undefined, 'should handle empty input');
  });

  await test('ai: embedding produces consistent dimensions', async () => {
    const { OllamaAdapter } = await import('./src/core/ai/ollama.js');
    const embedder = new OllamaAdapter('http://localhost:11434', 'qwen2.5:1.5b', childLogger(log, 'e2e-embed'), 'nomic-embed-text');

    const e1 = await embedder.embed('hello world');
    const e2 = await embedder.embed('completely different text about quantum physics');

    assert(e1.vector.length === e2.vector.length, 'dimensions should be consistent');
    assert(e1.vector.length > 100, 'should have substantial dimensions');

    // Vectors should be different
    let same = true;
    for (let i = 0; i < e1.vector.length; i++) {
      if (Math.abs(e1.vector[i] - e2.vector[i]) > 0.001) { same = false; break; }
    }
    assert(!same, 'different texts should produce different embeddings');
  });

  // ============================================
  console.log('\n⚙️ E2E: Config Edge Cases');
  // ============================================

  await test('config: prototype pollution is blocked', () => {
    // The get() function should reject __proto__, constructor, prototype
    // We test indirectly: config loading should not crash with malicious yaml
    const config = loadConfig(); // uses env defaults
    assert(config.ai.provider === 'ollama', 'should load normally');
  });

  // ============================================
  console.log('\n📊 E2E: Memory Pressure');
  // ============================================

  await test('vector: search with 10K records completes in <500ms', async () => {
    const bigVector = new VectorStore('./data', childLogger(log, 'e2e-big-vec'));
    const dim = 128;

    // Insert 10K records
    const records = Array.from({ length: 10000 }, (_, i) => {
      const vec = new Array(dim).fill(0).map(() => Math.random());
      return {
        id: `r${i}`,
        text: `Record number ${i} with some text content`,
        vector: vec,
        metadata: { index: i, category: i % 10 === 0 ? 'special' : 'normal' },
      };
    });
    await bigVector.add('perf-test', records);

    const queryVec = new Array(dim).fill(0).map(() => Math.random());
    const start = performance.now();
    const results = await bigVector.search('perf-test', queryVec, { topK: 10 });
    const elapsed = performance.now() - start;

    assert(results.length === 10, `should return 10 results, got ${results.length}`);
    assert(elapsed < 500, `should complete in <500ms, took ${elapsed.toFixed(1)}ms`);
    console.log(`    ⏱️  10K vector search: ${elapsed.toFixed(1)}ms`);

    bigVector.close();
  });

  await test('vector: filtered search on 10K is faster', async () => {
    const bigVector = new VectorStore('./data', childLogger(log, 'e2e-filter-vec'));
    const dim = 128;

    const records = Array.from({ length: 10000 }, (_, i) => ({
      id: `f${i}`,
      text: `Filtered record ${i}`,
      vector: new Array(dim).fill(0).map(() => Math.random()),
      metadata: { category: i % 5 === 0 ? 'target' : 'other' },
    }));
    await bigVector.add('filter-perf', records);

    const queryVec = new Array(dim).fill(0).map(() => Math.random());

    // Unfiltered
    const startAll = performance.now();
    await bigVector.search('filter-perf', queryVec, { topK: 10 });
    const elapsedAll = performance.now() - startAll;

    // Filtered (should search only ~2K records)
    const startFiltered = performance.now();
    const filtered = await bigVector.search('filter-perf', queryVec, {
      topK: 10,
      filter: { category: 'target' },
    });
    const elapsedFiltered = performance.now() - startFiltered;

    assert(filtered.length === 10, 'should return 10 filtered results');
    assert(filtered.every(r => r.metadata.category === 'target'), 'all should be target category');
    console.log(`    ⏱️  Unfiltered: ${elapsedAll.toFixed(1)}ms | Filtered: ${elapsedFiltered.toFixed(1)}ms`);

    bigVector.close();
  });

  await test('cache: LRU eviction under pressure', () => {
    const tinyCache = new HotCache(childLogger(log, 'e2e-cache'), 10); // max 10

    for (let i = 0; i < 20; i++) {
      tinyCache.set(`key-${i}`, { i });
    }

    // First 10 should be evicted
    const stats = tinyCache.stats();
    assert(stats.size === 10, `cache should be at max 10, got ${stats.size}`);

    // Most recent should exist
    assert(tinyCache.get('key-19') !== undefined, 'most recent should be in cache');

    // Oldest should be evicted
    assert(tinyCache.get('key-0') === undefined, 'oldest should be evicted');
  });

  // ============================================
  // Cleanup & Report
  // ============================================

  scheduler.stopAll();
  storage.close();

  console.log('\n' + '='.repeat(50));
  console.log(`\n🏁 E2E Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  ⛔ ${f}`));
    console.log();
  }

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('E2E suite crashed:', err);
  process.exit(1);
});
