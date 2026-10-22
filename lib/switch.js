/**
 * dsh-auto-continue: fallback composition.
 *
 * The user picks ONE reasoning effort per fallback row in the panel; the switch
 * sends exactly that level. A single local capability check (llm.prepareCall,
 * no network) strips the level when the target model cannot accept it — no
 * ladder of attempts, matching the panel's "pick it directly" behavior.
 */

/**
 * Ordered candidate call configs for one fallback route.
 *
 * @param {object} base The resolved call config of the current request.
 * @param {{provider: string, model: string, reasoningEffort?: string}} route Target route.
 * @returns {object[]} Detached candidates to probe in order: the explicit
 *   level first (when set), then no explicit effort (adapter default / none).
 */
export function candidateConfigs(base, route) {
  const controls = { ...base };
  delete controls.reasoningEffort;
  const candidates = [];
  if (route.reasoningEffort !== undefined && route.reasoningEffort !== null && String(route.reasoningEffort).length > 0) {
    candidates.push({ ...controls, provider: route.provider, model: route.model, reasoningEffort: String(route.reasoningEffort) });
  }
  candidates.push({ ...controls, provider: route.provider, model: route.model });
  return candidates;
}

/**
 * Validate a fallback route and apply the user-chosen reasoning level.
 *
 * @param {{prepareCall: (config: object, signal?: AbortSignal) => Promise<unknown>}} llm LLM service.
 * @param {object} base The resolved call config of the current request.
 * @param {object} route Target route.
 * @param {object} config Plugin config (kept for signature compatibility; the ladder is retired).
 * @param {AbortSignal} [signal] Request cancellation.
 * @param {{warn: Function}} [log] Logger.
 * @returns {Promise<object|undefined>} Ready-to-use call config, or undefined when unusable now.
 */
export async function buildSwitch(llm, base, route, config, signal, log) {
  for (const candidate of candidateConfigs(base, route)) {
    try {
      await llm.prepareCall(candidate, signal);
      return candidate;
    } catch (error) {
      const code = error !== null && error !== undefined ? error.code : undefined;
      if (candidate.reasoningEffort !== undefined && code === 'UNSUPPORTED_REASONING_EFFORT') {
        if (log !== undefined) log.warn('fallback %s/%s rejects reasoning effort %s; sending without it', route.provider, route.model, candidate.reasoningEffort);
        continue;
      }
      if (log !== undefined) {
        log.warn('fallback %s/%s rejected (%s)', route.provider, route.model, code || String(error !== null && error !== undefined ? error.message || error : error));
      }
      return undefined;
    }
  }
  return undefined;
}
