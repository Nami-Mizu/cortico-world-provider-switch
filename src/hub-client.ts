/**
 * 本机 WebUI 的模型供应商接口客户端。
 *
 * WebUI 的 `POST /api/providers/:name/activate` 是唯一改写 `activeProvider` 的公开入口
 * （`src/providers/webui/hub.ts` 的 `ProviderHub.activate`）；World 进程内拿不到 `ProviderHub`，
 * 所以这里走回环 HTTP。读写都限定在 `<部署>/config.json` 能指到的那个本机实例上。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 端口写死时最多顺延几个候选（WebUI 自己在端口被占时也最多顺延 5 个）。 */
const PORT_ATTEMPTS = 5;
/** 读端口失败时的兜底值。 */
const FALLBACK_PORT = 7777;
/** 探测与登录用更短的超时：端口没开时不要卡住整轮对话。 */
const PROBE_TIMEOUT_MS = 1200;

export interface ProviderSwitchProvider {
  /** 端点名，即 `<部署>/providers/<名字>/` 的目录名。 */
  name: string;
  /** 供应商方言，如 `openai-responses-compat`。 */
  module: string;
  /** 方言的界面标题。 */
  moduleTitle: string;
  /** 端点配置里的模型名；没配时为 null。 */
  model: string | null;
  /** 是否为当前端点。 */
  active: boolean;
  /** `ready` 或 `invalid` / `needs-setup` / `module-missing` / `runtime-unavailable`。 */
  readiness: string;
  /** 不可用的原因，可用时为空串。 */
  reason: string;
}

export interface ProviderSwitchSnapshot {
  /** 当前端点名；一个都没配时为空串。 */
  active: string;
  providers: ProviderSwitchProvider[];
}

export interface ProviderSwitchClientOptions {
  /** 这个 World 所属的部署目录，`config.json` 与 `.env` 都在这里。 */
  botDir: string;
  /** 配置里的端口；0 或缺省表示现读部署配置。 */
  port?: number;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
}

interface RawProvider {
  name?: unknown;
  module?: unknown;
  moduleTitle?: unknown;
  model?: unknown;
  active?: unknown;
  readiness?: { state?: unknown; reason?: unknown } | unknown;
}

interface RawList {
  active?: unknown;
  providers?: unknown;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 从 `<部署>/.env` 里取一个键；文件不存在或读不出就当没有。 */
function readDotEnv(botDir: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const text = readFileSync(join(botDir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) map.set(key, value);
    }
  } catch {
    // 没有 .env 是正常情况。
  }
  return map;
}

