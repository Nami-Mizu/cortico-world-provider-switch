# Changelog

## 0.1.3

- 补 `author` / `contributors` / `repository` / `homepage` / `bugs` 元数据，供 npm 与扩展市场显示；行为没有变化。

## 0.1.2

- 环境提示词加了一节「挑哪一档」：日常与简单活留在快速端点，遇到吃推理的活（复杂代码、多步排查、要先想清楚
  再动手的方案）可以临时切到名字带 `pro` / `max` / `astra` 那一档，做完切回去；清单里没有这类端点时先查、
  不猜。

## 0.1.1

- **破坏性**：World id 从 `ProviderSwitch` 改成 `providerswitch`。页面 id 是 `world:<world id>`，而协议的
  `PAGE_ID_RE` 只接受小写字母、数字与连字符；大小写写错不会报错，但整页会被 manifest 丢掉，表现是
  「World 已挂载、工具能用、页面却 404」。
- 随 id 一起改的：页 id `world:providerswitch`、事件 `providerswitch.started` / `providerswitch.switched`、
  配置段 `worlds.providerswitch.*`。旧的 `worlds.ProviderSwitch.*` 不再被读取，需要重新启用一次。
- 面板显示名仍是 ProviderSwitch，类名与工具名（`provider_switch_list` / `provider_switch_use`）不变。
- 版本号进浏览器产物的 URL（`/assets/extensions/<包>/<版本>/webui.js`），所以升版本也会顶掉旧缓存。

## 0.1.0

- 首版：`ProviderSwitch` World，面板一点切换本部署的模型供应商端点。
- 工具 `provider_switch_list`（只读清单）与 `provider_switch_use`（切换，下一次模型请求生效）。
- 环境提示词带当前端点与端点清单；切换到 `ready` 之外的端点时回执原因为止。
- 走本机 WebUI 公开 HTTP 接口，设了访问密码时用部署 `.env` 的 `CORTICO_WEB_PASSWORD` 登录。
