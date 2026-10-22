/**
 * dsh-auto-continue: host-facing surface.
 *
 * - 运行时事件环（续跑 / 切换 / 跳过）供配置台展示；
 * - provider/model 目录（来自 Loader 里各 llm 插件行的配置 + 已注册提供商）供模型选择器使用；
 * - 持久化：优先走官方 configEditor（写回 profile patch 并触发 Loader 热重载）；
 *   服务缺失时降级为「仅本次进程内生效」，绝不让插件纤维失败；
 * - HTTP：GET/POST /api/auto-continue/config、POST /api/auto-continue/config/reset、
 *   POST /api/auto-continue/runtime/reset（webServer 就绪后惰性注册）。
 */

import { readFile } from 'node:fs/promises';
import { eventLogPath } from './eventlog.js';

/** 运行时事件环：计数器 + 最近 N 条事件（新→旧）。 */
export function createRuntimeStats(cap) {
  const limit = cap === undefined ? 64 : cap;
  const counters = { continues: 0, switches: 0, switchFailed: 0, skips: 0 };
  const recent = [];
  return {
    record(event) {
      const entry = Object.assign({ at: Date.now() }, event);
      if (event && event.kind === 'continue') counters.continues += 1;
      else if (event && event.kind === 'switch') counters.switches += 1;
      else if (event && event.kind === 'switch-failed') counters.switchFailed += 1;
      else if (event && event.kind === 'skip') counters.skips += 1;
      recent.push(entry);
      if (recent.length > limit) recent.splice(0, recent.length - limit);
    },
    reset() {
      counters.continues = 0;
      counters.switches = 0;
      counters.switchFailed = 0;
      counters.skips = 0;
      recent.length = 0;
    },
    snapshot() {
      return { counters: Object.assign({}, counters), recent: recent.slice().reverse() };
    },
  };
}

