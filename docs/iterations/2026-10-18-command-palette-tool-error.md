# 命令面板打开插件工具失败提示（2026-10-18）

## 目标与修改

命令面板中的具体工具在选择后异步调用插件 Shell。此前面板先关闭，若 Shell 因目录修订、插件状态或 View 定位失败而拒绝，错误只进入 `console.error`。现为工具打开路径增加独立 `onToolError`，Studio 将错误代码映射到现有安全文案，翻译后通过通知中心显示；不把插件原始错误消息展示给用户。普通命令继续使用原来的 `onError` 路径。打开动作仍不执行工具，也不记录执行历史。

## 验证

- `bun run vitest run frontend/src/features/commandPalette/commandPalette.test.tsx`：11/11，通过新增异步拒绝回调用例；确认普通错误处理器未被误用、面板关闭且未调用工具。
- `bun run typecheck`、`bun run check`、`bun run build:react`、`bun run build:local`：退出 0。`check` 的仓库现存建议级 lint 和设计提示未自动修复；本地构建复用 `target/debug`，仍为 0.4.2，无安装包和 ZIP。
- 隔离 Windows Debug `--tools-only` 实际窗口 1442×931：工具目录和命令面板的具体工具搜索可读，按需返回 16 项；点击禁用的内建 List habits 后主界面正常，详情明确提示“插件已禁用”。截图见技术博客 `screenshots/Stage-2026-10-18-command-palette-tool-error/`。此路径没有触发新的异常通知分支，通知的异步错误行为由定向用例证明，原生故障注入仍待验。

## 空间与遗留

构建前只读扫描：`target` 22,558,703,594 逻辑字节，现有 task scratch 2,784,637,275 字节，E: 空闲 61,403,602,944 字节。隔离验收进程已停止。本轮 scratch `E:\zicode-studio-desktop\.cache\task-scratch\command-palette-error-2026-10-18` 共有 333 文件、14,739,176 逻辑字节；路径与进程核验后，删除命令被自动审批策略拒绝。未改用其他方式重试；该目录是精确手工清理候选。其他已有缓存、发布目录和未提交工作均保留。

构建后只读扫描：`target` 22,558,748,049 逻辑字节（本轮增 44,455），task scratch 2,799,376,451 字节（增 14,739,176，均为上述隔离配置），E: 空闲 61,365,338,112 字节。卷空闲变化不直接归因于本轮构建或配置。

完整 DevTools 正式接收仍为 **0/154**。此轮没有安装或启用新提供方包，没有验证真实 DevTools View 操作故障、四平台或发布签名。
