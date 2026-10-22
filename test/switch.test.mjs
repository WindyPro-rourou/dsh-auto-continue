import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateConfigs, buildSwitch } from '../lib/switch.js';

const silentLog = { warn() {} };

function fakeLlm(supported) {
  return {
    calls: [],
    async prepareCall(candidate) {
      this.calls.push(candidate);
      if (candidate.reasoningEffort !== undefined && !supported.has(candidate.reasoningEffort)) {
        const error = new Error('unsupported effort ' + candidate.reasoningEffort);
        error.code = 'UNSUPPORTED_REASONING_EFFORT';
        throw error;
      }
      return candidate;
    },
  };
}

test('candidate order is explicit effort first, then no effort', () => {
  const candidates = candidateConfigs(
    { provider: 'nvidia', model: 'z-ai/glm-5.3', reasoningEffort: 'high', maxTokens: 1024 },
    { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
  );
  assert.deepEqual(candidates.map((candidate) => candidate.reasoningEffort), ['max', undefined]);
  assert.equal(candidates[0].provider, 'deepseek-account');
  assert.equal(candidates[0].maxTokens, 1024);
  assert.equal('reasoningEffort' in candidates[1], false);
});

test('the user-chosen level is sent as-is when supported', async () => {
  const llm = fakeLlm(new Set(['high']));
  const out = await buildSwitch(
    llm,
    { provider: 'nvidia', model: 'z-ai/glm-5.3', reasoningEffort: 'high' },
    { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
    { maxReasoningEffort: false },
    undefined,
    silentLog,
  );
  assert.equal(out.reasoningEffort, 'high');
  assert.deepEqual(llm.calls.map((call) => call.reasoningEffort), ['high']);
});

test('an unsupported chosen level is stripped, never laddered', async () => {
  const llm = fakeLlm(new Set());
  const out = await buildSwitch(
    llm,
    { provider: 'nvidia', model: 'z-ai/glm-5.3', reasoningEffort: 'high' },
    { provider: 'nvidia', model: 'moonshotai/kimi-k3', reasoningEffort: 'xhigh' },
    { maxReasoningEffort: false },
    undefined,
    silentLog,
  );
  assert.equal(out.provider, 'nvidia');
  assert.equal(out.model, 'moonshotai/kimi-k3');
  assert.equal('reasoningEffort' in out, false);
  assert.equal(llm.calls.length, 2);
});

test('no chosen level sends the request without any effort', async () => {
  const llm = fakeLlm(new Set());
  const out = await buildSwitch(
    llm,
    { provider: 'nvidia', model: 'z-ai/glm-5.3', reasoningEffort: 'high' },
    { provider: 'nvidia', model: 'z-ai/glm-5.3-flash' },
    { maxReasoningEffort: false },
    undefined,
    silentLog,
  );
  assert.equal('reasoningEffort' in out, false);
  assert.equal(llm.calls.length, 1);
});

test('an unusable route returns undefined', async () => {
  const llm = {
    async prepareCall() {
      const error = new Error('no adapter');
      error.code = 'NO_ADAPTER';
      throw error;
    },
  };
  const out = await buildSwitch(
    llm,
    { provider: 'nvidia', model: 'z-ai/glm-5.3' },
    { provider: 'nowhere', model: 'nothing', reasoningEffort: 'high' },
    { maxReasoningEffort: false },
    undefined,
    silentLog,
  );
  assert.equal(out, undefined);
});
