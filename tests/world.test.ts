import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolOutcome } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { PROVIDER_SWITCH } from '../src/index.ts';
import { PROVIDER_SWITCH_DEFAULTS } from '../src/config.ts';
import { ProviderSwitchWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { StubWebUi } from './helpers/stub-webui.ts';

let scratchDir: string;
let stub: StubWebUi | null = null;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'provider-switch-'));
});

afterEach(async () => {
  await stub?.stop();
  stub = null;
  rmSync(scratchDir, { recursive: true, force: true });
});

const textOf = (outcome: string | ToolOutcome): string => (typeof outcome === 'string' ? outcome : outcome.text);
const failedOf = (outcome: string | ToolOutcome): boolean => typeof outcome !== 'string' && outcome.failed === true;
const call = {} as ToolCallContext;

function makeWorld(overrides: Partial<typeof PROVIDER_SWITCH_DEFAULTS> = { webPort: 0 }) {
  const botDir = join(scratchDir, 'deployment');
  mkdirSync(botDir, { recursive: true });
  const world = new ProviderSwitchWorld({
    cfg: { ...PROVIDER_SWITCH_DEFAULTS, ...overrides },
    timezone: 'Asia/Shanghai',
    botDir,
  });
  return { world, botDir };
}

async function startStub(options: ConstructorParameters<typeof StubWebUi>[0]): Promise<StubWebUi> {
  stub = await new StubWebUi(options).start();
  return stub;
}

const TWO_ENDPOINTS = {
  providers: [
    { name: 'flash', module: 'openai-responses-compat', model: 'deepseek-v4-flash' },
    { name: 'v4pro', module: 'openai-responses-compat', model: 'deepseek-v4-pro' },
  ],
  active: 'flash',
};

describe('ProviderSwitch 的装配契约', () => {
  it('dry mount 不报失败', async () => {
    const report = await dryMountWorld(PROVIDER_SWITCH, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('默认配置下能构造，并且默认不启用', () => {
    const ctx = fakeWorldContext(PROVIDER_SWITCH, { scratchDir });
    expect(PROVIDER_SWITCH.defaults().enabled).toBe(false);
    expect(ctx.cfg).toEqual(PROVIDER_SWITCH_DEFAULTS);
    expect(PROVIDER_SWITCH.create(ctx).id).toBe('providerswitch');
  });

  it('面板 id 落在 [a-z0-9-]，与 webUiClient 的 bundle 键一致', () => {
    const { world } = makeWorld();
    const webUi = world.webUi('zh');
    expect(webUi.panels?.map((panel) => panel.id)).toEqual(['hub']);
    for (const panel of webUi.panels ?? []) expect(panel.id).toMatch(/^[a-z0-9-]+$/);
    expect(webUi.promptDocs?.[0]?.role).toBe('envPrompt');
  });
});

describe('ProviderSwitch 的工具', () => {
  it('provider_switch_list 报出当前端点与全部端点', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });

    const list = world.tools().find((tool) => tool.name === 'provider_switch_list')!;
    const text = textOf(await list.handler({}, call));

    expect(text).toContain('当前端点：flash');
    expect(text).toContain('flash（openai-responses-compat / deepseek-v4-flash） ← 当前');
    expect(text).toContain('v4pro（openai-responses-compat / deepseek-v4-pro）');
  });

  it('provider_switch_use 切换端点、返回新快照、推一条 switched 事件', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });
    const host = new FakeHost();
    await world.start(host);

    const use = world.tools().find((tool) => tool.name === 'provider_switch_use')!;
    const text = textOf(await use.handler({ name: 'v4pro' }, call));

    expect(text).toContain('已切到端点「v4pro」');
    expect(text).toContain('deepseek-v4-pro');
    expect(site.active).toBe('v4pro');
    expect(host.events.map((event) => event.type)).toEqual(['providerswitch.started', 'providerswitch.switched']);
    expect(host.events[1].text).toContain('「v4pro」');
    // 切换后环境提示词里的当前端点跟着变。
    expect(world.envPromptVars()['providerswitch.active']).toBe('v4pro（deepseek-v4-pro）');
    await world.stop();
  });

  it('端点名不存在时返回 failed，并把服务端的话带回来', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });

    const use = world.tools().find((tool) => tool.name === 'provider_switch_use')!;
    const outcome = await use.handler({ name: 'nope' }, call);

    expect(failedOf(outcome)).toBe(true);
    expect(textOf(outcome)).toContain('没有叫「nope」的端点');
    expect(textOf(outcome)).toContain('HTTP 404');
    expect(site.active).toBe('flash');
  });

  it('端点没配完时拒绝切换，回执里说明原因', async () => {
    const site = await startStub({
      providers: [
        { name: 'flash', model: 'deepseek-v4-flash' },
        { name: 'half', readiness: 'needs-setup', reason: '还没填模型' },
      ],
      active: 'flash',
    });
    const { world } = makeWorld({ webPort: site.port });

    const use = world.tools().find((tool) => tool.name === 'provider_switch_use')!;
    const outcome = await use.handler({ name: 'half' }, call);

    expect(failedOf(outcome)).toBe(true);
    expect(textOf(outcome)).toContain('还没填模型');
    expect(site.active).toBe('flash');
  });

  it('缺 name 参数时直接回 failed，不发请求', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });

    const use = world.tools().find((tool) => tool.name === 'provider_switch_use')!;
    const outcome = await use.handler({ name: '  ' }, call);

    expect(failedOf(outcome)).toBe(true);
    expect(textOf(outcome)).toContain('name 参数不能为空');
    expect(site.requests).toEqual([]);
  });
});

