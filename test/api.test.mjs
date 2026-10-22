import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeStats, readCatalog } from '../lib/api.js';

test('createRuntimeStats counts, caps, and resets', () => {
  const stats = createRuntimeStats(4);
  stats.record({ kind: 'continue', text: '继续' });
  stats.record({ kind: 'continue', text: '再来' });
  stats.record({ kind: 'switch', to: { provider: 'p', model: 'm' } });
  stats.record({ kind: 'skip', reason: 'budget' });
  stats.record({ kind: 'switch-failed', reason: 'unusable' });
  stats.record({ kind: 'continue', text: '第三条' }); // 超出容量，挤掉最老
  const snap = stats.snapshot();
  assert.equal(snap.counters.continues, 3);
  assert.equal(snap.counters.switches, 1);
  assert.equal(snap.counters.skips, 1);
  assert.equal(snap.counters.switchFailed, 1);
  assert.equal(snap.recent.length, 4); // 环形上限
  assert.equal(snap.recent[0].text, '第三条'); // 新→旧
  stats.reset();
  assert.equal(stats.snapshot().recent.length, 0);
});

test('readCatalog merges loader entry configs and registered providers', () => {
  const ctx = {
    loader: {
      entries: () => [
        { options: { id: 'llm-pi-ai', config: { providers: {
          nvidia: { models: [{ id: 'z-ai/glm-5.3' }, { id: 'moonshotai/kimi-k3' }] },
          bailu: { models: [{ id: 'bailu-2.8' }] }
        } } } }
      ]
    },
    llm: { listProviders: () => [{ id: 'nvidia' }, { id: 'deepseek-account' }] }
  };
  const catalog = readCatalog(ctx);
  const byName = Object.fromEntries(catalog.map((row) => [row.provider, row.models]));
  assert.deepEqual(byName.nvidia, ['moonshotai/kimi-k3', 'z-ai/glm-5.3']);
  assert.deepEqual(byName.bailu, ['bailu-2.8']);
  assert.deepEqual(byName['deepseek-account'], []);
});

test('readCatalog tolerates a broken registry', () => {
  assert.deepEqual(readCatalog({ loader: { entries: () => { throw new Error('boom'); } }, llm: { listProviders: () => { throw new Error('boom'); } } }), []);
});
