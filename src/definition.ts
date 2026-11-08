import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { PROVIDER_SWITCH_DEFAULTS, type ProviderSwitchConfigSection } from './config.ts';
import { PROVIDER_SWITCH_TOOL_DECLS, ProviderSwitchWorld } from './world.ts';

export const PROVIDER_SWITCH: WorldDefinition<ProviderSwitchConfigSection> = {
  id: 'providerswitch',
  label: 'ProviderSwitch',
  defaults: () => ({ ...PROVIDER_SWITCH_DEFAULTS }),
  // `ctx.cfg` 是 `worlds.providerswitch` 的活引用：热改的键现读即生效。
  create: (ctx) => new ProviderSwitchWorld({ cfg: ctx.cfg, timezone: ctx.timezone, botDir: ctx.botDir }),
  // 自描述：可能出现的全部工具与会推出去的全体事件，不进提示词。
  describe: {
    tools: describeTools(PROVIDER_SWITCH_TOOL_DECLS, {
      provider_switch_list: {
        zh: '列出本部署的模型供应商端点，标出当前那一个。',
        en: "Lists this deployment's model provider endpoints and marks the active one.",
      },
      provider_switch_use: {
        zh: '切到另一个模型供应商端点；下一次模型请求立即生效，不用重启。',
        en: 'Switches this deployment to another model provider endpoint; the next model request uses it, no restart.',
      },
    }),
    events: [
      {
        type: 'providerswitch.started',
        description: { zh: 'World 挂载完成。', en: 'The World was mounted.' },
      },
      {
        type: 'providerswitch.switched',
        description: {
          zh: '模型供应商端点被切换（面板或工具）。',
          en: 'The model provider endpoint was switched, from the panel or by a tool call.',
        },
      },
    ],
  },
};
