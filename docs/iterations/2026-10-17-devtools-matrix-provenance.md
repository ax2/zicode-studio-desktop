# Zi DevTools 接入矩阵来源校验

日期：2026-10-17。目标是让 Studio 的 154 项接入矩阵能自动核对所引用的冻结目录，避免后续维护时静默漏项或误报完整接入。

## 发现与修改

矩阵声明的目录版本、`tools.json` 摘要和迁移清单摘要都属于 `dev.105`，但 `catalogSnapshotPath` 仍指向 `dev.103`。已将该路径修正为 `dev.105`，未更改任何工具的接入状态、完整接受数或提供方源码。

新增 `scripts/devtools-integration-matrix.test.js`：核对两个冻结文件的原始字节 SHA-256、目录版本、154 个唯一 ID 的精确覆盖、每项 scope/来源状态、阻塞原因和重开条件、状态汇总及完整接受计数。`django-trace` 与 `java-trace` 的矩阵版本 1.0.3 对冻结 dev.105 版本 1.0.2 保留为显式历史例外；既有[漂移记录](2026-10-17-provider-catalog-drift.md)已确认这是混合时间点的观察，不将它们改写为快照版本，也不将其视为完整验收。

## 验证与边界

`bunx vitest run scripts/devtools-integration-matrix.test.js` 2/2 通过；`bun run check` 退出 0（既有 147 warning、10 info，设计检查提示 1 条生成 JS 内联样式）。前后只读空间扫描未知项均 0；`target` 均为 30,022,025,378 B，非 scratch `.cache` 均为 355,458,670 B，task-scratch 均为 1,178,292,459 B，`site` 均为 29,644,753 B。E 盘可用 9,562,177,536 → 9,564,336,128 B，卷余量变化不归因于本轮。容量提示使两次扫描退出 1，但数据完整，未清理缓存。

该校验只证明 Studio 清单内部与冻结目录的可追溯关系；不证明 154 项执行、签名插件交付、其他系统或正式发布。当前完整工具接受仍为 0/154。

桌面观察：收到用户“已最小化”后，通过 Computer Use 只读枚举，当前桌面没有 Studio 窗口。本轮未启动新窗口；切换器布局以技术博客已归档的 `screenshots/opened-tool-picker-2026-10-17/` 截图和对应工作日志为依据，不计新的原生界面验收。
