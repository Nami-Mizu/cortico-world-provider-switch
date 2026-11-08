# 给接手这个包的人 / 模型

- `cortico.api` 是 6（world 契约版本）。Cortico 升到新契约时，先跑 `pnpm check:extension <包目录>` 看它打印的版本再改。
- 改了工具、事件或 `src/ENV_PROMPT.md` 之后，重跑 `pnpm describe:extension <包目录>`，否则 `describe.json` 与代码不一致（check 会报）。
- 工具名前缀固定 `provider_switch_`；World id 固定 `providerswitch`（必须全小写：WebUI 页 id 是 `world:<id>`，协议只接受小写字母数字与连字符，大小写写错整页会被 manifest 丢掉），配置路径因此是 `worlds.providerswitch.*`。
- `src/webui/client.ts` 是浏览器侧：只能 `import type` 来自 `cortico/*` 的东西，改完用 `pnpm build:webui` 重新产出 `dist/webui.js`。
- 面板只调 `ctx.invoke`，不要在浏览器里直接 `fetch` 接口。
- 测试不联网：`tests/helpers/stub-webui.ts` 在 `127.0.0.1:0` 上起一个真 HTTP 服务。
- 提交前：`pnpm typecheck && pnpm test`；发布前再跑 `describe:extension` 与 `check:extension`。
