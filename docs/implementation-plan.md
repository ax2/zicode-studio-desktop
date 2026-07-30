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

## 已知基线问题

2026-07-30 在 Windows 上运行上游 tag 的 `bun run test`：

- 279 个测试中 277 个通过。
- `extensions/picot-config.test.ts` 的临时 HOME/Auth 路径测试失败。
- `public/session-actions-layout.test.js` 与当前 CSS 不一致。

这些问题在本项目修复并加入发布门禁前，不能宣称测试全绿。
