# 2026-09-27 提交前差异审查交接

状态：实现与静态检查完成，运行验收待进行。上一轮完成提交差异交接，本轮覆盖日常提交前审查。

## 目标与设计

- 已暂存、未暂存差异均可显式加入同项目聊天草稿，保持已有草稿和附件，不自动发送。
- 提示区分 index 对 HEAD 与工作树对 index，携带前端收到预览的时间和截断状态，不把可变工作树当作不可变提交。
- 交接已有显示快照，不在点击交接时重新读取或偷偷扩大上下文；刷新/切换比较后旧预览立即失效。
- 读取器函数变化也使预览失效，异步回复与错误按工作区/比较/刷新版本/读取器隔离。

## 工作日志

- 已确认现有交接仅接受 CommitDiff，工作树差异响应仅校验 mode；开始提取通用审查材料与预览读取模块。
- workspace-diff.ts 在 store 与预览读取边界校验 mode、patch 类型/显示长度和 truncated；无效响应进入读取失败，不生成审查草稿。
- use-workspace-diff.ts 提取异步读取、scope 匹配和错误状态；scope 包括 workspace、mode、revision 与 reader，函数更换后立即隐藏旧结果。GitStatusPanel 同步加入 reader 身份，避免状态读取器更换时继续挂载旧详情。
- git-review.ts 使用 commit/workspace 区分审查材料；提交对象保留 ID/parent/parentCount，工作树材料携带 index-vs-HEAD 或 working-tree-vs-index，以及 receivedAt，不虚构 commit ID。
- GitDiffPanel 展示前端接收时间和可变状态说明，非空且有效的已暂存/未暂存差异复用审查按钮。按钮只传递显示快照，继续沿用同项目同会话校验、保留草稿、显式发送和长度保护。
- 大型 store 与项目入口只增加解析/props 接线，i18n.js 只增加词条；异步逻辑和校验位于独立模块。中英文帮助、平台说明与导航已同步。

## 静态检查

- TypeScript、bun run check 与中英文覆盖检查通过，2471 键、0 缺失；既有 111 warnings、7 infos 和 xterm 内联尺寸提示保留。
- React 构建、MkDocs strict 与差异空白检查通过。构建后恢复本轮前干净的无关前端产物，保留项目相关和原有修改。
- 证据前缀 E:\tmp\zicode-worktree-review-。

## 验证边界

- 不新增或运行测试。本轮没有授权自动提交、发送模型请求或发布。
- receivedAt 是前端收到响应的时间，不是 Host 读取开始或结束时间，也不提供仓库原子性、HEAD 固定、文件未变更或时钟同步保证。
- 提交前预览不含未跟踪文件，二进制与子模块处理沿用原 Git 差异规则。截断材料仍可交接但会明确标记不完整。
- 未执行真实 Git、聊天交接、草稿恢复、UI 或跨平台验收。本轮没有 Rust 修改、提交、推送或发布。
