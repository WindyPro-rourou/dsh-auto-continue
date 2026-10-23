/**
 * dsh-auto-continue: keep an unstable provider (default nvidia) usable.
 *
 * 监视 provider：回合因重试耗尽的提供商失败而异常结束时，自动以用户消息续跑；
 * 连续失败达到阈值后把下一个请求切到配置的备用模型列表，并把思考强度拉到目标模型
 * 支持的最高档。每次续跑可以发不同的文案（continueMessages 按次数取用）。
 *
 * 配置面（供 Web 配置台）：GET/POST /api/auto-continue/config；
 * 保存时先原地生效（Object.assign 到共享配置对象），再用官方 configEditor
 * 写回 profile patch 并触发 Loader 热重载；服务缺失时仅内存生效并回报原因。
 *
 * @module dsh-auto-continue
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createEngine } from './engine.js';
import { buildSwitch } from './switch.js';
import { createRuntimeStats, registerConfigApi, createPersister } from './api.js';
import { createEventLog } from './eventlog.js';

export const name = 'dsh-auto-continue';
export const inject = ['llm', 'agents'];

export const Config = z.object({
  enabled: z.boolean().default(true),
  provider: z.string().default('nvidia'),
  providers: z.array(z.string()).default([]),
  continueText: z.string().default('继续'),
  continueMessages: z.array(z.string()).default([]),
  maxConsecutiveFailures: z.number().default(2).min(1),
  maxContinuesPerBurst: z.number().default(5).min(0),
  continueDelayMs: z.number().default(0).min(0),
  burstWindowMs: z.number().default(600000).min(1),
  continueCodes: z.array(z.string()).default([
    'TIMEOUT',
    'TRANSPORT',
    'STREAM_CLOSED',
    'SERVER',
    'RATE_LIMIT',
    'QUOTA',
    'EMPTY_RESPONSE',
    'UNKNOWN',
  ]),
  skipCodes: z.array(z.string()).default([
    'AUTH',
    'INVALID_CREDENTIAL',
    'MISSING_CREDENTIAL',
    'CONTEXT_WINDOW_EXCEEDED',
    'UNSUPPORTED_REASONING_EFFORT',
    'NO_ADAPTER',
    'INVALID_ARGS',
    'ABORTED',
  ]),
  continueOnMaxTokens: z.boolean().default(false),
  fallbacks: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  })).default([]),
  maxReasoningEffort: z.boolean().default(false),
  reasoningEfforts: z.array(z.string()).default(['max', 'xhigh', 'high', 'medium', 'low', 'minimal']),
  notifyUser: z.boolean().default(false),
  sourceKind: z.string().default('model-selection'),
});

const SKILL_NAME = 'configure-auto-continue';
const SKILL_DESCRIPTION = '引导用户配置 dsh-auto-continue 插件（监视哪些提供商、失败后发什么、连续几次切换哪个模型、思考强度选什么）。当用户提到自动续跑、继续重试、模型回退、nvidia 不稳定等话题时使用。流程：AI 先探测当前配置，写入建议配置，再请用户确认。';

/**
 * Register the bundled guidance skill lazily: the skill package is imported at
 * apply time (never at module import time), and every failure is non-fatal.
 * @param ctx - plugin context carrying the optional skills service.
 * @param log - plugin logger.
 */
function registerBundledSkill(ctx, log) {
  void (async () => {
    try {
      const skills = ctx.get('skills');
      if (skills === undefined || skills === null || typeof skills.registerProvider !== 'function') return;
      const [skillModule, fsModule, urlModule] = await Promise.all([
        import('@deepseek-ai/dsh-skill'),
        import('node:fs/promises'),
        import('node:url'),
      ]);
      const bodyUrl = new URL('../skills/configure-auto-continue/SKILL.md', import.meta.url);
      const dirPath = urlModule.fileURLToPath(new URL('../skills/configure-auto-continue/', import.meta.url));
      const stripFrontmatter = (markdown) => {
        if (typeof markdown !== 'string' || !markdown.startsWith('---')) return markdown;
        const end = markdown.indexOf('\n---', 4);
        return end === -1 ? markdown : markdown.slice(end + 4).replace(/^\n+/, '');
      };
      const candidate = {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'dsh-auto-continue',
        source: 'bundled',
        resourceBase: { kind: 'directory', path: dirPath },
        rank: skillModule.BUNDLED_SKILL_RANK,
        locator: bodyUrl,
      };
      skills.registerProvider(() => ({
        name: 'dsh-auto-continue',
        list: () => Promise.resolve([candidate]),
        get: async () => Object.assign({}, candidate, { content: stripFrontmatter(await fsModule.readFile(bodyUrl, 'utf8')) }),
      }));
      log.info('bundled skill registered');
    } catch (error) {
      log.warn('bundled skill unavailable: %s', error !== null && error !== undefined && error.message ? String(error.message) : String(error));
    }
  })();
}

