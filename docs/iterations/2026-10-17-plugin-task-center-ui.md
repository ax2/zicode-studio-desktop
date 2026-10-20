# 插件任务概览接入任务中心（2026-10-17）

## 目标与实现

将 Studio 自有的可信 Host 任务概览接到现有任务中心，同时保留智能体与自动化任务的独立加载。桌面 shell 通过已有认证 Host fetch 请求 `POST /v2/plugin-task-center/workspace`，每次只请求当前工作区的 30 项；远程端不展示该只读区块。区块支持刷新、游标加载更多、工作区切换时清空旧记录与拒绝迟到回复。异常只在插件区块显示通用错误，不暴露 Host 原始响应。

十种内部状态在界面映射为中文标签；未知状态显示通用说明，不直接暴露内部状态字符串。

该区块目前仅供读取，不提供启动、取消或保存按钮。`plugin.task.lifecycle.v1` 仍未对提供方开放；数据库没有真实插件任务来源，故实际桌面只显示空状态。DevTools 完整接受数仍为 0/154，ZiFile 为 0/108。

## 验证

- TypeScript 类型检查通过；新增前端组件和 shell 客户端定向测试共 4/4 通过。`bun run check` 退出 0，保留仓库已有 advisory；React 输出重新构建。
- `bun run build:local` 使用现有 `target/debug` 构建本地 EXE；Pi 1.3.0、Portable Git、WebView2、Bun 资源均命中现有目录，没有重复下载，也未改变应用版本。
- 在 Windows 隔离 profile 中实际打开 Debug EXE，任务中心显示插件任务标题、只读说明、刷新和空状态；原智能体任务的 `IdentityMismatch` 错误没有遮断插件区块。1442×931 桌面截图位于技术博客 `screenshots/plugin-task-center-2026-10-17/windows-desktop.png`。没有移动端或 macOS/Linux 截图。
- 隔离验收进程已停止。自动策略拒绝删除本轮临时 profile，实际删除 0；按项目规则不换工具重试，路径记于技术博客工作日志。

## 待验收

需要真实插件签发包、任务提交与执行 Host 处理器、授权与取消状态联动、实际列表行、分页真实数据、结果查看及跨平台桌面验收。空状态截图与模拟数据测试不能代替“发现插件 → 加载工具 → 执行 → 展示结果”。

## 同实例会话绑定修复

首次隔离实机截图中，原有智能体任务读取报 `Runtime request rejected: IdentityMismatch`。核对发现 NativePiManager 对 `workspaceId`、`sessionId`、`instanceId`、`sceneId` 精确匹配，任务中心的 `sameTaskTarget` 却遗漏 `sessionId`；临时会话绑定到正式 ID、实例不变时，原任务 store 可继续使用旧目标。现把 `sessionId` 纳入目标变化判断。新增定向用例验证同实例临时→正式会话后请求改用新 ID；任务中心现有 51 项与新增 1 项均通过，TypeScript 与项目检查通过。

复用原隔离 profile 与 `target/debug` 再构建、启动 Windows EXE，任务中心实际显示正常空状态，不再显示 `IdentityMismatch`；1442×931 截图归档为技术博客 `screenshots/plugin-task-center-2026-10-17/windows-desktop-session-binding-fixed.png`。此实机结果支持当前场景已恢复，但尚未覆盖所有会话迁移和其他系统。
