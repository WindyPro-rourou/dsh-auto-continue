/**
 * dsh-auto-continue: pure behavior core.
 *
 * The engine owns no cordis or DSH imports. ./index.js injects the user-message
 * factory, the fallback validator, the clock, the logger and an optional event
 * sink, so every decision below is unit-testable without a running harness.
 */

function inside(list, value) {
  return Array.isArray(list) && list.indexOf(value) !== -1;
}

/** The watched provider list: the `providers` array, falling back to the legacy single `provider`. */
function watchedProviders(config) {
  const list = Array.isArray(config.providers)
    ? config.providers.filter((item) => typeof item === 'string' && item.length > 0)
    : [];
  return list.length > 0 ? list : [config.provider];
}

/** Whether one route provider is watched. */
function isWatched(config, provider) {
  return watchedProviders(config).indexOf(provider) !== -1;
}

function errorText(error) {
  if (error === null || error === undefined) return String(error);
  if (typeof error === 'string') return error;
  return String(error.message || error);
}

/**
 * Text for one continuation attempt. A non-empty continueMessages list is a
 * per-attempt script: attempt 1 uses entry 1, attempt 2 entry 2, and further
 * attempts keep the last entry. An empty list falls back to continueText.
 */
function continueTextFor(config, attemptIndex) {
  const list = Array.isArray(config.continueMessages)
    ? config.continueMessages.filter((item) => typeof item === 'string' && item.length > 0)
    : [];
  if (list.length === 0) return config.continueText;
  return list[Math.min(attemptIndex, list.length - 1)];
}

function initialState() {
  return {
    lastRoute: undefined,
    failures: 0,
    continues: 0,
    burstStartedAt: 0,
    pendingFailure: undefined,
    pendingMessage: undefined,
    pendingRoute: undefined,
    fallbackIndex: 0,
    providerFailureThisTurn: false,
    lastProviderFailureCode: undefined,
  };
}

/**
 * Create one engine instance.
 *
 * @param {object} options
 * @param {object} options.config Validated plugin configuration (mutated in place by the host for live edits).
 * @param {(input: object) => object} options.createUserMessage User-message factory from dsh-llm.
 * @param {(base: object, route: object, signal?: AbortSignal) => Promise<object|undefined>} options.buildSwitch
 *   Validates one fallback route for the next request; undefined means "not usable now".
 * @param {(event: object) => void} [options.onEvent] Runtime event sink (turn-error / continue / switch / skip).
 * @param {(agent: object, text: string) => void} [options.notifyUser] Optional user-visible notice writer.
 * @param {{info: Function, warn: Function, error: Function}} [options.log] printf-style logger.
 * @param {() => number} [options.now] Epoch-milliseconds clock.
 */