/** 读取可用路由目录（provider → models），来源为 Loader 条目配置 + 已注册提供商。 */
export function readCatalog(ctx) {
  const map = new Map();
  const add = (provider, model) => {
    if (typeof provider !== 'string' || provider.length === 0) return;
    if (!map.has(provider)) map.set(provider, new Set());
    if (typeof model === 'string' && model.length > 0) map.get(provider).add(model);
  };
  try {
    for (const entry of ctx.loader.entries()) {
      const cfg = entry && entry.options ? entry.options.config : undefined;
      const providers = cfg && cfg.providers;
      if (!providers || typeof providers !== 'object') continue;
      for (const provider of Object.keys(providers)) {
        add(provider, undefined);
        const row = providers[provider];
        const models = row && Array.isArray(row.models) ? row.models : [];
        for (const model of models) add(provider, model && model.id);
      }
    }
  } catch (error) {
    // 目录只是选择器提示；读取失败不影响插件运行。
  }
  try {
    for (const provider of ctx.llm.listProviders()) add(provider.id, undefined);
  } catch (error) {
    // 同上。
  }
  return [...map.entries()]
    .map(([provider, models]) => ({ provider, models: [...models].sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

/** 用官方 configEditor 持久化到 profile patch；不可用时降级为内存生效。 */
export function createPersister(ctx, log) {
  return async function persist(nextConfig) {
    let editor;
    try {
      editor = ctx.get('configEditor');
    } catch (error) {
      editor = undefined;
    }
    const entry = ctx.fiber && ctx.fiber.entry ? ctx.fiber.entry : undefined;
    if (editor === undefined || editor === null || typeof editor.edit !== 'function') {
      return { persisted: false, reason: 'configEditor 服务不可用：本次仅内存生效' };
    }
    if (entry === undefined) {
      return { persisted: false, reason: '插件配置行不可用：本次仅内存生效' };
    }
    try {
      await editor.edit(entry, () => JSON.parse(JSON.stringify(nextConfig)));
      return { persisted: true, documentPath: editor.documentPath ? String(editor.documentPath) : null };
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error);
      log.warn('配置持久化失败：%s', message);
      return { persisted: false, reason: message };
    }
  };
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (raw.trim() === '') return null;
  return JSON.parse(raw);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/**
 * 惰性注册配置读写端点。
 * @param ctx - 插件上下文（webServer 用 ctx.get 惰性获取）。
 * @param deps - { config, Config, defaults, persist, stats, log }
 */
export function registerConfigApi(ctx, deps) {
  let didRoute = false;

  // 目录扫描要遍历 Loader 条目；30s 缓存把 GET 的成本压到常量级。
  let catalogCacheAt = 0;
  let catalogCache = [];
  const catalogNow = () => {
    const ts = Date.now();
    if (ts - catalogCacheAt > 30000) {
      catalogCache = readCatalog(ctx);
      catalogCacheAt = ts;
    }
    return catalogCache;
  };

  const payload = (extra) => {
    let editor;
    try {
      editor = ctx.get('configEditor');
    } catch (error) {
      editor = undefined;
    }
    const entry = ctx.fiber && ctx.fiber.entry ? ctx.fiber.entry : undefined;
    const entryId = entry && entry.options && entry.options.id ? String(entry.options.id) : null;
    const editable = editor !== undefined && editor !== null && typeof editor.edit === 'function' && entry !== undefined;
    return Object.assign({
      ok: true,
      config: JSON.parse(JSON.stringify(deps.config)),
      defaults: deps.defaults,
      catalog: catalogNow(),
      runtime: deps.stats.snapshot(),
      meta: {
        plugin: 'dsh-auto-continue',
        entryId,
        editable,
        documentPath: editor && editor.documentPath ? String(editor.documentPath) : null,
        updatedAt: Date.now(),
      },
    }, extra || {});
  };

  const applyConfig = async (incoming, wantPersist) => {
    const merged = Object.assign({}, deps.config, incoming || {});
    const validated = deps.Config(merged);
    Object.assign(deps.config, validated);
    if (wantPersist === false) return payload({ persisted: false, reason: '已跳过持久化' });
    const result = await deps.persist(validated);
    return payload(result);
  };

  const tryRegister = () => {
    if (didRoute) return;
    try {
      const webServer = ctx.get('webServer');
      if (!webServer || typeof webServer.register !== 'function') return;

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/auto-continue/config',
        handler: async (req, res) => {
          if ((req.method || 'GET').toUpperCase() === 'GET') {
            sendJson(res, 200, payload({ persisted: null }));
            return;
          }
          try {
            const body = await readJsonBody(req);
            const incoming = body && body.config !== undefined ? body.config : body;
            const result = await applyConfig(incoming, body && body.persist);
            sendJson(res, 200, result);
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
          }
        },
      }), 'dsh-auto-continue: GET/POST /api/auto-continue/config');

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/auto-continue/config/reset',
        handler: async (req, res) => {
          try {
            const result = await applyConfig(deps.Config({}), true);
            sendJson(res, 200, result);
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
          }
        },
      }), 'dsh-auto-continue: POST /api/auto-continue/config/reset');

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/auto-continue/events',
        handler: async (req, res) => {
          try {
            const urlText = req.url || '';
            const match = urlText.match(/[?&]limit=(\d+)/);
            const limit = match ? Math.min(1000, Math.max(1, Number(match[1]))) : 200;
            let lines = [];
            try {
              const text = await readFile(eventLogPath(), 'utf8');
              lines = text.split('\n').filter((line) => line.trim() !== '');
            } catch (error) {
              // 文件可能尚未生成（插件刚装好还没遇到过失败）。
            }
            const events = [];
            for (const line of lines.slice(-limit)) {
              try { events.push(JSON.parse(line)); } catch (error) { /* 跳过坏行 */ }
            }
            sendJson(res, 200, { ok: true, file: eventLogPath(), total: lines.length, count: events.length, events: events.reverse() });
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
          }
        },
      }), 'dsh-auto-continue: GET /api/auto-continue/events');

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/auto-continue/runtime/reset',
        handler: async (req, res) => {
          try {
            deps.stats.reset();
            sendJson(res, 200, payload({ persisted: null }));
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
          }
        },
      }), 'dsh-auto-continue: POST /api/auto-continue/runtime/reset');

      didRoute = true;
      deps.log.info('配置端点已注册：GET/POST /api/auto-continue/config，POST /config/reset，POST /runtime/reset');
    } catch (error) {
      deps.log.warn('配置端点注册失败（稍后重试）：%s', error && error.message ? error.message : String(error));
    }
  };

  tryRegister();
  ctx.on('internal/service', (serviceName) => {
    if (serviceName === 'webServer') tryRegister();
  });
}
