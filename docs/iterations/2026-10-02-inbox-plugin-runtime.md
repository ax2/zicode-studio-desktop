# Inbox 与插件工具真实注册验证

日期：2026-10-02。状态：Windows 本地真实内嵌 Pi 检查通过，远端四平台流程待执行。

## 修改与发现

扩展 smoke 新增开发场景模式，加载构建后的 picot-bridge、pi-chat 与 plugin-broker。核对配置命令、Inbox 的 chat-config/chat-list/chat-connect/chat-new/chat-disconnect/chat-status 六项命令，并确认该场景不存在 finance-status。

为插件 Broker 提供仅用于本地检查的工具描述和虚构请求上下文，通过明确加载的临时观察扩展读取真实 Pi 的 getAllTools 元数据，再通过通知与 prompt 响应同时确认注册成功。观察扩展不调用插件工具、不请求模型，也不连接外部服务。

原检查在 get_commands 后跳出 stdout 异步迭代，会关闭读端；Inbox 退出阶段有状态通知，初次检查出现缺失命令或非零退出。改用显式 reader 并在关闭 stdin 后持续消费输出，后续 Inbox 与金融两种检查均通过且正常退出。诊断阶段曾临时保留无用户配置子进程的有界 stderr；最终实现恢复只消费、不保留诊断内容。

新增 `bun run smoke:inbox-extension`，四个平台的 Release 构建行接入 Inbox/插件注册检查。

## 验证与范围

- 本机内嵌 Pi 在开发场景加载三份实际 ESM 资源，检查配置和六项 Inbox 命令、插件工具元数据，正常退出。
- 金融场景的桥接、金融命令和插件工具元数据检查也通过，正常退出。
- 环境规则 2 条用例通过，代码/设计与 Windows 子进程规则检查通过，既有 advisory 保留。
- 未调用真实 Inbox 账户、插件 Broker HTTP 接口或模型服务。这些注册证据不能替代消息收发、插件调用鉴权、Host/WebView 或三平台安装验收。
- 未触发发布，未新增 Rust 构建缓存。
