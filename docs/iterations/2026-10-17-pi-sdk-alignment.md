# Stage：嵌入式 Pi 与扩展开发依赖对齐

日期：2026-10-17。Studio 继续以跨平台个人开发者平台为目标，本轮核对内嵌 Pi 与编译 Studio 扩展时使用的 Pi SDK 版本，避免后续插件 Broker 按旧声明开发。

## 发现与修改

- `scripts/pi-version.json` 和 `src-tauri/resources/pi/.version` 已锁定 Windows x64 Pi 1.3.0。2026-10-17 从 [`earendil-works/pi` 最新 release](https://github.com/earendil-works/pi/releases/tag/v1.3.0) API 读取到 `v1.3.0`（发布于 2026-10-15 19:17:33 UTC），其资产包含六个当前锁定的桌面目标和 `SHA256SUMS`。因此没有重新下载或替换现有 Pi 资源。
- `package.json` 的 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui` 开发依赖仍为 1.2.0。两项已精确锁到 1.3.0；`bun.lock` 对应的 Pi agent-core、ai、codemode、mcp、telemetry 等传递依赖也由 Bun 解析到 1.3.0。保留 `package.json` 中其他进行中的改动。
- `scripts/build-extensions.js` 继续把 Pi 包标记为外部依赖；此次没有给桌面发行目录加入第二份 Pi，也没有修改应用版本 0.4.2。

## 验证

- `bun add -d -E @earendil-works/pi-coding-agent@1.3.0 @earendil-works/pi-tui@1.3.0` 成功，Bun 报告安装 10 个包；随后 `bun install --frozen-lockfile` 退出 0，检查 281 个安装项、401 个包，未再修改安装。
- `bun run typecheck:extensions-source` 和前端 `bun run typecheck` 退出 0。
- `bun run check` 退出 0：145 条已有 warning、10 条 info，设计检查通过并保留生成文件的一条 inline-style 提示。
- `bun run build:extensions` 退出 0，生成 `picot-bridge.mjs`、`plugin-broker.mjs` 与 `pi-chat.mjs`，复用现有输出目录。
- `bun run smoke:pi-rpc` 退出 0，嵌入式 Pi 1.3.0 的 6 条 RPC 命令通过。

## 边界

上述 `smoke:pi-rpc` 使用独立临时扩展，单独不能证明三份 Studio 扩展装载；同日后续的隔离实测见下文。扩展构建、类型检查和本机插件调用也不等于真实模型自主调用或完整 DevTools 工具接入。Windows 原生插件链路已有其他阶段证据，本轮未重新计数；完整 DevTools 接受仍为 0/154。macOS/Linux 真实构建与运行、签名插件包仍待。没有重编 EXE、发布版本、生成 ZIP 或按容量门槛清理缓存。

构建/安装会话前后只读空间扫描退出 0、未知项为 0：`target` 均为 29,997,194,081 B；非 scratch `.cache` 均为 355,458,670 B；task-scratch 1,136,872,313 → 1,136,872,569 B；`site` 均为 29,644,753 B。E 卷可用 30,072,676,352 → 30,111,309,824 B，卷余量含其他进程影响。扫描没有统计 `node_modules`，因此不能把它作为依赖安装总磁盘变化；未据提示门槛删除有用缓存。

## 同日续进：防止后续版本漂移

- 新增 `scripts/check-pi-sdk-alignment.mjs`，在本地 `bun run check` 和发布工作流中要求两项直接 Pi SDK 开发依赖与 `scripts/pi-version.json` 精确一致；不下载、不修改依赖。`bun run check` 退出 0，检查器报告三处版本均为 1.3.0。
- 自动更新工作流现在从当前 `earendil-works/pi` 仓库读取最新发布与发行说明；更新 Pi lock 后同步用 Bun 更新两项 SDK、核对版本、检查扩展源码并打包，然后再取嵌入式 Pi 和跑 RPC 冒烟。自动 PR 纳入 `package.json`、`bun.lock`，避免只更新二进制锁。项目 `AGENTS.md` 的手动升级步骤同步修正。
- `bun -e` 使用现有 `yaml` 依赖解析 `.github/workflows/update-pi-version.yml` 退出 0。未实际触发 GitHub Actions，因此远端自动 PR、跨平台安装与真实扩展运行仍待验证。
- 检查会话前后只读空间扫描退出 0、未知项为 0：`target` 均为 29,997,194,081 B，非 scratch `.cache` 均为 355,458,670 B，task-scratch 均为 1,136,872,569 B，`site` 均为 29,644,753 B。E 卷可用 30,160,654,336 → 30,159,482,880 B；容量提示未触发清理。

## 同日续验：Studio 扩展真实加载

- 原 `smoke:pi-rpc` 只加载临时扩展，不能证明 Studio 自带扩展可在 1.3.0 中运行。复用现有 `smoke:inbox-extension` 的独立临时 HOME、无用户凭据环境和 `127.0.0.1` 测试 Host；开发场景现在只允许测试插件工具，不再继承金融场景工具允许列表，并明确拒绝任何意外注册的 `qveris_` 工具。
- `bun run smoke:inbox-extension` 退出 0：重打包 `picot-bridge.mjs`、`plugin-broker.mjs`、`pi-chat.mjs`，嵌入式 Pi 1.3.0 实际加载三份扩展，注册 Inbox 命令和插件工具；测试工具对本机 Host 完成一次成功结果，以及 HTTP 拒绝和缺失结果两条失败路径，Pi 正常退出。未连接第三方或公司服务。
- `bun run check` 退出 0；145 条已有 warning、10 条 info，设计检查通过，Pi SDK 守卫报告 1.3.0 一致。
- 这证明开发场景下的真实 Pi 扩展装载和本机插件调用；未覆盖模型自主选工具、真实 DevTools 签名包、桌面 UI、其他系统或完整工具范围。DevTools 完整接受仍为 0/154。
- 续验前后只读空间扫描退出 0、未知项 0：`target` 均为 29,997,194,081 B，非 scratch `.cache` 均为 355,458,670 B，task-scratch 1,136,872,569 → 1,136,668,672 B（文件数 34,875 → 34,871），`site` 均为 29,644,753 B；E 卷可用 30,149,775,360 → 30,149,312,512 B。scratch 的减少不能归因于本轮测试；未做清理。
