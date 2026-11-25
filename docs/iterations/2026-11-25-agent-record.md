# v0.7.9 · Agent 运行记录检查

在插件管理审核并启用 ZiDevTools Agent Record Inspector 0.1.0 后，从工具中心搜索「Agent 运行记录检查」。选择并明确确认一份 ZiDevTools 导出的 JSON。工具支持 v1–v5，单份最多 64 KiB。

摘要包括运行状态、UTC 结束时间、白名单内的工具序号、调用耗时与响应字节数、模型报备用量、来源和引用数量。v5 还核对环境指纹结构。任务正文、路径、模型名、工具名及错误原文不进入摘要。工具只读核对已确认的文件，输出不会启动模型或重放任何操作。

## Windows 验收

- 候选 01 共 8 文件、359,741 字节，目录索引 `879fea1cb44c743311b4b4cbb9e42586b34d2295986507d4d73c59e7dea2fd29`，WASI `2ff30a39349a7ea95f1f643db50cb753a6a89f310ab5de90b3f1da3aa09f52c0`。提供方已验证源码 `de3c283f8f3df75c9a163596d413be5e2c599be1`。[ZiDevTools PR #24](https://github.com/ax2/zi-devtools/pull/24)
- Windows 生产 Worker 的 43 项合成对照通过，包含全部版本、明确格式错误、整数用量精度、64 KiB 正例及超出一字节。首轮密集引用消耗预算的实测记录保留。换用等价的 ASCII 引用扫描后，同一文件在既有预算内通过。独立版记录、来源标记及工作表定向回归通过。
- 全新 Windows 隔离资料通过完整包验证并安装，初装停用，明确授予 `resource.read` 后启用。真实工具中心、Host 与 Worker 核对 65,536 字节合成 v5 的显示和隐私边界、无效结构、超出一字节、逐文件共享及撤权。撤权后清空结果，原件逐字节一致。重启后包、权限和重复检查的结果一致，文件需要重新确认。初装和重启回执 SHA-256 `4ef0f5293eb9f266a1d6249f00b0e62b6a5a51670f96d7c2e4c9300a06d69d00` 与 `a09b24c10a337d4143ecbfacc98150c7420dc0ebeedd7ebb2fb91d64bfab28d7`。

本次覆盖 `agent-replay` 的单文件只读检查。独立版的目录归档与检索、较大记录、原生系统选包和正式安装版由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 继续跟踪。
