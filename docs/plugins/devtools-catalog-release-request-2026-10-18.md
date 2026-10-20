# ZiDevTools 全工具目录下一版交付需求（2026-10-18）

**最新修订 `9c17b7b91e84f1c7`：**Studio 已按原字节冻结 154 ID 目录和九份无签名候选，并从 Studio 自有副本逐包核对通过。新修订的 54 项 capability 目录元数据齐备，Spring 的 4 项及 Agent Assist 的 2 项作为 View 操作有明确映射；旧 27 项元数据缺失和 Spring 孤项请求已在静态交付层关闭。仍需提供方为其余 **121 个源 ID** 交付包操作映射，为已映射工具补足未覆盖范围，提供正式签名包及收据；需要新 Host 能力时先提交版本化接口需求。Studio 再验真实 Host/Worker/Pi/View、权限、超时取消、失败隔离、结果接力、确认保存、原生界面和跨平台。完整接受 **0/154**，JSON Object 按用户决定保持禁用。见[接收记录](../iterations/2026-10-18-devtools-catalog-9c17-nine-packages-intake.md)与[逐项缺口](devtools-catalog-revision-gaps-devtools-catalog-2026-10-18-9c17b7b91e84f1c7.md)。下方旧数字和请求保留为历史过程，不代表当前修订。

**View 操作目录补充：**九包已在 Studio 隔离注册表通过安装准入，但 Agent Assist 2 项和 Spring 4 项仅在目录修订中映射，包内没有单项操作目录。请先按现有 `application.directory.v1` 为两包声明应用级类别/别名/用途；单项操作待 Studio 实现新版本化合同后再交付，不得伪造 capability。字段和验收向量见[接口需求](view-operation-directory-request-2026-10-18.md)。

**最新接收状态：**不可变修订 `devtools-catalog-2026-10-18-d084f541be736aed` 与 Diagnostics 0.1.4 已由 Studio 冻结和独立核验；Diagnostics 的 11 项输出契约与目录元数据静态预检通过。下文旧收据、Text 空引用、Diagnostics 0.1.3 的输出声明及 38 项目录缺失是历史过程；现存缺口为 JSON Object 2、Trace 2、Transforms 23 合计 27 项目录元数据、Spring 候选未映射、123 个源 ID 无包操作映射、正式签名包与真实运行验收。见[最新接收记录](../iterations/2026-10-18-devtools-catalog-d084-diagnostics-014-intake.md)，完整接受仍 0/154。

**交付进度（同日更新）：**提供方已交付独立不可变目录修订 `devtools-catalog-2026-10-18-3c7c5aa8ad679a14`；Studio 已逐文件与语义核验并冻结。下述活动工作树摘要和请求保留为当时证据；目录修订需求已满足，六份正式签名包、剩余源工具范围和运行验收仍未满足。见[接收记录](../iterations/2026-10-18-devtools-catalog-revision-intake.md)。

**下一修订的具体映射需求：**本次冻结 `package-map.json` 中 32 项标为 `candidate`，但 `spring-actuator` 的 `operationScopes=[]`，且不在六包 `sourceToolIds` 中。请提供方在下一不可变修订中明确它对应的独立候选目录、包 ID/版本、操作范围与包外收据；若该标签只指未纳入本次交付的外部候选，请明确标识其交付阶段，避免接收方把候选标签计为包覆盖。Studio 目前仅计 31 个源 ID 有具体包操作映射，完整验收仍 0/154。见[逐项清单](devtools-catalog-revision-gaps-2026-10-18.md)。

**六包收据与发现元数据需求：**Studio 独立审计六包实际 manifest，53 个映射操作均有声明能力，52 个 Pi 工具定义无悬空引用；但 Diagnostics、JSON Object、Trace、Transforms 共 38 项能力没有 `tool.directory.v1` 分类元数据。请下一候选版本按 Studio 目录协议逐项声明类别/别名/用途，不得在 Studio 内写死提供方分类。冻结修订复制的 Diagnostics、Inspect、Text、Transforms 四份旧收据目录索引仍为 `encoding-unverified`；提供方已有四份 `verification-revision-01.json` 经 Studio 逐文件核验为 matched，请下一不可变修订逐包更新收据摘要绑定。Text 七个操作的 `verificationReceipt` 仍为空，请逐项引用其真实包外收据或明确包级绑定规则。见[独立审计记录](../iterations/2026-10-18-devtools-six-candidate-audit.md)。