function readConfigJson(botDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(botDir, 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class ProviderSwitchClient {
  private base: string | null = null;
  private cookie: string | null = null;
  private timeoutMs: number;

  constructor(private readonly opts: ProviderSwitchClientOptions) {
    this.timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 4000;
  }

  /** 当前端点与全部端点；读不到时抛带成因的错误。 */
  async list(): Promise<ProviderSwitchSnapshot> {
    const raw = await this.request<RawList>('GET', '/api/providers');
    return normalize(raw);
  }

  /** 切到指定端点，返回切换后的快照。 */
  async activate(name: string): Promise<ProviderSwitchSnapshot> {
    const target = name.trim();
    if (!target) throw new Error('端点名不能为空。');
    await this.request('POST', `/api/providers/${encodeURIComponent(target)}/activate`, {});
    return this.list();
  }

  // ------------------------------------------------------------------ 发现与鉴权

  private async baseUrl(): Promise<string> {
    if (this.base) return this.base;
    const candidates = this.portCandidates();
    let lastError: unknown;
    for (const port of candidates) {
      const base = `http://127.0.0.1:${port}`;
      let status: { required: boolean; authenticated: boolean };
      try {
        status = await this.probe(base);
      } catch (error) {
        // 这个端口上没有 WebUI：换下一个候选。
        lastError = error;
        continue;
      }
      // 端口上有 WebUI：鉴权失败就直接说清楚，不要伪装成「端口连不上」。
      if (status.required && !status.authenticated) await this.login(base);
      this.base = base;
      return base;
    }
    const ports = candidates.join('、');
    throw new Error(
      `连不上本机 WebUI（试过端口 ${ports}）。请确认这个部署的 WebUI 正在运行；` +
        `或把 worlds.providerswitch.webPort 设成实际端口。` +
        (lastError instanceof Error ? ` 最后一次错误：${lastError.message}` : ''),
    );
  }

  private portCandidates(): number[] {
    const fromCfg = readConfigJson(this.opts.botDir);
    const web = fromCfg.web;
    const diskPort =
      web && typeof web === 'object' && typeof (web as { port?: unknown }).port === 'number'
        ? (web as { port: number }).port
        : NaN;
    const configured = this.opts.port && this.opts.port > 0 ? this.opts.port : 0;
    const start = configured || (Number.isFinite(diskPort) && diskPort > 0 ? diskPort : FALLBACK_PORT);
    const out: number[] = [];
    for (let i = 0; i < PORT_ATTEMPTS; i++) {
      const port = start + i;
      if (port > 0 && port <= 65535) out.push(port);
    }
    return out;
  }

  private async probe(base: string): Promise<{ required: boolean; authenticated: boolean }> {
    const response = await fetch(`${base}/api/auth/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`/api/auth/status 返回 ${response.status}`);
    const body = (await response.json()) as { required?: unknown; authenticated?: unknown };
    return { required: body.required === true, authenticated: body.authenticated === true };
  }

  /** WebUI 设了访问密码时，用部署的密钥环境登录一次。 */
  private async login(base: string): Promise<void> {
    const password = this.findPassword();
    if (!password) {
      throw new Error(
        'WebUI 需要访问密码，但没找到 CORTICO_WEB_PASSWORD：' +
          '把它放进这个 bot 进程的环境或部署目录的 .env（或写到 config.json 的 web.password）。',
      );
    }
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = await describeFailure(response);
      throw new Error(`登录本机 WebUI 失败：${detail}`);
    }
    const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '';
    const pair = cookie.split(';')[0]?.trim() ?? '';
    if (!pair.includes('=')) throw new Error('登录成功但没拿到会话 Cookie。');
    this.cookie = pair;
  }

  private findPassword(): string {
    const fromEnv = process.env.CORTICO_WEB_PASSWORD;
    if (fromEnv) return fromEnv;
    const fromDotEnv = readDotEnv(this.opts.botDir).get('CORTICO_WEB_PASSWORD');
    if (fromDotEnv) return fromDotEnv;
    const web = readConfigJson(this.opts.botDir).web;
    if (web && typeof web === 'object' && typeof (web as { password?: unknown }).password === 'string') {
      return (web as { password: string }).password;
    }
    return '';
  }

  // ------------------------------------------------------------------ HTTP

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const base = await this.baseUrl();
    const send = async (): Promise<Response> =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          // 同源闸门只拦「别的站点的 Origin」；从本机进程发请求时不带 Origin 也能过，
          // 但写请求带上本页面的 Origin 更贴近浏览器行为。
          origin: base,
          ...(this.cookie ? { cookie: this.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

    let response = await send();
    if (response.status === 401 && this.cookie) {
      // 会话过期：重登一次再试。
      this.cookie = null;
      await this.login(base);
      response = await send();
    }
    if (!response.ok) throw new Error(await describeFailure(response));
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') detail = body.error;
  } catch {
    // 不是 JSON 就用状态码。
  }
  return detail ? `${detail}（HTTP ${response.status}）` : `HTTP ${response.status} ${response.statusText}`.trim();
}

function normalize(raw: RawList): ProviderSwitchSnapshot {
  const list = Array.isArray(raw.providers) ? (raw.providers as RawProvider[]) : [];
  const providers = list.map((item) => {
    const readiness = item.readiness;
    const state =
      readiness && typeof readiness === 'object' && typeof (readiness as { state?: unknown }).state === 'string'
        ? (readiness as { state: string }).state
        : 'unknown';
    const reason =
      readiness && typeof readiness === 'object' && typeof (readiness as { reason?: unknown }).reason === 'string'
        ? (readiness as { reason: string }).reason
        : '';
    return {
      name: asString(item.name),
      module: asString(item.module),
      moduleTitle: asString(item.moduleTitle),
      model: typeof item.model === 'string' ? item.model : null,
      active: item.active === true,
      readiness: state,
      reason,
    };
  });
  const active = asString(raw.active) || providers.find((p) => p.active)?.name || '';
  return { active, providers };
}
