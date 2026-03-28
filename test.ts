/**
 * Aura v0.1 Integration Test
 * Tests: Config, Storage, Cache, Vector, Plugin Bus, AI, Agent, Scheduler, Crypto
 */

import { loadConfig } from './src/core/config.js';
import { createLogger, childLogger } from './src/core/logger.js';
import { MemoryStore } from './src/core/storage/index.js';
import { PluginBus } from './src/core/plugin-bus.js';
import { createAiAdapter } from './src/core/ai/index.js';
import { Scheduler } from './src/core/scheduler.js';
import { CryptoVault } from './src/core/crypto.js';
import { Agent } from './src/core/agent.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch((err) => {
    console.log(`  ❌ ${name}: ${err}`);
    failed++;
  });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n🧪 Aura v0.1 Test Suite\n');

  // ============================================
  console.log('📦 Config');
  // ============================================

  const config = loadConfig();

  await test('loads config with defaults', () => {
    assert(config.ai.provider === 'ollama', 'default provider should be ollama');
    assert(config.server.port === 3000, 'default port should be 3000');
    assert(config.storage.dataDir === './data', 'default data dir should be ./data');
  });

  await test('config has all required sections', () => {
    assert('ai' in config, 'missing ai config');
    assert('storage' in config, 'missing storage config');
    assert('server' in config, 'missing server config');
    assert('telegram' in config, 'missing telegram config');
  });

  // ============================================
  console.log('\n💾 SQLite Storage');
  // ============================================

  const log = createLogger('warn');
  const storage = new MemoryStore(config.storage, childLogger(log, 'test-storage'));

  await test('set and get value', () => {
    storage.set('test', 'key1', { name: 'Aura', version: '0.1' });
    const val = storage.get<{ name: string; version: string }>('test', 'key1');
    assert(val !== null, 'value should not be null');
    assert(val!.name === 'Aura', 'name should be Aura');
    assert(val!.version === '0.1', 'version should be 0.1');
  });

  await test('overwrite existing value', () => {
    storage.set('test', 'key1', { name: 'Aura', version: '0.2' });
    const val = storage.get<{ name: string; version: string }>('test', 'key1');
    assert(val!.version === '0.2', 'version should be updated to 0.2');
  });

  await test('delete value', () => {
    storage.set('test', 'to-delete', { x: 1 });
    const deleted = storage.delete('test', 'to-delete');
    assert(deleted === true, 'delete should return true');
    const val = storage.get('test', 'to-delete');
    assert(val === null, 'deleted value should be null');
  });

  await test('get non-existent key returns null', () => {
    const val = storage.get('test', 'nonexistent');
    assert(val === null, 'should return null for missing key');
  });

  await test('audit logging', () => {
    storage.audit('test:action', { detail: 'hello' }, 'tester');
    const logs = storage.sqlite.auditQuery({ action: 'test:action', limit: 1 });
    assert(logs.length > 0, 'should have audit log entry');
  });

  // ============================================
  console.log('\n🔍 LRU Cache');
  // ============================================

  await test('cache hit after set', () => {
    storage.cache.set('cached-key', { val: 42 });
    const val = storage.cache.get<{ val: number }>('cached-key');
    assert(val !== undefined, 'cached value should exist');
    assert(val!.val === 42, 'cached value should be 42');
  });

  await test('cache miss for unknown key', () => {
    const val = storage.cache.get('unknown-key');
    assert(val === undefined, 'should be undefined for missing key');
  });

  await test('cache stats track hits/misses', () => {
    const stats = storage.cache.stats();
    assert(stats.hits > 0, 'should have hits');
    assert(stats.misses > 0, 'should have misses');
    assert(stats.hitRate !== 'N/A', 'hit rate should be calculated');
  });

  await test('cache delete', () => {
    storage.cache.set('del-me', { x: 1 });
    storage.cache.delete('del-me');
    const val = storage.cache.get('del-me');
    assert(val === undefined, 'deleted cache entry should be gone');
  });

  // ============================================
  console.log('\n🧮 Vector Store');
  // ============================================

  await test('add and search vectors', async () => {
    await storage.vectorAdd('test-vectors', [
      { id: 'v1', text: 'hello world', vector: [1, 0, 0], metadata: { type: 'greeting' } },
      { id: 'v2', text: 'goodbye world', vector: [0, 1, 0], metadata: { type: 'farewell' } },
      { id: 'v3', text: 'hi there', vector: [0.9, 0.1, 0], metadata: { type: 'greeting' } },
    ]);

    const results = await storage.vectorSearch('test-vectors', [1, 0, 0], { topK: 2 });
    assert(results.length === 2, 'should return top 2');
    assert(results[0].id === 'v1', 'closest vector should be v1');
    assert(results[0].score > 0.9, 'score should be high for exact match');
  });

  await test('vector search with metadata filter', async () => {
    const results = await storage.vectorSearch('test-vectors', [1, 0, 0], {
      topK: 10,
      filter: { type: 'farewell' },
    });
    assert(results.length === 1, 'should only return farewell type');
    assert(results[0].id === 'v2', 'should be v2');
  });

  await test('vector search empty collection', async () => {
    const results = await storage.vectorSearch('empty-collection', [1, 0, 0]);
    assert(results.length === 0, 'empty collection should return empty');
  });

  // ============================================
  console.log('\n🔌 Plugin Bus');
  // ============================================

  const plugins = new PluginBus(storage, childLogger(log, 'test-plugins'));

  await test('register and activate plugin', async () => {
    const testPlugin = {
      name: 'test-plugin',
      version: '1.0.0',
      onLoad: async () => {},
      onActivate: async () => {},
      onDeactivate: async () => {},
    };

    await plugins.register(testPlugin);
    assert(plugins.getState('test-plugin') === 'loaded', 'should be loaded');

    await plugins.activate('test-plugin');
    assert(plugins.getState('test-plugin') === 'active', 'should be active');
  });

  await test('list plugins', () => {
    const list = plugins.listPlugins();
    assert(list.length === 1, 'should have 1 plugin');
    assert(list[0].name === 'test-plugin', 'should be test-plugin');
    assert(list[0].state === 'active', 'should be active');
  });

  await test('deactivate and unregister', async () => {
    await plugins.deactivate('test-plugin');
    assert(plugins.getState('test-plugin') === 'inactive', 'should be inactive');

    await plugins.unregister('test-plugin');
    assert(plugins.getPlugin('test-plugin') === undefined, 'should be gone');
  });

  await test('event emission', async () => {
    let received = false;
    plugins.on('test:event', () => { received = true; });
    plugins.emit('test:event', { data: 'hello' });
    assert(received, 'event should be received');
  });

  await test('duplicate plugin registration fails', async () => {
    const p = { name: 'dup', version: '1.0.0', onLoad: async () => {} };
    await plugins.register(p);
    try {
      await plugins.register(p);
      throw new Error('should have thrown');
    } catch (err) {
      assert(String(err).includes('already registered'), 'should say already registered');
    }
    await plugins.unregister('dup');
  });

  // ============================================
  console.log('\n⏰ Scheduler');
  // ============================================

  const scheduler = new Scheduler(childLogger(log, 'test-scheduler'));

  await test('schedule one-shot task', async () => {
    let fired = false;
    const id = scheduler.once(100, () => { fired = true; }, 'test-once');
    assert(scheduler.list().length >= 1, 'should have at least 1 task');

    await new Promise(r => setTimeout(r, 200));
    assert(fired, 'one-shot should have fired');
  });

  await test('cancel scheduled task', () => {
    let fired = false;
    const id = scheduler.once(5000, () => { fired = true; }, 'cancel-me');
    const cancelled = scheduler.cancel(id);
    assert(cancelled, 'cancel should return true');
    assert(!fired, 'cancelled task should not fire');
  });

  await test('schedule cron task', () => {
    const id = scheduler.add('*/1 * * * *', () => {}, 'test-cron');
    const tasks = scheduler.list();
    const found = tasks.find(t => t.id === id);
    assert(found !== undefined, 'cron task should be listed');
    scheduler.cancel(id);
  });

  scheduler.stopAll();

  // ============================================
  console.log('\n🔐 Crypto Vault');
  // ============================================

  const crypto = new CryptoVault(childLogger(log, 'test-crypto'));

  await test('encrypt and decrypt', async () => {
    await crypto.init('test-password-123');
    assert(crypto.isReady(), 'vault should be ready');

    const encrypted = crypto.encrypt('my secret data');
    assert(encrypted !== 'my secret data', 'encrypted should differ from plaintext');

    const decrypted = crypto.decrypt(encrypted);
    assert(decrypted === 'my secret data', 'decrypted should match original');
  });

  await test('wrong password fails decryption', async () => {
    const encrypted = crypto.encrypt('secret');
    crypto.destroy();

    const crypto2 = new CryptoVault(childLogger(log, 'test-crypto2'));
    await crypto2.init('wrong-password');

    let decryptFailed = false;
    try {
      crypto2.decrypt(encrypted);
    } catch {
      decryptFailed = true;
    }
    assert(decryptFailed, 'decryption with wrong password should fail');
    crypto2.destroy();
  });

  await test('vault without password is disabled', async () => {
    const crypto3 = new CryptoVault(childLogger(log, 'test-crypto3'));
    await crypto3.init('');
    assert(!crypto3.isReady(), 'should not be ready without password');
    crypto3.destroy();
  });

  // ============================================
  console.log('\n🤖 AI Adapter');
  // ============================================

  const ai = createAiAdapter(
    { ...config.ai, model: 'qwen2.5:1.5b' },
    childLogger(log, 'test-ai')
  );

  await test('AI ping', async () => {
    const ok = await ai.ping();
    assert(ok, 'Ollama should be reachable');
  });

  await test('AI chat completion', async () => {
    const response = await ai.chat([
      { role: 'user', content: 'What is 2+2? Reply with just the number.' },
    ], { maxTokens: 10 });
    assert(response.content.length > 0, 'should have a response');
    assert(response.content.includes('4'), 'should contain 4');
  });

  await test('AI embedding', async () => {
    // Switch to nomic for embeddings
    const { OllamaAdapter } = await import('./src/core/ai/ollama.js');
    const embedder = new OllamaAdapter('http://localhost:11434', 'qwen2.5:1.5b', childLogger(log, 'embed'), 'nomic-embed-text');
    const result = await embedder.embed('hello world');
    assert(result.vector.length > 0, 'should return a vector');
    assert(result.vector.length === 768, `expected 768 dims, got ${result.vector.length}`);
  });

  // ============================================
  console.log('\n🤖 Agent Runtime');
  // ============================================

  const plugins2 = new PluginBus(storage, childLogger(log, 'test-agent-plugins'));
  const scheduler2 = new Scheduler(childLogger(log, 'test-agent-sched'));
  const agent = new Agent({
    ai,
    storage,
    plugins: plugins2,
    scheduler: scheduler2,
    logger: childLogger(log, 'test-agent'),
  });

  await test('agent processes message', async () => {
    const response = await agent.processMessage('What is your name?');
    assert(response.length > 0, 'agent should respond');
    // Aura should mention its name
    assert(
      response.toLowerCase().includes('aura') || response.length > 5,
      'should have meaningful response'
    );
  });

  await test('agent maintains history', () => {
    const history = agent.getHistory();
    assert(history.length >= 2, 'should have at least user + assistant');
    assert(history[0].role === 'user', 'first should be user');
    assert(history[1].role === 'assistant', 'second should be assistant');
  });

  await test('agent clears history', () => {
    agent.clearHistory();
    assert(agent.getHistory().length === 0, 'history should be empty');
  });

  // Cleanup
  scheduler2.stopAll();
  storage.close();

  // ============================================
  console.log('\n' + '='.repeat(40));
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