本页是 Studio 接收方的接口需求，不修改 ZiDevTools 源码、配置或独立程序。正式接入目标仍为全部 154 个目录条目；当前完整验收 0/154。历史冻结 dev.105 快照与逐项阻塞矩阵继续保留，不以活动工作树覆盖。

### 2026-10-18 连续只读观察（非交付快照）

提供方同一未提交活动目录的 `tools.json` SHA-256 又变为 `9bb3848d50b5516d4cea40638474d9a2db46df4d8f554008d456b9cb761b55f1`，`studio-plugin-migration.json` 变为 `b4908e05e509dc4239f261584bea9d766252daa3d6ef58742a0bb005c6a3637c`。HEAD 仍为 `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`，工作树状态 312 条，正式 `.zicode-plugin` 仍为 0。Studio 只读对比确认 154 ID 不增不减；相对冻结 dev.105 有版本/状态 76、scope 70、discovery **76** 项变化。此前 18 项 discovery 漂移仍在，新增 58 项多为关键词/别名补充（例如 Base64、YAML）；分类、搜索和包内目录收据必须引用同一不可变修订。此观察不更新冻结矩阵，也不提高 0/154 接受数。上述变化需由提供方给出新的不可变目录版本与包外收据；请勿继续使用已冻结的 `dev.105` 标识指代新字节。

07:45:52 +08:00 再次只读读取时，活动 `tools.json` 又变为 `37353db759bad2df4320990a55b6c5d32b81058e75f3e98fc39646d1afd0499d`，迁移表变为 `9a3a4c6a9be545f4d9b537058aeb6332015e41df1fb5804684b6532c3a287663`；仍是 154 ID、版本/状态 76、scope 70、discovery 76 项差异，未提交状态 312 条、签名包 0。两次摘要分别记录观察，不将移动中的源树称为正式目录版本。

针对后一份 `tools.json` 逐字段比较：关键词变化 75 项、别名 68、摘要 21、标题 8、分类 8；同一工具可能同时改变多个字段。Studio 百项搜索、分类和别名验收须用正式冻结的这一组元数据，不能仅以 154 ID 数量相同认定目录没有变化。

## 只读发现

2026-10-18 读取提供方活动工作树 `E:\zi-devtools`：HEAD `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`，工作树 307 条未提交状态，`docs/tools.json` 和 `docs/studio-plugin-migration.json` 均已修改。两文件都仍声明源目录版本 `0.82.0-dev.105`，条目数仍为 154，但内容已与 Studio 冻结的 2026-10-09 dev.105 不同：

| 文件 | 当前 SHA-256 | 冻结 SHA-256 |
| --- | --- | --- |
| `docs/tools.json` | `38f56d6b99ab8a201d236b95d5f6785d16111c3c8347087255813909623d480f` | `513391886d821c44a70b9096d7a96a327abb50b53d544293dea584bf72bb3727` |
| `docs/studio-plugin-migration.json` | `715a82103cf024b0f448411c354ab979db35739405d64840ce6d96697beba0dd` | `dac2650e837e34d3aba6617ef09ef5ad174d746f4de19bd038a008147980db48` |

Studio `compare-provider-catalog.mjs` 对当前目录及冻结基线的只读结果：新增 0、消失 0、版本或状态变化 76、scope 变化 70、discovery 变化 18；`--fail-on-drift` 退出 1。状态从冻结的“已实现 91 / 进行中 20 / 计划 43”变为活动目录的“已实现 92 / 进行中 35 / 计划 27”。16 项发生状态提升，其中 `time-zone` 为 planned→implemented，其余 15 项为 planned→in-progress：`artifact-hub`、`command-collections`、`explorer-menu`、`file-rename`、`json-schema`、`log-viewer`、`memo-library`、`ocr-documents`、`operation-permissions`、`planner-interop`、`plugin-market`、`plugin-updates`、`regex-replace`、`sql-format`、`task-runtime`。这些是提供方目录声明，**不等于 Studio 插件交付或运行验收**。