export function createEngine(options) {
  const config = options.config;
  const createUserMessage = options.createUserMessage;
  const buildSwitch = options.buildSwitch;
  const notifyUser = options.notifyUser;
  const emit = options.onEvent || function () {};
  const log = options.log || { info() {}, warn() {}, error() {} };
  const now = options.now || (() => Date.now());
  const states = new WeakMap();

  function stateFor(agent) {
    let state = states.get(agent);
    if (state === undefined) {
      state = initialState();
      states.set(agent, state);
    }
    return state;
  }

  function safeEmit(event) {
    try { emit(event); } catch (error) { log.warn('event sink failed: %s', errorText(error)); }
  }

  function resetBurst(state) {
    state.failures = 0;
    state.continues = 0;
    state.burstStartedAt = 0;
    state.pendingFailure = undefined;
    state.pendingMessage = undefined;
    state.providerFailureThisTurn = false;
    state.lastProviderFailureCode = undefined;
  }

  function resetAll(state) {
    resetBurst(state);
    state.pendingRoute = undefined;
  }

  function onAgentCreated(agent) {
    states.set(agent, initialState());
  }

  function onAgentDisposed(agent) {
    states.delete(agent);
  }

  /** Watched-provider request failure evidence for the current turn. */
  function onRequestError(agent, provider, failure) {
    if (agent === undefined || !isWatched(config, provider)) return;
    const state = stateFor(agent);
    state.providerFailureThisTurn = true;
    state.lastProviderFailureCode =
      failure !== undefined && failure !== null && failure.code !== undefined && String(failure.code).length > 0
        ? String(failure.code)
        : 'UNKNOWN';
  }

  /** Record the resolved route and apply an armed switch to this request. */
  async function onRequest(agent, base, signal) {
    if (agent === undefined || base === undefined) return base;
    const state = stateFor(agent);
    const previous = state.lastRoute;
    state.lastRoute = { provider: base.provider, model: base.model };
    if (previous !== undefined && previous.provider !== base.provider && !isWatched(config, base.provider)) {
      resetAll(state);
    }
    const route = state.pendingRoute;
    if (route === undefined) return base;
    state.pendingRoute = undefined;
    let switched;
    try {
      switched = await buildSwitch(base, route, signal);
    } catch (error) {
      log.warn('switch to %s/%s failed before the request: %s', route.provider, route.model, errorText(error));
      safeEmit({ kind: 'switch-failed', agentId: agent.id, provider: route.provider, model: route.model, reason: errorText(error) });
      return base;
    }
    if (switched === undefined) {
      log.warn('fallback %s/%s is not usable now; staying on %s/%s', route.provider, route.model, base.provider, base.model);
      safeEmit({ kind: 'switch-failed', agentId: agent.id, provider: route.provider, model: route.model, reason: 'unusable' });
      return base;
    }
    state.lastRoute = { provider: switched.provider, model: switched.model };
    log.warn('routing this request to %s/%s', switched.provider, switched.model);
    safeEmit({ kind: 'switch', agentId: agent.id, from: { provider: base.provider, model: base.model }, to: { provider: switched.provider, model: switched.model } });
    return switched;
  }

  /** Classify a finished turn. Any error turn on the watched provider continues unless the code is terminal. */
  function onTurnEnd(agent, reason) {
    if (agent === undefined) return;
    const state = stateFor(agent);
    if (state.lastRoute === undefined) return;
    const watched = isWatched(config, state.lastRoute.provider);
    const providerFailure = state.providerFailureThisTurn;
    const providerCode = state.lastProviderFailureCode;
    state.providerFailureThisTurn = false;
    state.lastProviderFailureCode = undefined;
    if (!watched) {
      resetAll(state);
      return;
    }
    const kind = reason !== undefined && reason !== null ? reason.kind : undefined;
    if (kind === 'error') {
      const code = reason.error !== undefined && reason.error !== null && reason.error.code !== undefined
        ? String(reason.error.code)
        : 'UNKNOWN';
      const message = reason.error !== undefined && reason.error !== null && reason.error.message !== undefined
        ? String(reason.error.message)
        : '';
      const terminal = inside(config.skipCodes, code);
      // 判定：监视提供商的回合失败一律续跑；只有终态码（skipCodes）否决。
      const abnormal = !terminal;
      if (abnormal) {
        state.pendingFailure = code;
        state.pendingMessage = message.slice(0, 200);
        log.info('turn failed with %s on %s/%s (%s); a continuation is armed', code, state.lastRoute.provider, state.lastRoute.model, message.slice(0, 80));
      } else {
        state.pendingFailure = undefined;
        safeEmit({ kind: 'skip', agentId: agent.id, reason: 'terminal-code', code });
      }
      safeEmit({
        kind: 'turn-error',
        agentId: agent.id,
        code,
        message: message.slice(0, 160),
        providerFailure,
        providerCode,
        continued: abnormal,
      });
      return;
    }
    if (kind === 'max-tokens') {
      if (config.continueOnMaxTokens) state.pendingFailure = 'MAX_TOKENS';
      safeEmit({ kind: 'turn-error', agentId: agent.id, code: 'MAX_TOKENS', message: '', providerFailure, providerCode, continued: config.continueOnMaxTokens === true });
      return;
    }
    if (kind === 'aborted') {
      resetAll(state);
      safeEmit({ kind: 'turn-aborted', agentId: agent.id, cause: reason !== undefined && reason !== null && reason.reason !== undefined && reason.reason !== null && reason.reason.kind !== undefined ? String(reason.reason.kind) : null });
      return;
    }
    resetBurst(state);
  }

  /** At quiescence, queue the next user message that resumes the work. */
  function onIdle(agent) {
    if (agent === undefined) return;
    const state = stateFor(agent);
    const failure = state.pendingFailure;
    const failureMessage = state.pendingMessage;
    if (failure === undefined) return;
    if (agent.status !== 'idle') return;
    state.pendingFailure = undefined;
    state.pendingMessage = undefined;
    if (state.lastRoute === undefined || !isWatched(config, state.lastRoute.provider)) {
      resetAll(state);
      return;
    }
    const timestamp = now();
    if (state.burstStartedAt === 0 || timestamp - state.burstStartedAt > config.burstWindowMs) {
      state.burstStartedAt = timestamp;
      state.failures = 0;
      state.continues = 0;
    }
    if (config.maxContinuesPerBurst > 0 && state.continues >= config.maxContinuesPerBurst) {
      log.warn('auto-continue budget (%d) exhausted for this burst; leaving the agent alone', config.maxContinuesPerBurst);
      safeEmit({ kind: 'skip', agentId: agent.id, reason: 'budget', code: failure });
      return;
    }
    if (agent.inbox !== undefined && agent.inbox.hasPending) {
      log.info('another message is already queued; skipping the automatic continuation');
      safeEmit({ kind: 'skip', agentId: agent.id, reason: 'pending-input', code: failure });
      return;
    }

    const fire = () => {
    if (agent.status !== 'idle') return;
    if (agent.inbox !== undefined && agent.inbox.hasPending) {
      safeEmit({ kind: 'skip', agentId: agent.id, reason: 'pending-input', code: failure });
      return;
    }
    state.failures += 1;
    let switchedTo;
    if (state.failures >= config.maxConsecutiveFailures && config.fallbacks.length > 0) {
      switchedTo = config.fallbacks[state.fallbackIndex % config.fallbacks.length];
      state.fallbackIndex = (state.fallbackIndex + 1) % config.fallbacks.length;
      state.failures = 0;
      state.pendingRoute = switchedTo;
      log.warn('consecutive failures reached %d; the next request switches to %s/%s', config.maxConsecutiveFailures, switchedTo.provider, switchedTo.model);
    }

    const attempt = state.continues + 1;
    const text = continueTextFor(config, state.continues);
    state.continues += 1;
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: text }],
        source: { kind: config.sourceKind },
      }));
    } catch (error) {
      log.warn('could not queue the continuation: %s', errorText(error));
      state.pendingRoute = undefined;
      safeEmit({ kind: 'continue-failed', agentId: agent.id, reason: errorText(error), text });
      return;
    }
    safeEmit({
      kind: 'continue',
      agentId: agent.id,
      attempt,
      text,
      code: failure,
      message: failureMessage,
      provider: state.lastRoute.provider,
      model: state.lastRoute.model,
      switchTo: switchedTo === undefined ? null : { provider: switchedTo.provider, model: switchedTo.model },
    });
    if (switchedTo !== undefined && notifyUser !== undefined) {
      try {
        notifyUser(agent, '已切换模型：' + state.lastRoute.provider + '/' + state.lastRoute.model + ' → ' + switchedTo.provider + '/' + switchedTo.model);
      } catch (error) {
        log.warn('could not write the switch notice: %s', errorText(error));
      }
    }
    };
    const delay = typeof config.continueDelayMs === 'number' && config.continueDelayMs > 0 ? config.continueDelayMs : 0;
    if (delay > 0) {
      setTimeout(() => {
        try {
          fire();
        } catch (error) {
          log.warn('delayed continuation failed: %s', errorText(error));
        }
      }, delay);
      return;
    }
    fire();
  }

  function dispose() {
    // Per-agent state lives in WeakMap entries; there is nothing global to release.
  }

  return { onAgentCreated, onAgentDisposed, onRequestError, onRequest, onTurnEnd, onIdle, dispose, continueTextFor };
}