function messageOf(error) {
  return error !== null && error !== undefined ? String(error.message || error) : String(error);
}

/**
 * Register the watcher, the runtime statistics, and the configuration surface.
 * @param ctx - plugin context exposing the llm and agents services.
 * @param rawConfig - untrusted plugin configuration, validated by the schema.
 */
export function apply(ctx, rawConfig) {
  // Shared mutable object: the config API assigns into it, so listeners observe
  // edits immediately, before (and independently of) the Loader hot reload.
  const config = Object.assign({}, rawConfig);
  const logger = ctx.logger;
  const log = {
    info: (format, ...args) => logger.info('[dsh-auto-continue] ' + format, ...args),
    warn: (format, ...args) => logger.warn('[dsh-auto-continue] ' + format, ...args),
    error: (format, ...args) => logger.error('[dsh-auto-continue] ' + format, ...args),
  };
  const stats = createRuntimeStats(64);
  const persist = createPersister(ctx, log);
  const eventLog = createEventLog(log);

  const engine = createEngine({
    config,
    log,
    now: () => Date.now(),
    createUserMessage,
    onEvent: (event) => {
      stats.record(event);
      eventLog.append(event);
    },
    buildSwitch: (base, route, signal) => buildSwitch(ctx.llm, base, route, config, signal, log),
    notifyUser: config.notifyUser
      ? (agent, text) => {
          try {
            agent.session.append('user/message', createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: config.sourceKind },
            }), { surfaceOp: 'append' });
          } catch (error) {
            log.warn('switch notice failed: %s', messageOf(error));
          }
        }
      : undefined,
  });

  ctx.on('agent/request-error', (payload, next) => {
    if (config.enabled && payload !== undefined && payload.agent !== undefined) {
      try {
        engine.onRequestError(payload.agent, payload.provider, payload.failure);
      } catch (error) {
        log.error('request-error hook failed: %s', messageOf(error));
      }
    }
    return next();
  });

  ctx.on('agent/request', async (payload, next) => {
    const base = await next();
    if (!config.enabled || payload === undefined || payload.agent === undefined) return base;
    try {
      return await engine.onRequest(payload.agent, base, payload.signal);
    } catch (error) {
      log.error('request hook failed: %s', messageOf(error));
      return base;
    }
  });

  ctx.on('session/event', (session, event) => {
    if (!config.enabled || event === undefined || event.type !== 'turn/end') return;
    try {
      const agent = ctx.agents.get(session.id);
      if (agent === undefined || agent.session !== session) return;
      engine.onTurnEnd(agent, event.data !== undefined ? event.data.reason : undefined);
    } catch (error) {
      log.error('turn/end hook failed: %s', messageOf(error));
    }
  });

  ctx.on('agent/status', (payload) => {
    if (!config.enabled || payload === undefined || payload.status !== 'idle' || payload.agent === undefined) return;
    try {
      engine.onIdle(payload.agent);
    } catch (error) {
      log.error('idle hook failed: %s', messageOf(error));
    }
  });

  ctx.on('agent/created', (payload) => {
    if (payload !== undefined && payload.agent !== undefined) engine.onAgentCreated(payload.agent);
  });

  ctx.on('agent/disposed', (payload) => {
    if (payload !== undefined && payload.agent !== undefined) engine.onAgentDisposed(payload.agent);
  });

  registerBundledSkill(ctx, log);

  registerConfigApi(ctx, {
    config,
    Config,
    defaults: Config({}),
    persist,
    stats,
    log,
  });

  ctx.effect(() => () => engine.dispose(), 'dsh-auto-continue: dispose');
}
