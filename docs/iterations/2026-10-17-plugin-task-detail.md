# 插件任务中心详情读取（2026-10-17）

## 目标与修改

任务中心先前只能列出工作区内的插件任务；一条任务的状态变迁无法从 UI 核查。本轮增加仅限 Studio 桌面的 `POST /v2/plugin-task-center/detail`。Host 要求桌面令牌、已注册工作区和符合格式的 `taskRef`，按工作区绑定读取当前快照及最近最多 64 条状态事件。不存在或属于其他工作区的 taskRef 返回同样的 `task_not_found`；响应不包含输入、幂等键、结果引用或资源内容。此路由不是插件 View 生命周期 profile，也不能提交、取消或执行任务。

任务中心对列表记录提供按需展开的详情，显示有序事件、取消请求状态以及更早事件被截断的提示。工作区切换和组件销毁使旧详情响应失效；详情读取失败限制在该记录的面板内。中文文案已补。仍保持任务中心的只读边界。

## 验证

- Rust Host 定向测试 1/1 通过，覆盖无令牌拒绝、同工作区读取首条事件、其他工作区不可读、响应不包含输入内容。
- 前端 2 文件 6/6 用例通过；`bun run typecheck`、`bun run check` 和 `bun run check:rust:static` 退出 0。Rust 静态入口仅报告仓库既有 rustfmt advisory；新增源文件单独 rustfmt。初轮 `bun run check` 报新增详情容器 ARIA 属性的元素类型错误，改用可命名的 `section` 后重跑通过。
- `bun run build:local` 成功，复用现有 `target/debug`、Pi 1.3.0、PortableGit、WebView2 和 Bun 资源；未新增 Release、ZIP 或版本号。
- 隔离 tools-only Debug EXE 的真实 Windows 窗口截图已检查：插件任务标题、刷新和空状态可读；没有真实任务，因此详情展开未获原生截图或 WebView2 交互验收。窗口测试后已停止，已安装应用未动。

截图同时显示现有 Super Agent 任务区在 tools-only 模式报告 `TOOL_SESSION_AI_UNAVAILABLE`；插件任务区本身正常。这是工具专用启动下任务中心的现有体验缺口，不能把空状态截图视为整页无错误验收。

后续阶段已修复该体验缺口，见[工具专用会话任务中心隔离](2026-10-17-tools-only-task-center.md)。本段保留当时截图的原始发现。

## 边界与下一步

提供方尚无签名 `.zicode-plugin`；任务提交、运行、确认、取消与结果恢复 profile 尚未实现或发布，DevTools 工具完整接受仍为 0/154。当前仅能对 Host 内部已有记录做桌面只读检查。真实提供方任务、详情展开、多页事件和 Windows/macOS/Linux 原生验收仍需推进。此前被审批拒绝的磁盘清理没有重试。

前后只读扫描均退出 0：`target` 从 29,407,499,061 B 到 29,413,100,978 B，task-scratch 从 852,839,902 B 到 852,847,208 B；`.cache` 均为 355,458,670 B，site 均为 29,644,753 B，UnknownEntries 全为 0。E 盘可用从 48,614,735,872 B 到 48,638,038,016 B；卷空间同时受其他进程影响，不把余量变化归因于本轮。实际删除 0 文件、0 字节。补验 `git diff --check`、前端类型检查及中文词条覆盖退出 0，词条缺失数 0。
