/**
 * ProviderSwitch 的「模型供应商」面板：一点切换本部署的 activeProvider。
 *
 * 只经 `ctx.invoke` 调 World 声明的 `hub` 面板方法，不直接碰任何 HTTP 接口 ——
 * 鉴权、端口发现与错误话术都在服务端那一份实现里。
 */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

interface PanelProvider {
  name: string;
  module: string;
  moduleTitle: string;
  model: string | null;
  active: boolean;
  readiness: string;
  reason: string;
}

interface PanelSnapshot {
  active: string;
  providers: PanelProvider[];
}

const TEXT = {
  zh: {
    title: '模型供应商',
    desc: '点一下就把这个部署切到另一个端点；下一次模型请求立即使用它，不用重启。',
    refresh: '刷新',
    current: '当前',
    switchTo: '切到',
    empty: '这个部署还没配任何端点。先在 WebUI 的「模型供应商」页建一个。',
    loading: '读取端点清单…',
    switched: (name: string, model: string | null) => `已切到 ${name}${model ? `（${model}）` : ''}。下一次模型请求就生效。`,
    ready: '可用',
    notReady: { 'needs-setup': '待配置', invalid: '配置不合法', 'module-missing': '方言没装', 'runtime-unavailable': '运行时不可用' } as Record<string, string>,
    failed: (message: string) => `切换失败：${message}`,
  },
  en: {
    title: 'Model providers',
    desc: 'One click moves this deployment to another endpoint; the next model request uses it without a restart.',
    refresh: 'Refresh',
    current: 'active',
    switchTo: 'Use',
    empty: 'No endpoints configured yet. Create one on the WebUI "Model providers" page first.',
    loading: 'Reading endpoints…',
    switched: (name: string, model: string | null) => `Switched to ${name}${model ? ` (${model})` : ''}. The next model request uses it.`,
    ready: 'ready',
    notReady: { 'needs-setup': 'needs setup', invalid: 'invalid', 'module-missing': 'module missing', 'runtime-unavailable': 'unavailable' } as Record<string, string>,
    failed: (message: string) => `Switch failed: ${message}`,
  },
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const panel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui, root } = ctx;
    const t = ctx.language.startsWith('zh') ? TEXT.zh : TEXT.en;
    let snapshot: PanelSnapshot | null = null;
    let busy = false;

    const sheet = ui.sheet({ title: t.title, desc: t.desc });
    const bar = ui.rowbar();
    const refresh = ui.button(t.refresh, { size: 'sm', onClick: () => void load() });
    const status = ui.msgline(t.loading);
    bar.append(refresh, status);
    const rows = ui.h('div', 'rows');
    sheet.body.append(bar, rows);
    root.append(sheet.el);

    function readinessLabel(provider: PanelProvider): { text: string; tone: 'on' | 'off' | 'plain' } {
      if (provider.readiness === 'ready') return { text: t.ready, tone: 'on' };
      return { text: t.notReady[provider.readiness] ?? provider.readiness, tone: 'off' };
    }

    function renderRow(provider: PanelProvider): HTMLElement {
      const row = ui.rowbar();
      const label = ui.h('span', 'mono', provider.name);
      label.title = provider.reason || `${provider.module} / ${provider.model ?? '—'}`;
      const model = ui.h('span', 'grow', `${provider.module} · ${provider.model ?? '—'}`);
      const state = readinessLabel(provider);
      row.append(label, model, ui.pill(state.text, state.tone));

      if (provider.active) {
        row.append(ui.pill(t.current, 'on'));
      } else {
        const button = ui.button(t.switchTo, {
          size: 'sm',
          variant: 'primary',
          onClick: () => void activate(provider.name, button),
        });
        if (provider.readiness !== 'ready') {
          button.disabled = true;
          button.title = provider.reason || state.text;
        }
        row.append(button);
      }
      return row;
    }

    function render(next: PanelSnapshot): void {
      snapshot = next;
      rows.replaceChildren(...(next.providers.length ? next.providers.map(renderRow) : [ui.placeholder(t.empty)]));
      status.textContent = next.active ? '' : t.empty;
      status.className = 'msgline';
    }

    async function load(): Promise<void> {
      const off = ui.disable(refresh);
      status.textContent = t.loading;
      try {
        const next = await ctx.invoke<PanelSnapshot>('list');
        render(next);
        void ctx.refresh();
      } catch (error) {
        status.textContent = errorText(error);
        status.className = 'msgline bad';
      }
      off.dispose();
    }

    async function activate(name: string, button: HTMLButtonElement): Promise<void> {
      if (busy) return;
      busy = true;
      const off = ui.disable(button);
      try {
        const next = await ctx.invoke<PanelSnapshot>('activate', [name]);
        render(next);
        const active = next.providers.find((p) => p.name === next.active);
        ui.toast(t.switched(next.active || name, active?.model ?? null), 'ok');
        void ctx.refresh();
      } catch (error) {
        ui.toast(t.failed(errorText(error)), 'bad');
        if (snapshot) render(snapshot);
      }
      off.dispose();
      busy = false;
    }

    void load();
  },
};

const bundle: WebUiClientBundle = {
  // 键是局部 panel id，与服务端 `webUi().panels[].id` 一一对应。
  panels: { hub: panel },
};

export default bundle;