describe('ProviderSwitch 找 WebUI 的方式', () => {
  it('webPort 配 0 时读部署 config.json 的 web.port', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world, botDir } = makeWorld({ webPort: 0 });
    writeFileSync(join(botDir, 'config.json'), JSON.stringify({ web: { port: site.port }, activeProvider: 'flash' }));

    const list = world.tools().find((tool) => tool.name === 'provider_switch_list')!;
    expect(textOf(await list.handler({}, call))).toContain('当前端点：flash');
  });

  it('WebUI 设了密码时用部署 .env 里的 CORTICO_WEB_PASSWORD 登录一次', async () => {
    const site = await startStub({ ...TWO_ENDPOINTS, password: 'letmein' });
    const { world, botDir } = makeWorld({ webPort: site.port });
    writeFileSync(join(botDir, '.env'), 'CORTICO_WEB_PASSWORD=letmein\n');

    const list = world.tools().find((tool) => tool.name === 'provider_switch_list')!;
    expect(textOf(await list.handler({}, call))).toContain('当前端点：flash');
    expect(site.count('/api/auth/login', 'POST')).toBe(1);
    // 登录后的读请求带着会话。
    const reads = site.requests.filter((request) => request.path === '/api/providers');
    expect(reads.at(-1)?.authorized).toBe(true);
  });

  it('端口都连不上时回 failed 并说明试过哪些端口', async () => {
    const { world } = makeWorld({ webPort: 1 });
    const list = world.tools().find((tool) => tool.name === 'provider_switch_list')!;
    const outcome = await list.handler({}, call);

    expect(failedOf(outcome)).toBe(true);
    expect(textOf(outcome)).toContain('连不上本机 WebUI');
    expect(textOf(outcome)).toContain('试过端口 1、2、3、4、5');
  });
});

describe('ProviderSwitch 的面板', () => {
  it('hub 面板的 list 返回面板要的形状', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });
    const webUi = world.webUi('zh');

    const snapshot = (await webUi.invoke!('hub', 'list', [])) as {
      active: string;
      providers: Array<{ name: string; readiness: string; reason: string }>;
    };

    expect(snapshot.active).toBe('flash');
    expect(snapshot.providers.map((provider) => provider.name)).toEqual(['flash', 'v4pro']);
    expect(snapshot.providers[0].readiness).toBe('ready');
    expect(snapshot.providers[0].reason).toBe('');
  });

  it('hub 面板的 activate 切换端点并推事件', async () => {
    const site = await startStub(TWO_ENDPOINTS);
    const { world } = makeWorld({ webPort: site.port });
    const host = new FakeHost();
    await world.start(host);

    const snapshot = (await world.webUi('zh').invoke!('hub', 'activate', ['v4pro'])) as { active: string };

    expect(snapshot.active).toBe('v4pro');
    expect(site.active).toBe('v4pro');
    expect(host.events.map((event) => event.type)).toEqual(['providerswitch.started', 'providerswitch.switched']);
    expect(host.events[1].text).toContain('操作员');
    await world.stop();
  });

  it('未知面板或未知方法直接抛错', async () => {
    const { world } = makeWorld();
    const webUi = world.webUi('zh');
    await expect(webUi.invoke!('other', 'list', [])).rejects.toThrow('未知面板');
    await expect(webUi.invoke!('hub', 'nope', [])).rejects.toThrow('未知面板方法');
  });
});
