import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../lib/engine.js';

function baseConfig(overrides) {
  return {
    enabled: true,
    provider: 'nvidia',
    continueText: '继续',
    maxConsecutiveFailures: 2,
    maxContinuesPerBurst: 5,
    burstWindowMs: 600000,
    continueCodes: ['TIMEOUT', 'TRANSPORT', 'STREAM_CLOSED', 'SERVER', 'RATE_LIMIT', 'QUOTA', 'EMPTY_RESPONSE', 'UNKNOWN'],
    skipCodes: ['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'CONTEXT_WINDOW_EXCEEDED', 'UNSUPPORTED_REASONING_EFFORT', 'NO_ADAPTER', 'INVALID_ARGS', 'ABORTED'],
    continueOnMaxTokens: false,
    fallbacks: [],
    maxReasoningEffort: true,
    reasoningEfforts: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal'],
    notifyUser: false,
    sourceKind: 'model-selection',
    ...(overrides || {}),
  };
}

function harness(overrides) {
  const clock = { now: 1000000 };
  const calls = { followups: [], switches: [], notices: [] };
  const config = baseConfig(overrides);
  const engine = createEngine({
    config,
    now: () => clock.now,
    createUserMessage: (input) => ({ role: 'user', content: input.content, source: input.source }),
    buildSwitch: async (base, route) => {
      calls.switches.push({ base, route });
      const next = { ...base, provider: route.provider, model: route.model };
      if (route.reasoningEffort !== undefined) next.reasoningEffort = route.reasoningEffort;
      return next;
    },
    notifyUser: (agent, text) => calls.notices.push(text),
    log: { info() {}, warn() {}, error() {} },
  });
  const agent = {
    id: 'agent-1',
    status: 'idle',
    inbox: { hasPending: false },
    followup(message) { calls.followups.push(message); },
  };
  return { engine, agent, clock, calls, config };
}

const NV = { provider: 'nvidia', model: 'z-ai/glm-5.3' };

test('records the route and leaves healthy turns alone', async () => {
  const { engine, agent, calls } = harness();
  const same = await engine.onRequest(agent, NV);
  assert.deepEqual(same, NV);
  engine.onTurnEnd(agent, { kind: 'stop' });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0);
});

test('a retry-exhausted nvidia failure sends the continue message once idle', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT', message: 'stream idle timeout' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
  assert.deepEqual(calls.followups[0].content, [{ type: 'text', text: '继续' }]);
});

test('any error turn on the watched provider continues unless terminal', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'PI_AI_ERROR', message: 'pi-ai stream error' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
});

test('provider failure evidence covers an UNKNOWN terminal code', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onRequestError(agent, 'nvidia', { code: 'UNKNOWN', message: 'fetch failed' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'UNKNOWN', message: 'fetch failed' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
});

test('terminal codes never continue', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onRequestError(agent, 'nvidia', { code: 'AUTH', message: 'invalid key' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'AUTH', message: 'invalid key' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0);
});

test('another queued message suppresses the automatic continue', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  agent.inbox.hasPending = true;
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0);
});

test('a user stop is never continued', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'aborted', reason: { kind: 'user' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0);
});

