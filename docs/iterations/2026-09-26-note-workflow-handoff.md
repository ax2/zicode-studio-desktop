# 2026-09-26 笔记开发工作流交接

状态：实现与静态检查完成，运行验收待补。本轮不新增或运行测试。

## 目标与发现

- Astro 构建、Vault 检查和聊天交接调用 saveIfDirty，其吞掉保存错误，后续操作仍可能执行。
- 构建确认之后读取实时 workspace，可能将旧 notebook ID 发往新工作区；生产接线未向 Notes 提供已存在的 Tauri invoke。
- 聊天切换没有等待异步 canDeactivate；输入框延迟重试没有校验会话是否变化。

## 工作日志

- 提取工作流动作和聊天交接模块，固定作用域、阻止重复启动、确认之后重新检查编辑上下文。
- workflow-actions.ts 统一当前作用域 busy 状态、保存门槛、错误显示与迟到结果检查；Astro 确认后重验 editor transition，固定 workspace/notebook。Vault 检查刷新 preserveSelection:true。
- NoteWorkflowActions.tsx 显示进度、禁用重复启动；聊天按钮也显示准备状态。目标切换清理旧视图状态，但不声称取消 Host 作业。
- app.js 将已有 Tauri invoke 接到 Notes。已静态确认 main.rs handler、权限声明和桌面 withGlobalTauri 均存在；没有执行真实构建。
- notes-chat-handoff.js 提取原提示词构造，等待 activate 完成；最多 40 次、间隔 50ms 等待输入框，每次检查目标对象与 scene/workspace/instance/session、Notes 编辑上下文和当前插件。保留原输入且不自动发送。
- canDeactivate 使用共享保存门槛，保存期间的新编辑不会被当作已保存而放行。聊天选中文字的判断只比较编辑正文是否变化，不要求渲染后的预览文字是原 Markdown 的连续子串。
- 大文件 notesStore/NotesApp/app 只接线与状态订阅，移除原动作/提示词实现；index 调用统一离开检查。

## 边界与后续

- 构建 busy 是当前工作区视图状态，不是跨窗口作业管理；切换工作区不会取消已派发构建。需要继续完善作业历史、取消与返回原工作区后的状态发现。
- 现有 Rust 构建链使用 Bun，单步骤最多五分钟，构建期间持有 scoped Vault 锁；没有在本轮改变进程树清理、运行时分发或构建安全策略。
- Chat 目标在开始切换聊天视图时固定；本轮不固定用户点击按钮之前的历史聊天会话。自动填入仍依赖现有 DOM 输入框和草稿同步机制。
- 未新增或运行测试、真实 Astro 构建、模型请求、UI/跨平台验收，也没有提交、推送或发布。

## 静态检查

- TypeScript、bun run check 与中英文覆盖通过；2391 键、0 缺失。既有 111 warnings、7 infos 与 xterm 内联尺寸提示不变。
- React 构建、MkDocs strict 与差异空白检查通过。未修改 Rust，因此本轮未重复运行 Rust 检查。证据前缀 E:\tmp\zicode-notes-handoff-。
