# dsh-auto-continue

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的自动续跑与模型回退插件：给不稳定的模型 API（默认 nvidia 免费 NIM）兜底。

回合因提供商失败而中断时（网络超时、流式超时、连接错误、空响应……包括官方 llm-retry 重试耗尽后的「本轮运行失败」），自动以用户消息发送「继续」让模型从断点接着跑；连续失败达到阈值后，把下一个请求按列表切换到备用模型。全部行为可在 Web 配置台里自行调整。

## 功能

- **多提供商监视**：`providers` 数组（兼容旧的单 `provider` 字段），任一被监视提供商的回合失败都会触发。
- **按次数续跑文案**：`continueMessages` 序列——第 1 次发第 1 条、第 2 次发第 2 条、之后重复最后一条；留空用 `continueText`。
- **模型回退列表**：`fallbacks` 按顺序轮转，每条可直接指定思考强度（`reasoningEffort`：off/minimal/low/medium/high/xhigh/max）；目标模型不支持时单次本地校验后剥离，绝不逐档重试。
- **续跑节奏**：`maxConsecutiveFailures`（连续失败几次后切换模型）、`maxContinuesPerBurst`（每波上限）、`burstWindowMs`（突发窗口）、`continueDelayMs`（续跑前等待）。
- **失败判定**：监视提供商的回合失败一律续跑；仅 `skipCodes`（鉴权/上下文超限/参数非法等终态）否决。`continueCodes` 作为兼容字段保留。
- **Web 配置台**：安装后在会话视图的「自动续跑」页签（紧随「并发监控」）可视化编辑一切；保存先原地生效，再经官方 `configEditor` 写回 profile patch 并热重载。
- **运行事件日志**：每个回合失败/续跑/切换/跳过都记录在内存环与 `auto-continue.events.jsonl`（512KB 自动轮转），配置台可查，跨重启保留。
- **零构建链**：服务端为纯 ESM；客户端是手写的 `window.__ModuleLoader__` bundle，仅依赖 react 种子。

## 安装

```sh
dsh plugin --profile <name> add dsh-auto-continue
```

或从本仓库安装：

```sh
dsh plugin --profile <name> add github:<owner>/dsh-auto-continue
```

安装后重启 DSH 生效；配置台页签随插件一起出现。

## 配置

在 profile 的 `cordis.patch.yml` 里对 `auto-continue` 行做整行覆盖（也可全部在配置台里改）：

```yaml
- id: auto-continue
  config:
    enabled: true
    providers: [nvidia]
    continueText: 继续
    continueMessages: []
    maxConsecutiveFailures: 2
    maxContinuesPerBurst: 5
    burstWindowMs: 600000
    continueDelayMs: 0
    continueOnMaxTokens: false
    skipCodes: [AUTH, INVALID_CREDENTIAL, CONTEXT_WINDOW_EXCEEDED, INVALID_REQUEST]
    fallbacks:
      - provider: nvidia
        model: deepseek-ai/deepseek-v4.1-flash
      - provider: bailu
        model: bailu-2.9-preview
        reasoningEffort: high
    notifyUser: false
    sourceKind: model-selection
```

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| enabled | true | 总开关（配置台仍可用） |
| providers | [] | 监视的提供商列表；空则退回单 provider 字段 |
| provider | nvidia | 兼容字段：providers 为空时的监视对象 |
| continueText | 继续 | 默认续跑文案 |
| continueMessages | [] | 按次数取用的文案序列，超出重复最后一条 |
| maxConsecutiveFailures | 2 | 连续失败几次后切换模型 |
| maxContinuesPerBurst | 5 | 每波最多续跑次数（0 = 不限） |
| burstWindowMs | 600000 | 突发窗口，超窗重新计数 |
| continueDelayMs | 0 | 续跑前等待毫秒数（给上游恢复时间） |
| continueOnMaxTokens | false | 输出被 max-tokens 截断时是否续跑 |
| skipCodes | AUTH 等 | 终态码：命中则永不续跑 |
| continueCodes | 兼容保留 | 旧版白名单；现行判定不依赖它 |
| fallbacks | [] | 回退列表 {provider, model, reasoningEffort?}，按顺序轮转 |
| maxReasoningEffort | false | 已废弃：探测已移除，档位直接在每条 fallback 上选 |
| reasoningEfforts | 兼容保留 | 已废弃 |
| notifyUser | false | 切换模型时插入一条可见提示消息 |
| sourceKind | model-selection | 自动消息的 source.kind |

## HTTP API（配置台数据源，也可 curl）

| 端点 | 说明 |
| --- | --- |
| GET /api/auto-continue/config | 当前配置 + 插件默认值 + provider/model 目录 + 运行统计 |
| POST /api/auto-continue/config | body `{config, persist?}`：校验（非法 400）→ 原地生效 → 持久化 |
| POST /api/auto-continue/config/reset | 恢复插件默认并持久化 |
| POST /api/auto-continue/runtime/reset | 清空内存统计 |
| GET /api/auto-continue/events?limit=200 | 事件日志尾部（跨重启） |

## 测试

```sh
node --test test/
```

零依赖：engine/switch/api 全部依赖注入，`node:test` 原生跑。

## 已知边界

- 服务端代码改动需要重启 DSH；配置台保存只热重载配置。
- 提供商把流「正常」关闭但内容被截断（无错误码）时无法与正常完成区分，可开 `continueOnMaxTokens` 或手动发「继续」。
- 熔断状态与内存统计在进程内，重启重置；事件文件保留。
- 只覆盖 agent 主链路；标题/压缩等辅助调用不切换。

## License

MIT
