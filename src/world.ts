/**
 * ProviderSwitch：把「切到另一个模型供应商端点」做成一次点击与一次工具调用。
 *
 * 切换动作本身由本机 WebUI 的 `POST /api/providers/:name/activate` 完成；World 只负责
 * 找到那个 WebUI、带上鉴权、把结果讲清楚。`activeProvider` 由 Core 在每次模型请求前现读，
 * 所以切换对下一次请求立即生效，不需要重启。
 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { Language } from 'cortico/core/language.ts';
import { PROVIDER_SWITCH_CONFIG_GROUP, type ProviderSwitchConfigSection } from './config.ts';
import { ProviderSwitchClient, type ProviderSwitchSnapshot } from './hub-client.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export interface ProviderSwitchWorldOptions {
  /** `worlds.providerswitch` 的活引用。 */
  cfg: ProviderSwitchConfigSection;
  timezone: string;
  /** 这个 World 所属的部署目录。 */
  botDir: string;
}

/** 全部工具的声音：定义里的 describe 与 `tools()` 都取它。 */
export const PROVIDER_SWITCH_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'provider_switch_list',
    description:
      'List this bot\'s model provider endpoints and mark the active one. Read-only: use it before switching, or when the operator asks which model you are running on.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'provider_switch_use',
    description:
      'Switch this bot to another model provider endpoint. The change applies to the next model request without restarting. Only switch when asked to, or when you have a concrete reason the current endpoint cannot continue.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Endpoint name exactly as provider_switch_list reported it (the folder name under <deployment>/providers/).',
        },
      },
      required: ['name'],
    },
  },
];

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const ENDPOINT_DESCRIPTION: Record<string, string> = {
  ready: '可用',
  'needs-setup': '还没配完（缺模型或密钥）',
  invalid: '配置不合法',
  'module-missing': '供应商方言没装',
  'runtime-unavailable': '运行时不可用',
  unknown: '状态未知',
};

export class ProviderSwitchWorld implements World {
  readonly id = 'providerswitch';

  private host: WorldHost | null = null;
  private snapshot: ProviderSwitchSnapshot | null = null;
  private cached: { port: number; timeoutMs: number; client: ProviderSwitchClient } | null = null;

  constructor(private readonly opts: ProviderSwitchWorldOptions) {}

  /** 只报值：前缀文本一律来自 ENV_PROMPT.md 模板。 */
  envPromptVars(): Record<string, string> {
    const snapshot = this.snapshot;
    const active = snapshot?.providers.find((p) => p.name === snapshot.active) ?? null;
    return {
      'providerswitch.active': active
        ? `${active.name}（${active.model ?? '未配置模型'}）`
        : '还没读过；调用 provider_switch_list 可以查',
      'providerswitch.endpoints': snapshot
        ? snapshot.providers.map((p) => `${p.name}${p.active ? '（当前）' : `[${ENDPOINT_DESCRIPTION[p.readiness] ?? p.readiness}]`}`).join('、') || '一个端点都没配'
        : '还没读过',
    };
  }

  tools(): ToolDef[] {
    return [this.listTool(), this.useTool()];
  }

