# Stage：工具目录与命令面板取消过期搜索

日期：2026-10-17。目标是让上百项插件工具的连续搜索、分页及工作区切换不积累过期 HTTP 请求，同时保留按需加载工具详情的边界。

## 发现与修改

工具目录和命令面板原先只用局部 `active` 标记忽略迟到结果；输入、视图或工作区变化时，请求仍会继续占用连接直到 Host 响应或 30 秒超时。现由两个入口分别持有搜索请求的 `AbortController`，在 effect 清理时取消旧请求。`PluginCapabilityGateway.searchTools` 接受可选取消信号，网关将外部取消与原有内部超时合并到一次 fetch，并分别报告 `plugin_capability_cancelled` 与 `plugin_capability_timeout`。过期响应仍由原 `active` 标记拒绝写入页面。没有改变执行、权限、保存或工具详情加载接口。

## 验证

- `bun run vitest run public/native/plugins/plugin-capability-gateway.test.js frontend/src/features/toolCenter/ManualToolDirectory.test.tsx frontend/src/features/commandPalette/ToolCommandPicker.test.tsx`：3 文件、65 项通过，包含在途取消、已取消时不发请求、面板和目录旧信号失效。
- `bun run typecheck` 与 `bun run check` 均退出 0；后者报告现有 147 warning、10 info 及生成文件 1 项设计提示，设计检查和 Pi SDK 对齐通过。
- `bun run build:react` 退出 0，复用现有前端产物目录，没有重编译 Tauri EXE。
- Windows 0.4.2 Debug 复用此前已获授权的 Inspect 0.1.1 隔离 profile，`--tools-only` 启动。真实 1442×931 浅色窗口目录显示 24 项；输入 `Unicode` 得到 3 项，再改 `JSON` 得到 2 项且无错误。已目视检查并归档于技术博客 `screenshots/tool-search-cancel-2026-10-17/windows-json-filter-1442x931.jpg`（82,679 B，SHA-256 `1816C123F518608262DFDBB896BFF0171424BFD8F305E62C0D6E7D1B27027FE9`）。进程路径和隔离参数核对后停止，未遗留测试进程。

真实界面只验证搜索结果和布局；请求取消时序由自动化测试验证，没有对本机慢 Host 人为注入延迟，也没有在 macOS/Linux 原生窗口验收。DevTools 完整 154 项仍为 0/154，ZiFile 108 格仍为 0/108。本阶段没有版本号、发布或 ZIP 变更。

## 空间

构建/检查前后只读扫描未知项均为 0，`target` 均为 30,010,795,065 B，非 scratch `.cache` 均为 355,458,670 B，task scratch 1,136,632,367 → 1,136,649,588 B（文件数保持 34,919），E 卷可用 15,809,146,880 → 15,852,240,896 B；卷余量变化不能归因于本轮。扫描因容量建议退出 1，不构成删除有用缓存的理由。
