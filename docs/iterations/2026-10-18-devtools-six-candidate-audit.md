# DevTools 六候选包独立接收对账（2026-10-18）

## 目标与输入

Studio 对已冻结目录修订 `devtools-catalog-2026-10-18-3c7c5aa8ad679a14` 中映射的六个无签名候选包做只读复核。提供方根目录由命令显式传入，不添加跨仓库运行依赖，不安装、启用或调用任何候选。JSON 对象插件遵照用户决定保持禁用。

## 修改与发现

新增 `scripts/audit-devtools-catalog-candidates.mjs`：先验证冻结目录及六份目录内复制的包外收据，再核对实际候选目录的逐文件清单、插件 ID/版本、53 个操作到 manifest 能力的映射、Pi 工具定义、目录分类和逐操作收据引用。首轮将提供方 44 个短 `operationId` 误当作 manifest 缺失；复核每项的完整 `candidateCapabilities` 后，审计器已显式核对短 ID 与同项完整能力 ID 的绑定，最终真实未解析项为 0。

| 候选包 | 文件 | 源工具映射 | 操作/manifest 能力 | 目录元数据 | 冻结收据目录索引 |
| --- | ---: | ---: | ---: | ---: | --- |
| Diagnostics 0.1.3 | 503 | 11 | 11/11 | 0/11 | encoding-unverified |
| Inspect 0.1.2 | 616 | 5 | 8/8 | 8/8 | encoding-unverified |
| JSON Object 0.1.0 | 37 | 1 | 2/2 | 0/2 | matched |
| Text 0.4.1 | 112 | 4 | 7/7 | 7/7 | encoding-unverified |
| Trace 0.1.0 | 346 | 2 | 2/2 | 0/2 | matched |
| Transforms 0.1.0 | 798 | 9 | 23/23 | 0/23 | encoding-unverified |

六包合计 2,412 个文件、53 个 manifest 能力、52 个 Pi 工具定义；31 个不同源工具被映射（JSON 同时由两个包覆盖）。所有文件清单、包 ID/版本、映射能力与 Pi 定义匹配，但这只证明声明一致，不证明算法或运行。四包共 38 项能力缺 `tool.directory.v1` 元数据，百项工具的来源/分类搜索会退化；Text 的七个操作在修订映射中 `verificationReceipt=null`，尽管包级收据副本存在。

另只读核对提供方后续的四份 `verification-revision-01.json`：Diagnostics 503/503、Inspect 616/616、Text 112/112、Transforms 798/798 文件及目录索引均为 matched。这些修订收据未被当前冻结 `package-map.json` 的 `receiptSha256` 绑定，不能悄悄替换已冻结修订；下一不可变目录修订需明确绑定它们。当前正式 `.zicode-plugin` 计数 0。

上述三项接口需求已发给获授权的 `zi-devtools` 原会话；后续提供方修订仍需 Studio 独立复核。

## 验证与边界

同日续进：接收审计进一步核对提供方当前包外收据的 SHA-256 必须等于冻结修订绑定值，且每项 `operationScopes.verificationReceipt` 必须指向所属包的同一份收据；空引用仍单独计数，错指向其他包或其他收据则拒绝整个候选对账。六包重新只读审计退出 0，六份当前收据摘要匹配、53 项操作无错指向；Text 的 7 项空引用仍保留为缺口。Node 语法与 Biome 定向检查通过。这是接收映射约束，不构成工具执行或签名验收。

本次续进前后空间扫描的 `target` 均为 30,041,815,353 逻辑字节、`UnknownEntries=0`；E: 可用分别为 7,544,832 和 7,974,912 字节。两次扫描均因低空间提示退出 1；未清理缓存，卷空闲变化不计为本轮收益。

后续接收门槛补齐反向映射：包内每项 manifest 能力必须被至少一项冻结目录操作覆盖，能力 ID 不得重复，Pi 工具名不得为空或重复；多个源工具可合法共用一项能力。六包当前 53/53 能力双向匹配，未映射能力 0、重复 Pi 名 0；Node 语法、Biome 与六包只读审计通过。该检查防止后续新增能力未进入 154 项目录时被接收审计漏计；它不改变目前 31 个源工具候选映射及 0/154 全量接受。

本轮前后空间扫描的 `target` 均为 30,041,815,353 逻辑字节、`UnknownEntries=0`；E: 可用由 7,741,440 变为 7,532,544 字节。低空间提示令扫描退出 1，未进行 Rust/Tauri 构建或缓存清理。

放宽合法的多源工具共用能力后，再次运行 Node 语法、Biome 和六包审计均通过；收尾空间扫描 `target` 与文件数不变，E: 可用 7,634,944 字节，仍低于储备线。

再次接收时，六包审计复用 Studio 的只读 manifest profile 预检，并逐包输出 `manifestPreflightIssues`。Diagnostics 0.1.3 的 11 项能力均没有 `outputSchema`/`maxResultBytes`，却声明了 `output.schema.v1`，出现 `declared_without_output_contract`；其他五包未见这项静态声明错误。该问题意味着 Diagnostics 候选须交付新版本后再走 Host 安装门槛，不能因为 53/53 目录映射通过就计为可安装。接口需求已发到获授权的 DevTools 原会话，要求新不可变候选补合同或移除未使用 profile，并提供新包外收据。静态预检不证明其余五包能在真实 Host/Worker 安装或运行。

本轮前后空间扫描 `target` 均为 30,041,815,353 逻辑字节且 `UnknownEntries=0`；E: 可用从 8,081,408 变为 7,929,856 字节。两次扫描都因低空间提示退出 1，未清理缓存或构建原生程序。

审计命令：`node scripts/audit-devtools-catalog-candidates.mjs --provider-root E:\zi-devtools`，退出 0；Node 语法、Biome 定向 lint 通过。完整输出保存于技术博客 `iterations/devtools-six-candidate-audit-2026-10-18/evidence/audit.json`，SHA-256 `BE376C63724BD832893D77458D3D71054A1A659FA1D05F023F4828D81D5F42C3`。本次不修改提供方或包文件，不增加本地候选副本、运行目录或截图；E 盘空间不足，未构建 Rust/Tauri。正式签名、完整 scope、权限、取消、结果接力、原生界面与跨平台验收均待；DevTools 完整接受仍 **0/154**，ZiFile **0/108**。

前后 `storage-budget.ps1` 均为 `UnknownEntries=0`，项目 `target` 均为 30,041,815,353 逻辑字节；E: 可用分别为 7,786,496 和 8,171,520 字节。低空间提示使两次只读扫描退出 1，卷差额不代表本轮释放了缓存。
