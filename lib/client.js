/**
 * dsh-auto-continue-panel —— 「自动续跑」配置台（client bundle）
 *
 * 手写 __ModuleLoader__ bundle（零构建链，仅依赖 react 种子），注册到
 * conversation.view 槽（order 305，紧随「并发监控」）。
 *
 * 视觉：极简编辑风（Premium Utilitarian Minimalism 的暗色适配）——
 * 排版驱动层级、发丝分隔线、大留白、无阴影/无渐变/无大圆角药丸；
 * 控件显式设置背景与文字色（修复暗色下拉），color-scheme: dark。
 *
 * 端点（由 dsh-auto-continue 提供）：
 *   GET/POST /api/auto-continue/config · POST /config/reset · POST /runtime/reset
 */
window.__ModuleLoader__.load({
  id: "dsh-auto-continue-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { useState, useEffect, useRef, useCallback } = React;
    const h = React.createElement;

    const API = "/api/auto-continue/config";
    const API_RESET = "/api/auto-continue/config/reset";
    const API_RUNTIME_RESET = "/api/auto-continue/runtime/reset";
    const API_EVENTS = "/api/auto-continue/events";
    const POLL_MS = 3000;
    const NL = String.fromCharCode(10);

    const dsw = (name, fb) => "var(--dsw-alias-" + name + ", " + fb + ")";
    const C = {
      text: dsw("label-primary", "#ececec"),
      mute: dsw("label-secondary", "#9a9a9a"),
      weak: dsw("label-tertiary", "#6f6f6f"),
      line: dsw("border-l2", "rgba(128,128,128,.32)"),
      lineSoft: dsw("border-l1", "rgba(128,128,128,.16)"),
      surface: dsw("bg-module-platform", "#1b1b1b"),
      field: dsw("bg-input-primary", "rgba(255,255,255,.05)"),
      hover: dsw("interactive-bg-hover", "rgba(128,128,128,.12)"),
      ok: dsw("state-success-primary", "#69a97a"),
      warn: dsw("state-warn-primary", "#c9a35c"),
      err: dsw("state-error-primary", "#d07a7a"),
      accent: dsw("state-business-primary", "#4d8fd6"),
      onAccent: dsw("label-primary-foreground", "#ffffff")
    };
    const F = { title: "18px", h3: "14px", body: "12.5px", label: "13px", small: "11.5px" };
    const LH = { title: "26px", h3: "20px", body: "19px", label: "19px", small: "16px" };
    const GAP = { xs: 4, sm: 8, md: 12, lg: 16 };
    const R = { input: 6, btn: 6, med: 8 };

    const CODE_HINT = {
      TIMEOUT: "网络/流式超时",
      TRANSPORT: "传输中断（连接错误）",
      STREAM_CLOSED: "流未正常结束",
      SERVER: "上游 5xx",
      RATE_LIMIT: "限流",
      QUOTA: "额度/余额",
      EMPTY_RESPONSE: "空响应",
      UNKNOWN: "未知错误",
      AUTH: "鉴权失败",
      INVALID_CREDENTIAL: "凭据无效",
      MISSING_CREDENTIAL: "缺少凭据",
      CONTEXT_WINDOW_EXCEEDED: "上下文超限",
      UNSUPPORTED_REASONING_EFFORT: "不支持该思考强度",
      NO_ADAPTER: "无适配器",
      INVALID_REQUEST: "请求非法",
      INVALID_ARGS: "参数非法",
      PI_AI_ERROR: "上游流错误",
      ABORTED: "被中止",
      MAX_TOKENS: "输出被截断"
    };
    const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const EVENT_LABEL = { "turn-error": "回合失败", "turn-aborted": "回合中止", continue: "续跑", switch: "切换模型", "switch-failed": "切换失败", skip: "跳过", "continue-failed": "续跑失败" };
    const SKIP_LABEL = { budget: "超出每波上限", "pending-input": "已有排队消息", "terminal-code": "终态错误码", "no-provider-failure": "非提供商失败" };

    const CSS_ID = "dsh-acp-style";
    function ensureStyle() {
      if (document.getElementById(CSS_ID)) return;
      const el = document.createElement("style");
      el.id = CSS_ID;
      el.textContent = [
        "[data-acp-root] { color-scheme: dark; font-variant-numeric: tabular-nums; }",
        "[data-acp-root] * { box-sizing: border-box; }",
        "[data-acp-root] button { font: inherit; color: inherit; }",
        "[data-acp-root] input, [data-acp-root] select, [data-acp-root] textarea {",
        "  font: inherit; color: " + C.text + "; background-color: " + C.field + ";",
        "  border: 1px solid " + C.lineSoft + "; border-radius: " + R.input + "px; padding: 6px 10px; min-width: 0; width: 100%;",
        "}",
        "[data-acp-root] select { padding-right: 26px; }",
        "[data-acp-root] option { background-color: " + C.surface + "; color: " + C.text + "; }",
        "[data-acp-root] input:focus-visible, [data-acp-root] select:focus-visible, [data-acp-root] textarea:focus-visible {",
        "  outline: none; border-color: " + C.accent + "; box-shadow: 0 0 0 1px " + C.accent + ";",
        "}",
        "[data-acp-root] input::placeholder { color: " + C.weak + "; }",
        "[data-acp-btn] { cursor: pointer; border: 1px solid " + C.lineSoft + "; background: transparent; border-radius: " + R.btn + "px; padding: 5px 12px; white-space: nowrap; }",
        "[data-acp-btn]:disabled { opacity: .4; cursor: not-allowed; }",
        "[data-acp-btn]:not(:disabled):hover { background: " + C.hover + "; border-color: " + C.line + "; }",
        "[data-acp-btn='primary'] { background: " + C.accent + "; color: " + C.onAccent + "; border-color: transparent; font-weight: 500; }",
        "[data-acp-btn='primary']:not(:disabled):hover { filter: brightness(1.08); background: " + C.accent + "; }",
        "[data-acp-btn='ghost'] { border-color: transparent; }",
        "[data-acp-btn='danger'] { color: " + C.err + "; }",
        "[data-acp-check] { accent-color: " + C.accent + "; width: 14px; height: 14px; flex: none; }",
        "[data-acp-chip] button:hover { color: " + C.text + "; }"
      ].join(NL);
      document.head.appendChild(el);
    }

    function num(v, fb) { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : (fb === undefined ? 0 : fb); }
    function errText(e) { return e && e.message ? String(e.message) : String(e); }
    function clock(ts) { const d = new Date(num(ts)); const p = (n) => (n < 10 ? "0" : "") + n; return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); }
    function ago(ts) { if (!ts) return "—"; const d = Date.now() - num(ts); if (d < 1500) return "刚刚"; if (d < 60000) return Math.round(d / 1000) + "s 前"; if (d < 3600000) return Math.round(d / 60000) + "m 前"; return Math.round(d / 3600000) + "h 前"; }
    function codeText(code) { const c = String(code); const hint = CODE_HINT[c]; return hint ? c + " · " + hint : c; }
    function trunc(s, n) { const t = s === null || s === undefined ? "" : String(s); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
    function changedKeys(a, b) {
      if (!a || !b) return [];
      const keys = [];
      const seen = {};
      for (const k of Object.keys(a).concat(Object.keys(b))) { if (!seen[k]) { seen[k] = true; keys.push(k); } }
      return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    }

    function eventText(ev) {
      const kind = EVENT_LABEL[ev.kind] || ev.kind || "事件";
      if (ev.kind === "turn-error") return "回合失败 · " + codeText(ev.code || "UNKNOWN") + (ev.message ? " · " + trunc(ev.message, 44) : "") + (ev.continued ? " → 已安排续跑" : " → 未续跑");
      if (ev.kind === "turn-aborted") return "回合被中止（用户停止，不续跑）";
      if (ev.kind === "continue") return "已发送续跑（第 " + num(ev.attempt, "?") + " 次）→「" + String(ev.text || "") + "」" + (ev.switchTo ? "，并切换至 " + ev.switchTo.provider + "/" + ev.switchTo.model : "") + (ev.code ? " · " + ev.code : "");
      if (ev.kind === "switch") return "切换模型 " + (ev.from ? ev.from.provider + "/" + ev.from.model : "?") + " → " + (ev.to ? ev.to.provider + "/" + ev.to.model : "?");
      if (ev.kind === "switch-failed") return "切换失败 " + (ev.provider || "?") + "/" + (ev.model || "?") + "：" + (ev.reason || "未知");
      if (ev.kind === "skip") return "跳过续跑 · " + (SKIP_LABEL[ev.reason] || ev.reason || "") + (ev.code ? " · " + ev.code : "");
      if (ev.kind === "continue-failed") return "续跑排队失败：" + (ev.reason || "");
      return kind + " " + (ev.reason || "");
    }

    function Btn(props) {
      return h("button", {
        type: "button",
        "data-acp-btn": props.variant || "default",
        title: props.title || props.label,
        "aria-label": props.ariaLabel || props.label,
        disabled: props.disabled === true,
        onClick: props.onClick,
        style: { fontSize: F.body, lineHeight: LH.body, padding: props.small ? "2px 8px" : "5px 12px" }
      }, props.label);
    }
    function Section(props) {
      return h("section", { style: { padding: "20px 0 24px", borderBottom: "1px solid " + C.lineSoft } },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: GAP.md, marginBottom: 16, flexWrap: "wrap" } },
          h("h3", { style: { margin: 0, fontSize: F.h3, lineHeight: LH.h3, fontWeight: 600, letterSpacing: "0.01em" } }, props.title),
          props.desc ? h("span", { style: { fontSize: F.small, lineHeight: LH.small, color: C.mute } }, props.desc) : null,
          props.right ? h("span", { style: { marginLeft: "auto" } }, props.right) : null
        ),
        props.children
      );
    }
    function Field(props) {
      return h("label", { style: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 } },
        h("span", { style: { fontSize: F.small, lineHeight: LH.small, color: C.mute } }, props.label),
        props.children,
        props.hint ? h("span", { style: { fontSize: F.small, lineHeight: LH.small, color: C.weak } }, props.hint) : null
      );
    }
    function Toggle(props) {
      return h("label", { style: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: F.body, lineHeight: LH.body, cursor: "pointer" } },
        h("input", { "data-acp-check": "", type: "checkbox", checked: props.checked === true, onChange: (e) => props.onChange(e.target.checked) }),
        h("span", null, props.label),
        props.hint ? h("span", { style: { fontSize: F.small, color: C.weak } }, props.hint) : null
      );
    }
    function Chip(props) {
      return h("span", { "data-acp-chip": "", style: { display: "inline-flex", alignItems: "center", gap: 2, border: "1px solid " + C.lineSoft, borderRadius: R.med, padding: "2px 4px 2px 9px", fontSize: F.small, lineHeight: LH.small, whiteSpace: "nowrap" } },
        h("span", { style: { color: C.text } }, props.label),
        props.onUp ? h("button", { type: "button", "data-acp-btn": "ghost", onClick: props.onUp, "aria-label": "上移 " + props.label, style: { padding: "0 4px", fontSize: F.small, border: "none", background: "transparent", color: C.mute, cursor: "pointer" } }, "↑") : null,
        props.onDown ? h("button", { type: "button", "data-acp-btn": "ghost", onClick: props.onDown, "aria-label": "下移 " + props.label, style: { padding: "0 4px", fontSize: F.small, border: "none", background: "transparent", color: C.mute, cursor: "pointer" } }, "↓") : null,
        props.onRemove ? h("button", { type: "button", "data-acp-btn": "ghost", onClick: props.onRemove, "aria-label": "删除 " + props.label, style: { padding: "0 6px", fontSize: F.small, border: "none", background: "transparent", color: C.err, cursor: "pointer" } }, "×") : null
      );
    }
    function Stat(props) {
      return h("div", { style: { minWidth: 96, padding: "2px 18px 2px 0", borderRight: "1px solid " + C.lineSoft } },
        h("div", { style: { fontSize: F.small, lineHeight: LH.small, color: C.mute } }, props.label),
        h("div", { style: { fontSize: "20px", lineHeight: "28px", fontWeight: 600, color: props.tone || C.text } }, String(props.value))
      );
    }
    function RowMove(props) {
      return h("div", { style: { display: "flex", gap: 2, alignItems: "center", paddingBottom: 2 } },
        h(Btn, { small: true, label: "↑", ghost: true, ariaLabel: "上移", disabled: props.first, onClick: props.onUp }),
        h(Btn, { small: true, label: "↓", ghost: true, ariaLabel: "下移", disabled: props.last, onClick: props.onDown }),
        h(Btn, { small: true, label: "×", variant: "danger", ghost: true, ariaLabel: "删除", onClick: props.onRemove })
      );
    }
    function CodeEditor(props) {
      const [draftValue, setDraftValue] = React.useState("");
      const items = props.items || [];
      const move = (i, dir) => {
        const list = items.slice();
        const j = i + dir;
        if (j < 0 || j >= list.length) return;
        const t = list[i];
        list[i] = list[j];
        list[j] = t;
        props.onChange(list);
      };
      const add = () => {
        const v = draftValue.trim();
        if (v.length === 0) return;
        if (items.indexOf(v) < 0) props.onChange(items.concat([v]));
        setDraftValue("");
      };
      return h("div", { style: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } },
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
          items.length === 0 ? h("span", { style: { fontSize: F.small, color: C.weak } }, "（空）") : null,
          items.map((item, i) => h(Chip, {
            key: String(item) + "-" + i,
            label: codeText(item),
            onUp: props.ordered && i > 0 ? () => move(i, -1) : null,
            onDown: props.ordered && i < items.length - 1 ? () => move(i, 1) : null,
            onRemove: () => props.onChange(items.filter((_, k) => k !== i))
          }))
        ),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", maxWidth: 460 } },
          h("input", {
            type: "text",
            list: props.datalistId || "acp-codes",
            value: draftValue,
            placeholder: props.placeholder || "输入代码后回车添加",
            "aria-label": props.label + "：添加",
            onChange: (e) => setDraftValue(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }
          }),
          h(Btn, { label: "添加", onClick: add })
        ),
        props.hint ? h("div", { style: { fontSize: F.small, color: C.weak } }, props.hint) : null,
        h("datalist", { id: props.datalistId || "acp-codes" }, (props.choices || []).map((choice) => h("option", { key: choice, value: choice })))
      );
    }

    function Panel() {
      const [st, setSt] = useState({ loading: true, error: null, saving: false, flash: null, server: null, draft: null, runtime: null, meta: null, catalog: [] });
      const [hist, setHist] = useState({ events: [], file: null, total: 0 });
      const mounted = useRef(true);
      const timer = useRef(null);
      const lastEventsRef = useRef(0);

      const load = useCallback(async () => {
        try {
          const res = await fetch(API, { cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const json = await res.json();
          if (!mounted.current) return;
          if (Date.now() - lastEventsRef.current > 10000) {
            lastEventsRef.current = Date.now();
            try {
              const r2 = await fetch(API_EVENTS + "?limit=300", { cache: "no-store" });
              const j2 = await r2.json();
              if (mounted.current && Array.isArray(j2.events)) setHist({ events: j2.events, file: j2.file || null, total: j2.total || 0 });
            } catch (e2) { /* 历史读取失败不影响主数据 */ }
          }
          setSt((prev) => {
            const dirty = prev.draft !== null && prev.server !== null && JSON.stringify(prev.draft) !== JSON.stringify(prev.server);
            const next = Object.assign({}, prev, {
              loading: false,
              error: null,
              runtime: json.runtime || null,
              meta: json.meta || null,
              catalog: Array.isArray(json.catalog) ? json.catalog : prev.catalog,
              server: json.config || null
            });
            if (!dirty) next.draft = json.config || null;
            return next;
          });
        } catch (e) {
          if (!mounted.current) return;
          setSt((prev) => Object.assign({}, prev, { loading: false, error: errText(e) }));
        }
      }, []);

      useEffect(() => {
        mounted.current = true;
        load();
        const onVisible = () => { if (document.visibilityState === "visible" && mounted.current) load(); };
        document.addEventListener("visibilitychange", onVisible);
        timer.current = setInterval(() => {
          if (!mounted.current || document.visibilityState !== "visible") return;
          load();
        }, POLL_MS);
        return () => {
          mounted.current = false;
          clearInterval(timer.current);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, [load]);

      const patch = (fields) => setSt((p) => Object.assign({}, p, { draft: Object.assign({}, p.draft, fields), flash: null }));
      const patchFn = (fn) => setSt((p) => Object.assign({}, p, { draft: fn(p.draft), flash: null }));

      async function post(url, body) {
        setSt((p) => Object.assign({}, p, { saving: true, flash: null }));
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body)
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !json || json.ok === false) throw new Error(json && json.error ? json.error : "HTTP " + res.status);
          setSt((p) => Object.assign({}, p, {
            saving: false,
            server: json.config || p.server,
            draft: json.config || p.draft,
            runtime: json.runtime || p.runtime,
            meta: json.meta || p.meta,
            catalog: Array.isArray(json.catalog) ? json.catalog : p.catalog,
            error: null,
            flash: json.persisted === true
              ? "已保存并写入 profile，热生效"
              : (json.persisted === false ? "已生效，但未写入磁盘：" + (json.reason || "未知原因") : "已刷新")
          }));
        } catch (e) {
          setSt((p) => Object.assign({}, p, { saving: false, error: errText(e) }));
        }
      }

      if (st.loading && st.draft === null) {
        return h("div", { "data-acp-root": "", role: "region", "aria-label": "自动续跑配置台", style: { padding: "28px", color: C.text, fontSize: F.body, lineHeight: LH.body } }, "正在读取 /api/auto-continue/config …");
      }
      if (st.draft === null) {
        return h("div", { "data-acp-root": "", role: "region", "aria-label": "自动续跑配置台", style: { padding: "28px", color: C.text, fontSize: F.body, lineHeight: LH.body, display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 } },
          h("div", { style: { fontSize: F.h3, fontWeight: 600 } }, "无法读取配置"),
          h("div", { style: { color: C.err } }, st.error || "未知原因"),
          h("div", { style: { color: C.mute } }, "本页数据来自 dsh-auto-continue 的配置端点；请确认该插件已加载。"),
          h("div", null, h(Btn, { label: "重试", variant: "primary", onClick: () => { setSt((p) => Object.assign({}, p, { loading: true })); load(); } }))
        );
      }

      const draft = st.draft;
      const catalogRows = Array.isArray(st.catalog) ? st.catalog : [];
      const dirty = st.server !== null && JSON.stringify(draft) !== JSON.stringify(st.server);
      const messages = Array.isArray(draft.continueMessages) ? draft.continueMessages : [];
      const fallbacks = Array.isArray(draft.fallbacks) ? draft.fallbacks : [];
      const plan = messages.filter((m) => typeof m === "string" && m.length > 0);
      const planText = plan.length === 0
        ? "每次都发默认文案「" + draft.continueText + "」"
        : plan.map((m, i) => "第 " + (i + 1) + " 次 → " + m).join("　·　") + "　·　之后重复最后一条";
      const changed = changedKeys(draft, st.server);
      const watchedList = Array.isArray(draft.providers) && draft.providers.length > 0 ? draft.providers : (draft.provider ? [draft.provider] : []);
      const counters = (st.runtime && st.runtime.counters) || { continues: 0, switches: 0, switchFailed: 0, skips: 0 };
      const recent = (st.runtime && st.runtime.recent) || [];

      return h("div", {
        "data-acp-root": "",
        role: "region",
        "aria-label": "自动续跑配置台",
        style: { color: C.text, fontSize: F.body, lineHeight: LH.body, fontVariantNumeric: "tabular-nums", boxSizing: "border-box", height: "100%", maxHeight: "100%", minHeight: 0, overflowY: "auto", padding: "20px 26px 48px" }
      },
        h("div", { style: { maxWidth: 880, margin: "0 auto" } },
          // 顶栏
          h("div", { style: { display: "flex", alignItems: "center", gap: GAP.md, flexWrap: "wrap", paddingBottom: 18, borderBottom: "1px solid " + C.line } },
            h("span", { "aria-hidden": "true", style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: draft.enabled ? C.ok : C.weak, flex: "none" } }),
            h("h2", { style: { margin: 0, fontSize: F.title, lineHeight: LH.title, fontWeight: 600, letterSpacing: "-0.01em" } }, "自动续跑"),
            h("span", { style: { fontSize: F.body, color: C.mute } }, "监视 " + (watchedList.length > 0 ? watchedList.join("、") : "（未设置）") + " · 回合失败自动续跑 · 连续 " + num(draft.maxConsecutiveFailures) + " 次后切换模型"),
            dirty ? h("span", { style: { fontSize: F.small, color: C.warn }, title: changed.join("、") }, "改了 " + changed.length + " 项" + (changed.length > 0 ? "：" + changed.slice(0, 3).join("、") + (changed.length > 3 ? "…" : "") : "")), st.server).length > 0 ? "：" + changedKeys(draft, st.server).slice(0, 3).join("、") + (changedKeys(draft, st.server).length > 3 ? "…" : "") : "")) : null,
            st.flash ? h("span", { role: "status", style: { fontSize: F.small, color: C.ok } }, st.flash) : null,
            st.meta && st.meta.editable === false ? h("span", { style: { fontSize: F.small, color: C.warn } }, "configEditor 不可用，只能内存生效") : null,
            h("span", { style: { marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" } },
              h(Btn, { label: "重新加载", onClick: () => load() }),
              h(Btn, { label: "恢复插件默认", disabled: st.saving, onClick: () => post(API_RESET) }),
              h(Btn, { label: st.saving ? "保存中…" : "保存并生效", variant: "primary", disabled: st.saving || !dirty, onClick: () => post(API, { config: draft, persist: true }) })
            )
          ),
          st.error ? h("div", { role: "alert", style: { marginTop: 12, padding: "8px 12px", border: "1px solid " + C.err, borderRadius: R.med, fontSize: F.body } }, "错误：" + st.error) : null,

          // ① 运行
          h(Section, { title: "运行", desc: "关掉后所有钩子立即失效；监视哪个提供商，就由谁触发续跑" },
            h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 } },
              h("div", { style: { display: "flex", alignItems: "center" } },
                h(Toggle, { checked: draft.enabled, label: "启用自动续跑", onChange: (v) => patch({ enabled: v }) })
              ),
              h("div", { style: { minWidth: 260 } },
                h(CodeEditor, {
                  label: "监视的提供商（可多个）",
                  placeholder: "输入提供商后回车，如 nvidia",
                  datalistId: "acp-providers",
                  items: Array.isArray(draft.providers) && draft.providers.length > 0 ? draft.providers : (draft.provider ? [draft.provider] : []),
                  choices: catalogRows.map((row) => row.provider),
                  hint: "任一被监视提供商的回合失败都会触发续跑；留空则只看单 provider 字段",
                  onChange: (items) => patch({ providers: items, provider: items.length > 0 ? items[0] : (draft.provider || "") })
                })
              )
            )
          ),

          // ② 模型回退列表
          h(Section, {
            title: "模型回退列表",
            desc: "按顺序轮转：连续失败达到阈值后，下一个请求切到下一条；每行的思考强度直接生效（不支持时自动去掉，不逐档尝试）",
            right: h(Btn, { small: true, label: "+ 添加模型", onClick: () => patchFn((d) => Object.assign({}, d, { fallbacks: (d.fallbacks || []).concat([{ provider: (Array.isArray(d.providers) && d.providers[0]) || d.provider, model: "" }]) })) })
          },
            fallbacks.length === 0
              ? h("div", { style: { color: C.weak, fontSize: F.body, padding: "2px 0" } }, "列表为空：只续跑，不切换模型。")
              : h("div", null,
                  fallbacks.map((row, i) => {
                    const models = (catalogRows.find((r) => r.provider === row.provider) || { models: [] }).models || [];
                    const listId = "acp-models-" + i;
                    return h("div", {
                      key: "fb-" + i,
                      style: { display: "grid", gridTemplateColumns: "minmax(130px, 1.1fr) minmax(200px, 1.6fr) minmax(110px, .9fr) auto", gap: 12, alignItems: "end", padding: "10px 0", borderBottom: i < fallbacks.length - 1 ? "1px solid " + C.lineSoft : "none" }
                    },
                      h(Field, { label: i === 0 ? "provider" : "" },
                        h("input", { type: "text", list: "acp-providers", value: row.provider || "", onChange: (e) => patchFn((d) => { const list = d.fallbacks.slice(); list[i] = Object.assign({}, list[i], { provider: e.target.value }); return Object.assign({}, d, { fallbacks: list }); }) })
                      ),
                      h(Field, { label: i === 0 ? "model" : "" },
                        h("input", { type: "text", list: listId, value: row.model || "", onChange: (e) => patchFn((d) => { const list = d.fallbacks.slice(); list[i] = Object.assign({}, list[i], { model: e.target.value }); return Object.assign({}, d, { fallbacks: list }); }) }),
                        h("datalist", { id: listId }, models.map((m) => h("option", { key: m, value: m })))
                      ),
                      h(Field, { label: i === 0 ? "思考强度" : "" },
                        h("select", { value: row.reasoningEffort || "", onChange: (e) => patchFn((d) => { const list = d.fallbacks.slice(); const next = Object.assign({}, list[i]); const v = e.target.value; if (v === "") delete next.reasoningEffort; else next.reasoningEffort = v; list[i] = next; return Object.assign({}, d, { fallbacks: list }); }) },
                          h("option", { value: "" }, "不设置"),
                          EFFORTS.map((eff) => h("option", { key: eff, value: eff }, eff))
                        )
                      ),
                      h(RowMove, {
                        first: i === 0,
                        last: i === fallbacks.length - 1,
                        onUp: () => patchFn((d) => { const list = d.fallbacks.slice(); const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; return Object.assign({}, d, { fallbacks: list }); }),
                        onDown: () => patchFn((d) => { const list = d.fallbacks.slice(); const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; return Object.assign({}, d, { fallbacks: list }); }),
                        onRemove: () => patchFn((d) => Object.assign({}, d, { fallbacks: d.fallbacks.filter((_, k) => k !== i) }))
                      })
                    );
                  })
                )
          ),

          // ③ 续跑策略
          h(Section, { title: "续跑策略", desc: "官方重试（例如 5/5）耗尽后回合失败，由本插件在回合结束时接管续跑" },
            h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 } },
              h(Field, { label: "连续失败几次后切换模型", hint: "1 = 第一次失败就切" },
                h("input", { type: "number", min: 1, max: 50, value: num(draft.maxConsecutiveFailures), onChange: (e) => patch({ maxConsecutiveFailures: Math.max(1, Math.round(num(e.target.value, 1))) }) })
              ),
              h(Field, { label: "每波最多续跑几次", hint: "0 = 不限；防止死循环" },
                h("input", { type: "number", min: 0, max: 100, value: num(draft.maxContinuesPerBurst), onChange: (e) => patch({ maxContinuesPerBurst: Math.max(0, Math.round(num(e.target.value, 0))) }) })
              ),
              h(Field, { label: "突发窗口", hint: "超过窗口重新计数" },
                h("select", { value: String(num(draft.burstWindowMs)), onChange: (e) => patch({ burstWindowMs: num(e.target.value) }) },
                  [60000, 120000, 300000, 600000, 1800000, 3600000].map((ms) => h("option", { key: ms, value: String(ms) }, (ms / 60000) + " 分钟"))
                )
              ),
              h(Field, { label: "续跑前等待", hint: "给上游一点恢复时间" },
                h("select", { value: String(num(draft.continueDelayMs)), onChange: (e) => patch({ continueDelayMs: num(e.target.value) }) },
                  [0, 1000, 2000, 5000, 10000, 30000, 60000].map((ms) => h("option", { key: ms, value: String(ms) }, ms === 0 ? "立即" : (ms / 1000) + " 秒"))
                )
              )
            ),
            h("div", { style: { marginTop: 14 } },
              h(Toggle, { checked: draft.continueOnMaxTokens === true, label: "输出被 max-tokens 截断时也续跑", hint: "默认关闭", onChange: (v) => patch({ continueOnMaxTokens: v }) })
            )
          ),

          // ④ 每次续跑发什么
          h(Section, {
            title: "每次续跑发什么",
            desc: "按次数取用，超出后重复最后一条；留空则只用默认文案",
            right: h(Btn, { small: true, label: "+ 添加一条", onClick: () => patchFn((d) => Object.assign({}, d, { continueMessages: messages.concat([""]) })) })
          },
            h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
              messages.length === 0
                ? h("div", { style: { color: C.weak, fontSize: F.body } }, "未配置序列。")
                : messages.map((msg, i) => h("div", { key: "msg-" + i, style: { display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 12, alignItems: "center" } },
                    h("span", { style: { fontSize: F.small, color: C.mute, whiteSpace: "nowrap" } }, "第 " + (i + 1) + " 次"),
                    h("input", { type: "text", value: msg, "aria-label": "第 " + (i + 1) + " 次续跑文案", onChange: (e) => patchFn((d) => { const list = d.continueMessages.slice(); list[i] = e.target.value; return Object.assign({}, d, { continueMessages: list }); }) }),
                    h(RowMove, {
                      first: i === 0,
                      last: i === messages.length - 1,
                      onUp: () => patchFn((d) => { const list = d.continueMessages.slice(); const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; return Object.assign({}, d, { continueMessages: list }); }),
                      onDown: () => patchFn((d) => { const list = d.continueMessages.slice(); const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; return Object.assign({}, d, { continueMessages: list }); }),
                      onRemove: () => patchFn((d) => Object.assign({}, d, { continueMessages: d.continueMessages.filter((_, k) => k !== i) }))
                    })
                  )),
              h("div", { style: { display: "grid", gridTemplateColumns: "minmax(200px, 420px)", gap: 0 } },
                h(Field, { label: "默认文案（序列为空时使用）" },
                  h("input", { type: "text", value: draft.continueText, onChange: (e) => patch({ continueText: e.target.value }) })
                )
              ),
              h("div", { style: { fontSize: F.small, color: C.weak } }, "预览：" + planText)
            )
          ),

          // ⑤ 失败判定
          h(Section, { title: "失败判定", desc: "监视提供商的回合失败一律续跑；只有命中下面这些终态码才放弃（重试也不会好）" },
            h(CodeEditor, {
              label: "终态码（skipCodes，永不续跑）",
              placeholder: "输入代码后回车添加，如 AUTH",
              items: draft.skipCodes || [],
              choices: Object.keys(CODE_HINT),
              hint: "常见终态：AUTH（鉴权失败）、CONTEXT_WINDOW_EXCEEDED（上下文超限）、INVALID_REQUEST（请求非法）",
              onChange: (items) => patch({ skipCodes: items })
            })
          ),

          // ⑥ 通知
          h(Section, { title: "通知与其他" },
            h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, alignItems: "end" } },
              h("div", { style: { display: "flex", alignItems: "center", paddingBottom: 4 } },
                h(Toggle, { checked: draft.notifyUser === true, label: "切换模型时插入一条可见提示", onChange: (v) => patch({ notifyUser: v }) })
              ),
              h(Field, { label: "自动消息的 source.kind", hint: "默认 model-selection" },
                h("input", { type: "text", value: draft.sourceKind, onChange: (e) => patch({ sourceKind: e.target.value }) })
              )
            )
          ),

          // ⑦ 运行记录
          h(Section, {
            title: "运行记录",
            desc: "只读；事件同时写入 profiles/desktop/auto-continue.events.jsonl 便于跨重启排查",
            right: h(Btn, { small: true, label: "清空统计", onClick: () => post(API_RUNTIME_RESET) })
          },
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: 0, marginBottom: 14 } },
              h(Stat, { label: "已续跑", value: counters.continues, tone: C.ok }),
              h(Stat, { label: "切换模型", value: counters.switches }),
              h(Stat, { label: "切换失败", value: counters.switchFailed, tone: counters.switchFailed > 0 ? C.warn : C.text }),
              h(Stat, { label: "跳过", value: counters.skips, tone: counters.skips > 0 ? C.warn : C.text })
            ),
            h("div", { style: { maxHeight: 240, overflowY: "auto" } },
              h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: F.small, lineHeight: LH.small } },
                h("tbody", null,
                  (hist.events.length > 0 ? hist.events : recent).length === 0
                    ? h("tr", null, h("td", { style: { padding: "8px 0", color: C.weak } }, "暂无事件（回合失败/续跑/切换都会记录在这里）"))
                    : (hist.events.length > 0 ? hist.events : recent).map((ev, i) => h("tr", { key: "ev-" + i },
                        h("td", { style: { padding: "6px 12px 6px 0", color: C.weak, whiteSpace: "nowrap", verticalAlign: "top", borderBottom: "1px solid " + C.lineSoft } }, clock(ev.at) + " · " + ago(ev.at)),
                        h("td", { style: { padding: "6px 0", verticalAlign: "top", borderBottom: "1px solid " + C.lineSoft, color: ev.kind === "continue" ? C.text : C.mute } }, eventText(ev))
                      ))
                )
              )
            ),
            h("div", { style: { marginTop: 10, fontSize: F.small, color: C.weak } }, "事件日志：" + (hist.file || "…") + " · 共 " + num(hist.total) + " 条（跨重启保留，512KB 自动轮转）"),
            st.meta ? h("div", { style: { marginTop: 4, fontSize: F.small, color: C.weak } }, "插件行 " + (st.meta.entryId || "?") + " · " + (st.meta.editable ? "可持久化到 " + (st.meta.documentPath || "profile patch") : "不可持久化（仅内存生效）")) : null
          )
        )
      );
    }

    exports.inject = ["slots"];
    exports.apply = (ctx) => {
      try {
        ensureStyle();
        if (!ctx.slots || typeof ctx.slots.inject !== "function") {
          console.warn("[auto-continue-panel] client: 无 slots 服务，跳过面板注册");
          return;
        }
        ctx.slots.inject("conversation.view", () =>
          ctx.slots.register({
            name: "conversation.view",
            id: "auto-continue-panel-view",
            order: 305,
            label: () => "自动续跑"
          }, Panel)
        );
      } catch (e) {
        console.error("[auto-continue-panel] client: 面板注册失败", e);
      }
    };

    return module.exports;
  }
});
