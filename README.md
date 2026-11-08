# cortico-world-provider-switch

Nami-Mizu（涟想时雨）& DeepSeek · MIT

把「换一个模型供应商端点」变成面板上的一次点击，同一个动作再包成两个工具交给模型自己调用。

切换由本机 WebUI 的 `POST /api/providers/:name/activate` 完成；Core 在每次模型请求前现读 `activeProvider`，
所以切完的下一次请求就用新端点，**不需要重启**。

## 前提

- 这个 bot 的 WebUI 在跑（默认 `http://127.0.0.1:7777`）。World 走回环 HTTP 找它。
- 部署里启用本 World：`worlds.providerswitch.enabled` 为 `true`（WebUI 的 World 页有开关），保存后重启一次。
- 端口不是 7777 时，把 `worlds.providerswitch.webPort` 设成实际端口；留 `0` 表示现读 `<部署>/config.json` 里的 `web.port`。

## 安装

1. 打开这个部署的 WebUI →「扩展」→ 安装方式选本机目录 → 选中这个包的目录（以 link 方式装入）→ 安装。
2. 重启 bot，「扩展」页应显示这个包已加载、World 总览多一张 ProviderSwitch 卡片。
3. 在 World 页把 ProviderSwitch 打开，再重启一次，工具与面板才挂上。
4. 想少点两下：把 `#/provider/world:providerswitch/hub` 加进书签，打开就是面板。

命令行等价做法（在这个部署的 `extensions/` 目录里）：

```sh
pnpm add <这个包的目录>
```

## 用法

面板「模型供应商」：每行一个端点，当前那个标「当前」，其余行有「切到」按钮；端点不可用（`needs-setup` /
`invalid` / `module-missing` / `runtime-unavailable`）时按钮置灰，悬停显示原因。切完页面徽章与提示同步更新，
时间线上出现一条 `providerswitch.switched`。

工具：

- `provider_switch_list`：只读，报当前端点与全部端点及其状态。
- `provider_switch_use`：参数 `name` 为端点名（`<部署>/providers/` 下的目录名），切过去并报新端点。

环境提示词里带着当前端点与端点清单，模型每轮都能看见自己在哪个端点上，不需要先调工具才知道。

## 密码

WebUI 设了访问密码时，把 `CORTICO_WEB_PASSWORD` 写进这个部署的 `.env`（进程环境里也行）。客户端会先
`POST /api/auth/login` 换 `cortico_session` Cookie，只在内存里用，不落盘。没找到密码时回执会说清楚缺什么。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `worlds.providerswitch.webPort` | `0` | 本机 WebUI 端口；`0` = 现读部署 `config.json` 的 `web.port` |
| `worlds.providerswitch.timeoutMs` | `4000` | 单次 HTTP 请求超时（毫秒） |

## 边界

- 只访问回环地址上的 `/api/providers` 与 `/api/auth/*` 这几条公开接口；不改端点配置、不建端点、不碰别的部署的 `config.json`。
- 端口探测从配置端口起顺延 5 个候选，与 WebUI 自己在端口被占时顺延的个数一致；都不通时回执列出试过的端口。
- 与内置的「设为当前」一样，切换不检查别的部署是否正在用这个端点（那是界面自己置灰的事）。
- fork 在创建时固定端点，切换只影响之后的主 session 请求，不改已 fork 的会话。
- 切换失败不会静默：工具回执与面板 toast 都带服务端的原话与状态码。
- 改了包里的文件（尤其是 `package.json` 的版本号）之后，扩展页与 World 卡片会显示「待生效」：框架拿启动时的
  加载结果和磁盘上的版本比对，不一致就提示。这是安装状态，不是切换失败；重启一次进程即消失。用本机目录
  方式安装时磁盘上的版本是实时读的，所以手改版本号会立刻出现这个提示。

**进官方索引**：扩展市场的标签、徽标、评论与截图来自索引仓
[Pal-AI-Lab/cortico-extensions](https://github.com/Pal-AI-Lab/cortico-extensions)，文件格式以那里的 `DESIGN.md`
为准，标签词表与贴法见 `TAGS.md`。要进市场得向那个仓提 PR（`index.json` / `catalog.json` / `packages/<包名>.json`），
由运营方合并；`official` 徽标要求 npm 维护者里有运营方名单中的账号、且 repository 在运营方名下，
个人包拿不到，最多是普通收录。
