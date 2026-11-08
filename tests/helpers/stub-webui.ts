/**
 * 假 WebUI：只实现 ProviderSwitch 用到的那几个路由（真实端口、真 HTTP、真 Cookie）。
 *
 * 路由形状照 `docs/webui.md` 的供应商接口，鉴权照 `src/web/server.ts` 的会话闸。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface StubEndpoint {
  name: string;
  module?: string;
  model?: string | null;
  readiness?: 'ready' | 'needs-setup' | 'invalid' | 'module-missing' | 'runtime-unavailable';
  reason?: string;
}

export interface StubWebUiOptions {
  providers: StubEndpoint[];
  /** 当前端点；缺省取第一个。 */
  active?: string;
  /** 设了就要求 `cortico_session` Cookie。 */
  password?: string;
}

export interface StubRequest {
  method: string;
  path: string;
  authorized: boolean;
}

const SESSION = 'stub-session-value';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class StubWebUi {
  port = 0;
  active: string;
  requests: StubRequest[] = [];
  private server: Server | null = null;

  constructor(private readonly options: StubWebUiOptions) {
    this.active = options.active ?? options.providers[0]?.name ?? '';
  }

  async start(): Promise<this> {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器没拿到端口');
    this.server = server;
    this.port = address.port;
    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** 某个路径被请求过几次。 */
  count(path: string, method?: string): number {
    return this.requests.filter((r) => r.path === path && (!method || r.method === method)).length;
  }

  private authorized(req: IncomingMessage): boolean {
    if (!this.options.password) return true;
    return (req.headers.cookie ?? '').includes(`cortico_session=${SESSION}`);
  }

  private payload(): { scope: string; active: string; providers: unknown[] } {
    return {
      scope: 'deployment',
      active: this.active,
      providers: this.options.providers.map((provider) => {
        const readiness = provider.readiness ?? 'ready';
        return {
          id: provider.name,
          name: provider.name,
          module: provider.module ?? 'openai-responses-compat',
          moduleTitle: 'OpenAI Responses 兼容',
          model: provider.model ?? 'some-model',
          baseUrl: `http://127.0.0.1:${this.port}/v1`,
          active: provider.name === this.active,
          readiness:
            readiness === 'ready'
              ? { state: 'ready' }
              : { state: readiness, reason: provider.reason ?? '还没配完' },
          revision: '1',
          usage: [],
        };
      }),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const authorized = this.authorized(req);
    this.requests.push({ method, path, authorized });

    const json = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(body));
    };

    if (path === '/api/auth/status') {
      json(200, { required: Boolean(this.options.password), authenticated: authorized });
      return;
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const body = await readJson(req);
      if (body.password !== this.options.password) {
        json(401, { error: '密码不对' });
        return;
      }
      json(200, { ok: true }, { 'set-cookie': `cortico_session=${SESSION}; Path=/; HttpOnly; SameSite=Lax` });
      return;
    }
    if (!authorized) {
      json(401, { error: '需要先登录' }, { 'x-cortico-auth': 'required' });
      return;
    }
    if (path === '/api/providers' && method === 'GET') {
      json(200, this.payload());
      return;
    }

    const activate = /^\/api\/providers\/([^/]+)\/activate$/.exec(path);
    if (activate && method === 'POST') {
      const name = decodeURIComponent(activate[1]);
      const provider = this.options.providers.find((item) => item.name === name);
      if (!provider) {
        json(404, { error: `没有叫「${name}」的端点` });
        return;
      }
      if ((provider.readiness ?? 'ready') !== 'ready') {
        json(400, { error: provider.reason ?? '这个端点还不能用' });
        return;
      }
      this.active = name;
      json(200, { ok: true });
      return;
    }

    json(404, { error: `测试服务器没有这个路由：${method} ${path}` });
  }
}
