# Pi 1.2.0 本地开发升级（2026-10-14）

本次只更新 Studio 内嵌 Pi 和开发依赖，不改变 Studio 应用版本 0.4.2，也不创建 Release、ZIP 或另一套 Cargo target。官方发布页为 <https://github.com/earendil-works/pi/releases/tag/v1.2.0>。`scripts/update-pi-version.js` 从发布资产取得六个目标的 SHA-256，写入 `scripts/pi-version.json`；Windows x64 下载摘要已核对。`package.json` 与 `bun.lock` 中两个 Pi 开发包精确锁定 1.2.0。新增 `tests/fixtures/pi-rpc/1.2.0/contract.json`，不会覆盖 1.1.0 历史契约。

## 本地验证

- 更新脚本的 dry run 与实际更新成功；6 项 Pi RPC 冒烟检查在生成契约前后均通过。Pi 二进制 `--version` 为 1.2.0。
- `bun run typecheck:extensions-source`、`bun run check`、`bun run build:extensions` 通过。`bun run check` 仍报告仓库既有 143 个 warning、10 个 info，以及设计检查中的 1 个内联样式提示。
- Finance 与 Inbox 扩展均在 Pi 1.2.0 上完成命令加载、本地插件 HTTP 往返与正常退出；不包含真实模型调用或外部凭据。
- `bun run build:local` 复用 `target/debug`，最终 EXE 为 `target/debug/zicode-studio-desktop.exe`，SHA-256 `447B29E50AF10265430235D8B704DF09B85D557088D0F687B0B74576B1A3A9E7`。未生成新版正式安装包。
- 更新包依赖后没有实际启动这个 EXE 的原生 WebView 会话。一次沿用旧隔离 profile 的运行与 `/health` 读取命令被自动批准审查以 `blocked by policy` 拒绝，命令未执行；没有改用别的 profile 重试。不能据此声称新版 EXE 的运行态 Pi 健康页或系统托盘已验收。

## 磁盘与接入范围

前置只读扫描：`target` 44,924,677,788 B / 80,680 文件，`.cache` 310,323,816 B / 155 文件，`task-scratch` 556,030,248 B / 27,081 文件，E 盘可用 13,180,239,872 B。后置：`target` 44,916,832,364 B / 80,681 文件，`.cache` 355,423,350 B / 156 文件，`task-scratch` 不变，E 盘可用 12,406,996,992 B；两次 UnknownEntries 均为 0。容量门槛只是提醒，不据此删除有用缓存。旧被拒绝的临时目录也未重试删除。卷可用空间变化含其他进程活动，不能视为本次净占用。

托盘与 Explorer 的现有 Studio 入口不因 Pi 升级改变。ZiFile 仍无独立签名 Studio 插件包，108 个格式操作单元接受数为 0；DevTools 全量 154 格接受数仍为 0。当前 `--open-selection` 与托盘源码/局部验证不能替代物理右键点击、安装包卸载或实际提供方算法验收。所需接口继续以 `docs/plugins/zifile-integration-requirements.md` 和 `docs/plugins/explorer-tool-entry-policy.md` 为准。
