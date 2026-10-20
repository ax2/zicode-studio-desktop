# DevTools Diagnostics 0.1.3 审核目录只读接收（2026-10-17）

## 来源与完整性

只读检查 `E:\zi-devtools\release\plugin-candidates\diagnostics-0.1.3-candidate-01` 和同级 `diagnostics-0.1.3-candidate-01-verification.json`。收据 SHA-256 为 `ac464edb539cdb34332ae0d618c4c47f6439455b3b6218408a43b77703003678`。独立枚举实际文件并核对包外收据：声明/实际均为 503 个普通文件，逻辑字节 4,287,534；路径逃逸、缺失、额外文件、长度偏差、SHA-256 偏差及文件重解析点均为 0。`runtime/tools.wasm` SHA-256 为 `56e782da3df2f5772e2ec558014524c9e3543b93290780debc7ccdb507104042`，与收据一致。未复制目录或修改 DevTools。

收据自报源码 revision `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`、dirty=true；`signature` 明确为 unsigned directory，`packageSha256=null`。因此这仍是可核对的审核目录，不是可安装的正式 `.zicode-plugin`。目录在提供方工程内可能继续变化；任何后续运行前必须重新核对这个精确收据及全部文件，不把本次只读观察当作冻结接收。

## 协议发现

清单 schemaVersion 2，11 项诊断能力，要求 `compute.wasi.v1@=1.0.0-rc.1` 和 `output.schema.v1@=1.0.0-rc.1`。11 项能力均无 `outputSchema` 或 `maxResultBytes`。Studio Host 的 profile 门禁明确拒绝 `output.schema.v1 requires an output contract declaration`；旧快速提示只检查“用了字段却没声明 profile”，因此曾漏报“声明 profile 却没用字段”。本轮扩展快速提示并对原目录运行，返回 `declared_without_output_contract`（退出码 1）；4 项脚本测试和 Biome 定向检查通过。提示不是 Host 验收，未安装目录或运行 Worker。

提供方 README 将诊断报告 schema `2.0.0-rc.1` 与错误码 `INVALID_REPORT`、`OUTPUT_TOO_LARGE` 标为提案；`data.text` 内 JSON 的语义不是通用 `output.schema.v1` 的自动保障。提供方收据自报 188 项原生/WASI功能向量、188 项 fuel 及冷启动行通过，最大冷行 1,227.606 ms、最大 fuel 8,652,138；View 亮色 1180×900、深色 390×844 各调用 11 项并标记通过。这些数字只证明收据的内容，尚未由 Studio 生产 Host 独立重跑或审查截图；不能抵消 Host 清单拒绝。

## 提供方接口需求与待验收

1. 输出新的候选及独立收据，不修改这份已核对的目录。若要求 `output.schema.v1`，至少一个能力必须明确声明 `outputSchema` 或 `maxResultBytes`；建议 11 项分别声明对应 `{text:string}` 结果结构和有界字节预算。若暂不使用结果门禁，则移除该 requiredProfile，并如实标记报告内部语义仍为提案。
2. 对 `INVALID_REPORT`、`OUTPUT_TOO_LARGE` 及诊断报告 v2 提供公开版本化契约、正反例、取消/超时/权限语义。Studio 评审后才能称诊断 profile 正式支持；不能仅凭通用文本载体宣称语义已接收。
3. 交付正式签名 `.zicode-plugin`、包 SHA-256、签名公钥身份及逐文件收据，并保证独立构建可重复。目录收据、Node/Python/C API 测量不能替代 Studio 签名安装与生产 Worker 证据。
4. 正式验收需覆盖发现→按需加载→11 项调用→展示/接力、Pi 授权与撤权、超时/取消、升级/回退、边界向量、Windows 与其他目标系统。11 项仅是导入报告子能力；154 项完整源工具验收仍为 0/154。

本轮无界面改动、原生截图、应用构建、完整运行副本或 ZIP。没有触碰此前被审批拒绝的清理目标。

前后只读存储扫描完整、未知项均为 0：target 均为 29,421,057,961 B，task-scratch 均为 932,850,915 B；E 盘可用 42,954,166,272 → 42,988,867,584 B。未声称释放项目空间；卷空闲量变化可能来自其他进程。
