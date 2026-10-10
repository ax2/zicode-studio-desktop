# 真实 Pi 到 Rust Host 插件调用

日期：2026-10-02。状态：Windows 完整调用与退出回归通过，其他系统待实际运行。

## 目标与实现

新增需要内嵌 Pi 和构建扩展的显式集成用例：临时数据库、笔记与配置，真实 NativePiManager 启动 Pi，正式 Host 配置函数提供运行时调用身份，打包 plugin-broker 的 execute 通过真实 HTTP 路由搜索临时笔记。临时观察扩展核对实际结果并发送确认通知，不调用模型或真实外部账户。

用例默认 ignored，避免没有下载资源的普通单元测试隐式联网；跨平台统一入口新增明确的资源准备与该用例执行步骤，缺少资源或失败均作为必需步骤失败。Release 流程也显式运行该用例。

## 发现与修复

首次请求报告 ProcessClosed。测试使用普通新会话，并将 Windows canonicalize 得到的 verbatim 路径转换为普通路径后，真实调用返回预期笔记结果。生产扩展路径解析已有相应处理，未据此宣称生产解析缺陷。

随后立即删除临时目录仍失败。检查确认 Host 的 request_shutdown 未停止 Pi 运行时；NativePiManager 的 stop 又仅发送终止请求而未等待进程退出。现 Host 发起停止时同时停止全部 Pi，运行时先检查是否已退出，必要时终止并等待实际退出，再完成状态注销。修复后完整调用和无重试的目录删除均通过。

## 验证结果

- 显式 ignored 集成用例通过：真实 NativePiManager/Pi、打包 plugin-broker execute、正式运行时身份、实际 Host 路由与笔记搜索，确认结果通知，再停止并立即删除临时目录。
- Host 退出 2 项、NativePiManager 5 项、Host 运行时插件鉴权 1 项用例通过。
- 跨平台检查入口 4 条 JavaScript 用例及代码/设计规则通过。
- 原生全目标编译与严格 Clippy 通过，既有格式 advisory 保留；新测试文件已格式化。
- 本轮执行参数关闭调试符号和增量编译。完成后 Cargo 回收 22,651 个文件、工具报告 4.7 GiB，target 不存在，E 盘空闲约 60.57 GiB。

## 限制

观察命令直接调用打包工具的 execute，不经过模型选择工具；没有真实模型推理、WebView 或第三方账户。完整链路证据属于 Windows 本机，macOS/Linux CI 配置存在不等于已运行。未发布、上传或触发远端流程，未保存身份值。
