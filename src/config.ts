import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 `worlds.providerswitch` 段；默认禁用，由 bot 的 declares 或部署启用。 */
export interface ProviderSwitchConfigSection {
  enabled: boolean;
  /**
   * 本部署 WebUI 的端口。0 表示从 `<部署>/config.json` 的 `web.port` 现读；
   * 两者都给不出可用端口时按 7777 起顺延探测。
   */
  webPort: number;
  /** 单次请求的超时（毫秒）。本机回环请求，留宽一点足够。 */
  timeoutMs: number;
}

export const PROVIDER_SWITCH_DEFAULTS: ProviderSwitchConfigSection = {
  enabled: false,
  webPort: 0,
  timeoutMs: 4000,
};

/** World 配置的 JSON Schema 声明。 */
export const PROVIDER_SWITCH_CONFIG_GROUP: ConfigGroup = {
  id: 'world:providerswitch',
  owner: 'world:providerswitch',
  schema: {
    type: 'object',
    title: 'ProviderSwitch',
    properties: {
      'worlds.providerswitch.webPort': {
        type: 'number',
        title: 'WebUI 端口',
        description: '本部署 WebUI 的端口；0 表示从部署的 config.json 读 web.port。',
        'x-hot': true,
      },
      'worlds.providerswitch.timeoutMs': {
        type: 'number',
        title: '请求超时',
        description: '每次请求本机 WebUI 的超时（毫秒）。',
        'x-hot': true,
      },
    },
  },
};
