# 实施计划

## Stage 0：基线与文档

- 复制 Picot `v0.3.1-beta.13`。
- 保留 MIT License 和上游来源。
- 建立 MkDocs、需求、架构、ADR 和 Review。
- 记录基线测试失败，不将其伪装为本项目回归。

## Stage 1：Windows 可靠性

- 修复启动时两个 Git 控制台窗口。
- 建立统一 Windows 子进程配置。
- 下载并打包 Portable Git Bash。
- 在干净 Windows VM 验证无外部 Git、Bash。

## Stage 2：场景与实例

- 增加 SceneProfileStore。
- 内置编程、金融和创作场景。
- 为每个进程设置独立 Agent/Session/Log/Tmp 路径。
- 增加隔离单元测试和并行实例测试。

## Stage 3：模型渠道

- 结构化 Provider Profile 表单。
- 支持 `base_url`、协议、Headers、模型和兼容参数。
- 连接测试和错误诊断。
- Credential Manager 集成。

## Stage 4：发布

- Windows x64/ARM64 tag Workflow。
- NSIS EXE、代码签名准备和 Release 说明。
- MkDocs 严格构建。
- 安装、升级、卸载、断网和非管理员测试。

## Stage 5：应用插件基础

- 接受 ADR 0005，冻结 Manifest v1、权限目录和稳定错误码。
- 增加 Rust Plugin Registry、Manifest Validator 和 Plugin Manager。
- 增加 Activity Bar、Accordion Sidebar、Command Palette 和 Main View Router。
- 将现有 Chat 包装为不可卸载的 Core Plugin。

## Stage 6：插件 SDK 与 Pi Broker

- 增加隔离 Plugin View、Host API、Command 和 Capability Registry。
- 增加 Developer Mode、调试、诊断、超时、取消和熔断。
- Pi 只加载一个内置 Plugin Broker，将当前 Scene 已授权工具转发到 Rust Host。
- Chat 和 Pi 共用 Capability，验证按 Scene 授权和撤销。

## Stage 7：内置插件

- Notes：Notebook、Markdown、Astro 兼容内容目录、网页剪藏、搜索和 Chat/Pi 工具。
- Finance：迁移现有 Workbench，保留 QVeris、确定性回测、费用确认和模拟账户。
- Artifacts：统一保存报告、图表、文件、来源和导出。

## Stage 8：第三方生态与多端基础

- `.zicode-plugin` 包哈希、发布者签名、更新、回滚和撤销。
- 在公开第三方分发前增加 WASI 或等价 OS 级后台沙箱。
- Notes 增量变更、Sync Provider 和独立客户端共享协议。

插件阶段的详细依赖、每阶段验收和八项需求覆盖见
[内置插件与实施路线图](plugins/built-ins-and-roadmap.md)。

## 已知基线问题

2026-07-30 在 Windows 上运行上游 tag 的 `bun run test`：

- 279 个测试中 277 个通过。
- `extensions/picot-config.test.ts` 的临时 HOME/Auth 路径测试失败。
- `public/session-actions-layout.test.js` 与当前 CSS 不一致。

这些问题在本项目修复并加入发布门禁前，不能宣称测试全绿。
