// src/webui/client.ts
var TEXT = {
  zh: {
    title: "\u6A21\u578B\u4F9B\u5E94\u5546",
    desc: "\u70B9\u4E00\u4E0B\u5C31\u628A\u8FD9\u4E2A\u90E8\u7F72\u5207\u5230\u53E6\u4E00\u4E2A\u7AEF\u70B9\uFF1B\u4E0B\u4E00\u6B21\u6A21\u578B\u8BF7\u6C42\u7ACB\u5373\u4F7F\u7528\u5B83\uFF0C\u4E0D\u7528\u91CD\u542F\u3002",
    refresh: "\u5237\u65B0",
    current: "\u5F53\u524D",
    switchTo: "\u5207\u5230",
    empty: "\u8FD9\u4E2A\u90E8\u7F72\u8FD8\u6CA1\u914D\u4EFB\u4F55\u7AEF\u70B9\u3002\u5148\u5728 WebUI \u7684\u300C\u6A21\u578B\u4F9B\u5E94\u5546\u300D\u9875\u5EFA\u4E00\u4E2A\u3002",
    loading: "\u8BFB\u53D6\u7AEF\u70B9\u6E05\u5355\u2026",
    switched: (name, model) => `\u5DF2\u5207\u5230 ${name}${model ? `\uFF08${model}\uFF09` : ""}\u3002\u4E0B\u4E00\u6B21\u6A21\u578B\u8BF7\u6C42\u5C31\u751F\u6548\u3002`,
    ready: "\u53EF\u7528",
    notReady: { "needs-setup": "\u5F85\u914D\u7F6E", invalid: "\u914D\u7F6E\u4E0D\u5408\u6CD5", "module-missing": "\u65B9\u8A00\u6CA1\u88C5", "runtime-unavailable": "\u8FD0\u884C\u65F6\u4E0D\u53EF\u7528" },
    failed: (message) => `\u5207\u6362\u5931\u8D25\uFF1A${message}`
  },
  en: {
    title: "Model providers",
    desc: "One click moves this deployment to another endpoint; the next model request uses it without a restart.",
    refresh: "Refresh",
    current: "active",
    switchTo: "Use",
    empty: 'No endpoints configured yet. Create one on the WebUI "Model providers" page first.',
    loading: "Reading endpoints\u2026",
    switched: (name, model) => `Switched to ${name}${model ? ` (${model})` : ""}. The next model request uses it.`,
    ready: "ready",
    notReady: { "needs-setup": "needs setup", invalid: "invalid", "module-missing": "module missing", "runtime-unavailable": "unavailable" },
    failed: (message) => `Switch failed: ${message}`
  }
};
var errorText = (error) => error instanceof Error ? error.message : String(error);
var panel = {
  mount(ctx) {
    const { ui, root } = ctx;
    const t = ctx.language.startsWith("zh") ? TEXT.zh : TEXT.en;
    let snapshot = null;
    let busy = false;
    const sheet = ui.sheet({ title: t.title, desc: t.desc });
    const bar = ui.rowbar();
    const refresh = ui.button(t.refresh, { size: "sm", onClick: () => void load() });
    const status = ui.msgline(t.loading);
    bar.append(refresh, status);
    const rows = ui.h("div", "rows");
    sheet.body.append(bar, rows);
    root.append(sheet.el);
    function readinessLabel(provider) {
      if (provider.readiness === "ready") return { text: t.ready, tone: "on" };
      return { text: t.notReady[provider.readiness] ?? provider.readiness, tone: "off" };
    }
    function renderRow(provider) {
      const row = ui.rowbar();
      const label = ui.h("span", "mono", provider.name);
      label.title = provider.reason || `${provider.module} / ${provider.model ?? "\u2014"}`;
      const model = ui.h("span", "grow", `${provider.module} \xB7 ${provider.model ?? "\u2014"}`);
      const state = readinessLabel(provider);
      row.append(label, model, ui.pill(state.text, state.tone));
      if (provider.active) {
        row.append(ui.pill(t.current, "on"));
      } else {
        const button = ui.button(t.switchTo, {
          size: "sm",
          variant: "primary",
          onClick: () => void activate(provider.name, button)
        });
        if (provider.readiness !== "ready") {
          button.disabled = true;
          button.title = provider.reason || state.text;
        }
        row.append(button);
      }
      return row;
    }
    function render(next) {
      snapshot = next;
      rows.replaceChildren(...next.providers.length ? next.providers.map(renderRow) : [ui.placeholder(t.empty)]);
      status.textContent = next.active ? "" : t.empty;
      status.className = "msgline";
    }
    async function load() {
      const off = ui.disable(refresh);
      status.textContent = t.loading;
      try {
        const next = await ctx.invoke("list");
        render(next);
        void ctx.refresh();
      } catch (error) {
        status.textContent = errorText(error);
        status.className = "msgline bad";
      }
      off.dispose();
    }
    async function activate(name, button) {
      if (busy) return;
      busy = true;
      const off = ui.disable(button);
      try {
        const next = await ctx.invoke("activate", [name]);
        render(next);
        const active = next.providers.find((p) => p.name === next.active);
        ui.toast(t.switched(next.active || name, active?.model ?? null), "ok");
        void ctx.refresh();
      } catch (error) {
        ui.toast(t.failed(errorText(error)), "bad");
        if (snapshot) render(snapshot);
      }
      off.dispose();
      busy = false;
    }
    void load();
  }
};
var bundle = {
  // 键是局部 panel id，与服务端 `webUi().panels[].id` 一一对应。
  panels: { hub: panel }
};
var client_default = bundle;
export {
  client_default as default
};