  webUi(_language?: Language): WorldWebUiDecl {
    const snapshot = this.snapshot;
    return {
      label: '模型供应商',
      badges: [
        {
          label: '当前端点',
          value: snapshot?.active || '—',
          tone: snapshot ? 'on' : 'plain',
        },
      ],
      config: [PROVIDER_SWITCH_CONFIG_GROUP],
      panels: [
        {
          id: 'hub',
          title: '模型供应商',
          description: '点一下就把这个部署切到另一个端点；下一次模型请求立即使用它，不用重启。',
        },
      ],
      invoke: async (panel, method, args) => {
        if (panel !== 'hub') throw new Error(`未知面板：${panel}`);
        return this.invoke(method, args);
      },
      promptDocs: [
        {
          key: 'worlds.providerswitch.envPrompt',
          title: 'ProviderSwitch · 环境提示词',
          description: '告诉模型这个部署现在跑在哪个端点上、怎么切换。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'providerswitch.active', description: '当前端点与模型；还没读过端点清单时是一句提示。' },
            { name: 'providerswitch.endpoints', description: '全部端点，当前的那个带「（当前）」标注。' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await host.pushEvent({
      type: 'providerswitch.started',
      ts: nowIso(this.opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: 'ProviderSwitch 已挂载：面板可一点切换模型供应商端点，provider_switch_list / provider_switch_use 两个工具可用。',
    });
    // 先读一次端点表，环境提示词的第一行就不必等到第一次工具调用。
    try {
      this.remember(await this.client().list());
    } catch {
      // WebUI 还没起来是正常情况，工具调用时再报。
    }
  }

  async stop(): Promise<void> {
    this.host = null;
  }

  // ------------------------------------------------------------------ 面板

  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'list') return this.remember(await this.client().list());
    if (method === 'activate') {
      const name = typeof args[0] === 'string' ? args[0].trim() : '';
      if (!name) throw new Error('端点名不能为空。');
      const snapshot = this.remember(await this.client().activate(name));
      await this.announce(snapshot, name, 'panel');
      return snapshot;
    }
    throw new Error(`未知面板方法：${method}`);
  }

  // ------------------------------------------------------------------ 工具

  private listTool(): ToolDef {
    return {
      ...PROVIDER_SWITCH_TOOL_DECLS[0],
      handler: async (): Promise<ToolOutcome> => {
        try {
          return { text: formatSnapshot(this.remember(await this.client().list())) };
        } catch (error) {
          return { text: `读不到本机 WebUI 的端点清单：${message(error)}`, failed: true };
        }
      },
    };
  }

  private useTool(): ToolDef {
    return {
      ...PROVIDER_SWITCH_TOOL_DECLS[1],
      handler: async (args): Promise<ToolOutcome> => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return { text: 'name 参数不能为空：先用 provider_switch_list 看清单，再传端点名。', failed: true };
        try {
          const snapshot = this.remember(await this.client().activate(name));
          await this.announce(snapshot, name, 'tool');
          const active = snapshot.providers.find((p) => p.name === snapshot.active);
          return {
            text:
              `已切到端点「${snapshot.active || name}」` +
              (active?.model ? `（模型 ${active.model}，${active.module}）` : '') +
              '。下一次模型请求就用它，不用重启。',
          };
        } catch (error) {
          return { text: `切换失败：${message(error)}`, failed: true };
        }
      },
    };
  }

  // ------------------------------------------------------------------ 状态与事件

  private remember(snapshot: ProviderSwitchSnapshot): ProviderSwitchSnapshot {
    this.snapshot = snapshot;
    return snapshot;
  }

  private client(): ProviderSwitchClient {
    const port = this.opts.cfg.webPort ?? 0;
    const timeoutMs = this.opts.cfg.timeoutMs ?? 0;
    if (this.cached && this.cached.port === port && this.cached.timeoutMs === timeoutMs) return this.cached.client;
    const client = new ProviderSwitchClient({ botDir: this.opts.botDir, port, timeoutMs });
    this.cached = { port, timeoutMs, client };
    return client;
  }

  /** 切换成功后往时间线推一条事件；推不出去不影响切换本身。 */
  private async announce(snapshot: ProviderSwitchSnapshot, name: string, from: 'panel' | 'tool'): Promise<void> {
    const host = this.host;
    if (!host) return;
    const active = snapshot.providers.find((p) => p.name === snapshot.active);
    try {
      await host.pushEvent({
        type: 'providerswitch.switched',
        ts: nowIso(this.opts.timezone),
        source: this.id,
        origin: 'internal',
        senderKey: this.id,
        text:
          `${from === 'panel' ? '操作员' : '模型'}把模型供应商端点切到了「${snapshot.active || name}」` +
          (active?.model ? `（${active.model}）` : '') +
          '，下一次模型请求即生效。',
      });
    } catch {
      // 事件推送失败不改变「已经切好了」这个事实。
    }
  }
}

export function formatSnapshot(snapshot: ProviderSwitchSnapshot): string {
  if (!snapshot.providers.length) {
    return '这个部署还没配任何模型供应商端点：先在 WebUI 的「模型供应商」页建一个，再回来切。';
  }
  const lines = [`当前端点：${snapshot.active || '（没有）'}`];
  for (const provider of snapshot.providers) {
    const marks = [
      provider.active ? '← 当前' : '',
      provider.readiness === 'ready' ? '' : ENDPOINT_DESCRIPTION[provider.readiness] ?? provider.readiness,
      provider.reason ? provider.reason : '',
    ].filter(Boolean);
    lines.push(
      `- ${provider.name}（${provider.module} / ${provider.model ?? '未配模型'}）` +
        (marks.length ? ` ${marks.join('；')}` : ''),
    );
  }
  return lines.join('\n');
}
