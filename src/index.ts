/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { PROVIDER_SWITCH } from './definition.ts';

export default PROVIDER_SWITCH;
export { PROVIDER_SWITCH };
export type { ProviderSwitchConfigSection } from './config.ts';
