# 工具专用会话（内部能力，2026-10-11）

## 用途

Explorer 文件工具入口需要在用户确认读取前保持文件内容未读。把文件父目录当成普通项目打开，会启动 Pi 并触发项目上下文发现及启动备份；这些副作用不能算文件授权。本能力为后续文件入口提供独立的插件生命周期。

## 已实现的内部边界

- `HostServer::start_tool_session` 注册真实工具会话及插件授权代次，不构造 Pi 启动参数、不创建 Pi 子进程、不模拟 RPC 管道。
- 工具会话保留项目、场景、会话、实例的精确身份；目录搜索、详情、资源快照与 WASI 调用继续走相同 Host 权限检查和预算。
- AI 请求、扩展 UI 回应和会话绑定明确拒绝，错误前缀 `TOOL_SESSION_AI_UNAVAILABLE`；不接受幂等写入、不自动升级、不进入 Pi 重启分支。打开 AI 应另建会话。
- 重复实例/会话注册拒绝；伪造项目/会话身份不能复用工具生命周期。停止后 broker 身份、待确认文件凭据和已确认资源读取失效。
- 调用方仍须登记当前项目根、持有可信桌面通道并负责停止。此接口不表示文件读取授权，也不授予网络、磁盘写入或 native 执行权限。

## 验证范围

管理器专项检查没有进程/桥接/启动参数，拒绝 AI、错误身份与自动绑定；停止工具会话不影响另一个 AI 会话。实际 HTTP/文件快照/WASI 专项使用此生产注册接口替换原来的模拟 Pi 会话，保留普通测试的模拟 Pi 绑定覆盖。结果与失败记录见技术博客对应阶段日志。

## 桌面独立工具入口

使用 `zicode-studio-desktop.exe --tools-only` 进入工具中心。可与 `--isolated-profile <绝对路径>` 合用；不能与 `--open-folder` 或菜单管理参数混用。普通启动仍保留 AI 行为。

工具入口以全局项目为作用域，生成 `tools-*` 会话。启动跳过历史扫描/恢复、项目备份以及 Pi 启动参数生成。Host bootstrap 增加 `runtimeMode`，工具 snapshot 返回 `runtimeMode: tools`、`pi: null` 和空消息；capabilities 的 nativeRpc/extensionUi/sessionTree 为 false。客户端据此跳过自动模型、斜杠命令、记忆及压缩请求。失效的 tools 路由不自动回退到历史 AI 会话。

选择历史 AI 会话或新建 AI 会话仍是单独的用户操作；工具会话不会自动升级。窗口关闭依然沿用托盘隐藏/退出策略。后续已加入 [--open-file 文件启动与确认流程](explorer-file-entry.md)，但文件菜单注册、文件类型筛选与托盘工具窗口仍待，不能称为 Explorer 完整集成完成。

后续需要：目录按资源协议与文件类型筛选工具；选择接收方后预览，再明确确认快照，再独立执行；取消/换工具/关闭时撤销凭据；实际 Windows Explorer 和完整文件流 WebView 验收。独立工具入口的验证记录见技术博客 `iterations/tool-center-entry-2026-10-11/work-log.md`。

ZiFile native 隔离、目录/大文件、分页、密码短期引用及写入生命周期继续按 [完整接口需求](zifile-integration-requirements.md) 推进。当前 ZiFile 实际接受为 0，DevTools 154 工具完整接受为 0。