test('other providers are ignored', async () => {
  const { engine, agent, calls } = harness();
  await engine.onRequest(agent, { provider: 'deepseek-account', model: 'deepseek-flash' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0);
});

test('two consecutive failures switch the next request to the fallback', async () => {
  const { engine, agent, calls } = harness({
    fallbacks: [
      { provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' },
      { provider: 'deepseek-account', model: 'deepseek-flash' },
    ],
  });
  const base = { provider: 'nvidia', model: 'z-ai/glm-5.3', reasoningEffort: 'high' };

  await engine.onRequest(agent, base);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
  assert.equal(calls.switches.length, 0);

  await engine.onRequest(agent, base);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 2);
  assert.equal(calls.switches.length, 0);

  const switched = await engine.onRequest(agent, base);
  assert.equal(switched.provider, 'nvidia');
  assert.equal(switched.model, 'deepseek-ai/deepseek-v4.1-flash');
  assert.equal(calls.switches.length, 1);
});

test('fallbacks rotate in order after each threshold', async () => {
  const { engine, agent } = harness({
    fallbacks: [
      { provider: 'nvidia', model: 'a' },
      { provider: 'nvidia', model: 'b' },
    ],
  });
  const base = { provider: 'nvidia', model: 'z-ai/glm-5.3' };
  async function failTwiceThenNextRequest() {
    await engine.onRequest(agent, base);
    engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
    engine.onIdle(agent);
    await engine.onRequest(agent, base);
    engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
    engine.onIdle(agent);
    return engine.onRequest(agent, base);
  }
  const first = await failTwiceThenNextRequest();
  assert.equal(first.model, 'a');
  const second = await failTwiceThenNextRequest();
  assert.equal(second.model, 'b');
});

test('the per-burst continuation budget stops a runaway loop', async () => {
  const { engine, agent, calls } = harness({ maxContinuesPerBurst: 2, fallbacks: [] });
  await engine.onRequest(agent, NV);
  for (let i = 0; i < 3; i += 1) {
    engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
    engine.onIdle(agent);
  }
  assert.equal(calls.followups.length, 2);
});

test('max-tokens continues only when enabled', async () => {
  const off = harness();
  await off.engine.onRequest(off.agent, NV);
  off.engine.onTurnEnd(off.agent, { kind: 'max-tokens' });
  off.engine.onIdle(off.agent);
  assert.equal(off.calls.followups.length, 0);

  const on = harness({ continueOnMaxTokens: true });
  await on.engine.onRequest(on.agent, NV);
  on.engine.onTurnEnd(on.agent, { kind: 'max-tokens' });
  on.engine.onIdle(on.agent);
  assert.equal(on.calls.followups.length, 1);
});

test('moving to another provider clears the pending burst', async () => {
  const { engine, agent, calls } = harness({ fallbacks: [{ provider: 'nvidia', model: 'fb' }] });
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  await engine.onRequest(agent, { provider: 'deepseek-account', model: 'deepseek-flash' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
});

test('an unusable fallback leaves the request on the original route', async () => {
  const calls = { followups: [] };
  const engine = createEngine({
    config: baseConfig({ fallbacks: [{ provider: 'nvidia', model: 'fb' }] }),
    now: () => 1,
    createUserMessage: (input) => input,
    buildSwitch: async () => undefined,
    log: { info() {}, warn() {}, error() {} },
  });
  const agent = {
    id: 'a', status: 'idle', inbox: { hasPending: false },
    followup(message) { calls.followups.push(message); },
  };
  const base = { provider: 'nvidia', model: 'z-ai/glm-5.3' };
  await engine.onRequest(agent, base);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  await engine.onRequest(agent, base);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  const out = await engine.onRequest(agent, base);
  assert.deepEqual(out, base);
});
test('continueMessages drives a per-attempt script and repeats the last entry', async () => {
  const { engine, agent, calls } = harness({ continueMessages: ['第一次续跑', '第二次续跑'], maxContinuesPerBurst: 0, fallbacks: [] });
  await engine.onRequest(agent, NV);
  for (let i = 0; i < 3; i += 1) {
    engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
    engine.onIdle(agent);
  }
  assert.deepEqual(calls.followups.map((m) => m.content[0].text), ['第一次续跑', '第二次续跑', '第二次续跑']);
});

test('multiple watched providers continue on any of them', async () => {
  const { engine, agent, calls } = harness({ providers: ['nvidia', 'bailu'] });
  await engine.onRequest(agent, { provider: 'bailu', model: 'bailu-2.8' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TRANSPORT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
  await engine.onRequest(agent, { provider: 'deepseek-account', model: 'deepseek-flash' });
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TRANSPORT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 1);
});

test('continueDelayMs postpones the continuation and rechecks state at fire time', async () => {
  const { engine, agent, calls } = harness({ continueDelayMs: 60 });
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  assert.equal(calls.followups.length, 0, '延迟期内不应发送');
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(calls.followups.length, 1, '到期后应发送一次');
});

test('a delayed continuation is dropped when the inbox fills meanwhile', async () => {
  const { engine, agent, calls } = harness({ continueDelayMs: 60 });
  await engine.onRequest(agent, NV);
  engine.onTurnEnd(agent, { kind: 'error', error: { code: 'TIMEOUT' } });
  engine.onIdle(agent);
  agent.inbox.hasPending = true; // 用户在延迟期内发了消息
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(calls.followups.length, 0, '已有排队消息时不应重复续跑');
});