### 同日后续活动工作树（以此段摘要为最新只读观察）

后续再次读取时，`tools.json` SHA-256 已变为 `12ae70b20803ed6ffd1577c5e5fb8438f6eb2b44d10033d751810651aad557bc`，`studio-plugin-migration.json` 变为 `2834e6265c6a5105b03a5a171b9da59d1523ef4349e6c0c1b2601e2141aa285f`。上表保留首次观察的原始证据，不能把两次摘要混为一个不可变交付。活动目录仍为 154 ID（新增/消失 0），相对冻结 dev.105 的版本/状态 76、scope 70、discovery 18 项变化及 92/35/27 状态分布不变。迁移表相对冻结快照另有 19 项 `candidateCapabilities`、32 项 `packageId`/`packageVersion`、92 项 `operationScopes` 变化；154 ID 唯一且与冻结集合一致，但 `acceptedCapabilities` 仍为 0，`release` 下正式 `.zicode-plugin` 仍为 0。活动文件仍未提交且沿用 `0.82.0-dev.105` 标签。

因此下一版收据还需**逐项固定能力 ID、包 ID/版本、operation scope 和候选目录摘要**，明确同一源工具由哪些独立插件包覆盖，避免用旧 dev.105 标识指向两套内容。Studio 只接收具有版本与摘要绑定的包和矩阵，不按这份可变工作树提升 154 项接受计数。

当前两份活动文件的 ID 集合互相一致：各 154 条、重复 ID 0、互相缺失/多出 0；迁移表 `acceptedCapabilities` 仍为 0。这只证明目录映射没有漏 ID，不证明迁移分类、包或能力已经可用。

18 项 discovery 变化 ID：`agent-runner`、`artifact-hub`、`file-compare`、`file-intake`、`file-rename`、`java-thread-dump`、`json`、`json-schema`、`log-viewer`、`ocr-documents`、`pipeline`、`rag-keyword-search`、`recorder-tutorial`、`regex-replace`、`sql-format`、`sqlite`、`task-center`、`time-zone`。这会影响百项工具目录分类与检索的接收校验。提供方 `release` 下正式 `.zicode-plugin` 只读计数仍为 0。

## 请求提供方下一版交付

1. 给整份目录及迁移表一个**新的不可变源目录版本或修订 ID**，并提交对应源码/目录状态；不要用原 `dev.105` 标签覆盖已冻结字节。若版本号保持不变，必须提供独立、可追溯且不可变的目录修订标识，并在插件包/收据中引用其 SHA-256。
2. 提供版本化 `tools.json`、`studio-plugin-migration.json`、逐文件摘要及目录索引收据。明确 154 个 ID 的新增/移除/版本/状态/scope/discovery 差异和每项对应插件包、能力 ID、完整范围或局部范围、尚未支持原因；不要将 planned/in-progress 改名后视为已接入。
3. 对新声明的能力交付独立构建的插件候选和收据，再逐包提供签名 `.zicode-plugin`。清单必须声明实际能力、输入输出 profile、分类/搜索元数据、权限、超时与取消契约；Studio 不引用提供方仓库源码或运行 ZiDevTools EXE。
4. 对 16 项状态提升逐项给出可运行证据或仍缺的 Host 接口。尤其 `time-zone` 已标为 implemented，应说明其 IANA 时区数据版本、DST/歧义时间规则与跨平台向量；`file-rename` 等有写入能力的条目仍需显式预览、用户确认和回滚/错误契约。

## Studio 后续接收

收到不可变快照后，先核对两份源目录摘要及 154 ID/范围，再更新逐项矩阵并保留 dev.105 历史。接着逐包验证签名、收据、Host/Worker/Pi、真实原生 View 的“发现→按需加载→执行→展示→接力/确认保存”，并按 Windows、macOS、Linux 记录证据。只更新获得对应范围证明的接受状态；当前保持 0/154。
