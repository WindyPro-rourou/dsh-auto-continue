---
name: configure-auto-continue
description: 引导用户配置 dsh-auto-continue 插件（监视哪些提供商、失败后发什么、连续几次切换哪个模型、思考强度选什么）。当用户提到自动续跑、继续重试、模型回退、nvidia 不稳定等话题时使用。流程：AI 先探测当前配置，写入建议配置，再请用户确认。
---

# 配置 dsh-auto-continue

本技能引导你（AI）为 dsh-auto-continue 插件完成配置，遵循「AI 先配置，用户确认」流程。

## 0. 前置检查

确认插件已安装：profile 的 package.json 的 dsh.profile.bundles 里有 dsh-auto-continue。未安装先 `dsh plugin --profile <name> add dsh-auto-continue`。

## 1. 探测当前配置

优先打 HTTP 端点（运行中宿主）:

```sh
curl http://127.0.0.1:<port>/api/auto-continue/config
```

返回 config（当前生效配置）、defaults（插件默认）、catalog（可选 provider/model）、runtime（统计）。宿主端口见 DSH_WEB_URL。

读不到端点时，改为读 profile 的 cordis.patch.yml 中 id 为 auto-continue 的行（整行替换语义：覆盖时必须重述全部字段）。

## 2. 决策要点

- providers：用户常抱怨哪个不稳定就监视哪个（可多个）。
- continueMessages：建议第一条「继续」，第二条写明断点续写（如「接着上次的断点继续，不要重复已输出内容」）。
- fallbacks：优先同网关免key模型，再考虑跨提供商；每条可直接给 reasoningEffort（不支持会被自动剥离）。
- maxConsecutiveFailures 默认 2；maxContinuesPerBurst 是防死循环上限。
- 终态码（鉴权/上下文超限）保持跳过，不要为了覆盖面把 AUTH 加进续跑。

## 3. 写入配置

在线：POST /api/auto-continue/config，body {"config": {...}, "persist": true}——先原地生效再写回 patch 并热重载。

离线：编辑 profile 的 cordis.patch.yml 的 auto-continue 行（重述全部字段），重启 DSH 生效。

## 4. 请用户确认

展示：监视的 providers、续跑文案序列、回退列表与顺序、阈值与节奏。用户确认后提示：服务端代码更新需重启 DSH；仅配置变更已热生效。

## 5. 验证

触发一次失败（如断网/超时模型）后，打开会话视图的「自动续跑」页签查看运行记录：应出现「回合失败 · <码> → 已安排续跑」与「已发送续跑（第 N 次）」事件；也可读 auto-continue.events.jsonl。
