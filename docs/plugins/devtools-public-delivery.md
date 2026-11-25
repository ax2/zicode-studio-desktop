# 在新机器上取得 ZiDevTools 插件

Studio 的工具中心可以安装独立的开发插件。v0.7.1 的公开源码保存了下表九个提供方候选目录和对应的外部收据。可只取需要的包，在安装前逐文件核验。具备完整 Studio 源码的机器可直接使用现有目录，无需再下载。

| 插件 ID 后缀 | 版本 | 包目录（相对 release） | 核对文件数 |
| --- | --- | --- | ---: |
| inspect | 0.1.2 | plugin-candidates/inspect-0.1.2-candidate-01 | 616 |
| text | 0.4.1 | text-plugin-0.4.1-candidate-02 | 112 |
| transforms | 0.1.1 | plugin-candidates/transforms-0.1.1-candidate-01 | 804 |
| diagnostics | 0.1.4 | plugin-candidates/diagnostics-0.1.4-candidate-02 | 653 |
| json-object | 0.1.1 | plugin-candidates/json-object-0.1.1-candidate-03 | 43 |
| trace | 0.1.1 | plugin-candidates/trace-0.1.1-candidate-01 | 352 |
| url-text-resource | 0.1.1 | plugin-candidates/url-text-resource-0.1.1-candidate-01 | 95 |
| spring-actuator | 0.1.1 | plugin-candidates/spring-actuator-0.1.1-candidate-02 | 42 |
| agent-assist | 0.1.1 | agent-assist-preview-0.1.1-candidate-02 | 6 |

## 只取一个包

以下 PowerShell 示例使用 Git 和 Node.js 获取 Inspect。选择其他候选时，替换前两行的包目录和收据文件名。收据名由完整插件 ID、版本和 `-verification.json` 组成。使用新的短目录存放勾选的文件，保留 Git 的冻结字节属性。

```powershell
$package = 'plugin-candidates/inspect-0.1.2-candidate-01'
$receiptName = 'com.zicode.devtools.inspect-0.1.2-verification.json'
$catalog = 'devtools-catalog-2026-10-18-9c17b7b91e84f1c7'
$dir = "tests/fixtures/$catalog-package-bundle/release/$package"
$receipt = "tests/fixtures/$catalog/package-receipts/$receiptName"
$commit = '01b44da4fd8432a43d78f73cf5c022f3c7c56b60'
$dest = 'studio-plugin-inspect'
if (Test-Path -LiteralPath $dest) { throw '请选择一个新的目标目录' }
git init -q $dest
git -C $dest config core.longpaths true
git -C $dest remote add origin https://github.com/ax2/zicode-studio-desktop.git
git -C $dest config remote.origin.promisor true
git -C $dest config remote.origin.partialclonefilter blob:none
git -C $dest sparse-checkout init --no-cone
@('/.gitattributes', '/scripts/verify-devtools-package.mjs', "/$receipt", "/$dir/") |
    git -C $dest sparse-checkout set --no-cone --stdin
git -C $dest fetch --depth=1 --filter=blob:none origin $commit
if ($LASTEXITCODE) { throw '未取得冻结提交' }
git -C $dest checkout --quiet --detach FETCH_HEAD
if ($LASTEXITCODE) { throw '未取得所选文件' }
$result = node "$dest/scripts/verify-devtools-package.mjs" "$dest/$dir" "$dest/$receipt" | ConvertFrom-Json
if ($LASTEXITCODE -or !$result.verified -or $result.directoryIndex.status -ne 'matched') { throw '插件包校验未通过' }
$result | Select-Object fileCount,logicalBytes,directoryIndex,signatureVerified
(Resolve-Path "$dest/$dir").Path
```

在 Studio 的插件管理中选择「安装本地插件」，打开命令最后一行列出的、包含 `plugin.json` 的目录，核对来源后确认安装。从 v0.7.9 起，安装后可直接核对权限用途，勾选所需权限并启用，或选择「保持停用」。无需权限的插件可直接按「启用插件」。启用后可从安装结果打开具体工具，也可在工具中心搜索。这些候选未签名。文件收据用于核对包的来源字节，各工具的实际功能和 Windows 验收范围见[逐项接入记录](devtools-all-tools.md)。

本次在空目录按以上命令从公开提交取得 Inspect，工作树中只有所选候选、外部收据、字节属性和核验工具。616 个文件共 2341254 字节，目录索引 SHA-256 为 `1d3af04bb9e35fa9594a673ff71058e56ffbb94e516f4086dba275472d1678ee`。当前 Windows Studio 的真实 Host/Worker 隔离测试用这份下载完成 8 项 Inspect 操作。其他八包在本次只复核了目录与收据。

## 可搜索的 Spring Actuator 只读诊断

Spring Actuator 0.1.3 候选在工具中心提供四个定位入口，分别打开服务健康、服务信息、指标目录和响应摘要。进入页面后还需选择端点并明确确认，本次请求才会发出。指标目录列出指标名称。

从 Studio v0.7.9 起，读取完成后在结果面板选择「将诊断结果另存为 JSON…」，选定位置和文件名，再确认写入。文件保存本次 Host 响应的 JSON 快照，包含端点、状态和已读取的 JSON 内容。只要结果仍在、权限有效，就可以取消后重新选址。

沿用上文的 Git 获取示例，保留末尾完整校验检查，并替换目录、收据及固定提交：

~~~powershell
$dir = 'tests/fixtures/devtools-view-operation-2026-10-18/spring-actuator-0.1.3-candidate-01'
$receipt = 'tests/fixtures/devtools-view-operation-2026-10-18/spring-actuator-0.1.3-candidate-01-verification.json'
$commit = '0117fdffa8604c879cd97a6c1aa146c3bee5288d'
~~~

目录 49 个文件，246194 字节，索引 SHA-256 为 `74f6bab2ed7c9ddbee2857aeac7cf4d875eda642900afbb0fb4fec31102f97cc`。安装开发插件后核对版本，再按需启用并授予 HTTP 只读权限。[Windows 隔离 Host 复现](https://github.com/ax2/zicode-studio-desktop/blob/main/tests/spring-actuator-conformance/README.md)

## Windows 安装包与五个文件工具包

已回下载 [v0.7.1 Windows 正式安装器](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.7.1)。文件为 369638351 字节，SHA-256 为 `0f0b5e88bde0815b32c8d0faf5a9da72a86389052dbf87a299ba75de82547937`。NSIS 文件清单包含 Studio EXE，未发现 `tool-packages` 目录或 `plugin.json`。安装 Studio 后需另行取得上述候选。

历史 Windows 候选曾在运行目录旁放置文件摘要、校验清单、编码转换、JSON 文件查询与对比、JSON 文件格式化与校验五个包，共 38 个文件。上表的 JSON Object 是另一个包。当时 Studio v0.7.1 与 ZiDevTools v0.82.0 的 Release 附件清单均未列出这五个独立包。五个包现在均可按下文各节获取。[历史交付回执](https://github.com/ax2/zicode-studio-desktop/issues/28#issuecomment-6969557942)

提供方交付每个新包时，请给出不可变的公开下载位置、插件 ID、版本、完整包目录和独立的逐文件收据（相对路径、字节数、SHA-256、目录索引哈希及其编码）。Studio 可用同一核验工具接收，再验证实际运行。包在提供方独立构建；用户安装、启用和授权分别进行。[跨机交付跟踪](https://github.com/ax2/zicode-studio-desktop/issues/241)

## 2026-11-22 复核 JSON 文件插件交付

Zi DevTools 的 [JSON 文件插件 PR](https://github.com/ax2/zi-devtools/pull/1) 已合入。复核[上游目录](https://github.com/ax2/zi-devtools/blob/0b5a2b76c9a38205bda7f00b5dec7283d706ba45/docs/tools.json)及[迁移表](https://github.com/ax2/zi-devtools/blob/0b5a2b76c9a38205bda7f00b5dec7283d706ba45/docs/studio-plugin-migration.json)，与 Studio 的 [Windows 验收矩阵](devtools-windows-current.json)对照，154 个源 ID 一致。上游列 JSON 源工具为 1.3.1，Studio 矩阵的 Windows 验收基线为 1.3.0。另有 10 个源版本不同，涉及 timestamp、uuid、color、http、random、curl-import、image-metadata、markdown、time-zone、regex-replace。curl-import 的源实现状态也不同。Windows 的完整 6、部分 51、未映射 97 是该矩阵日期和版本范围的记录。

上游迁移表列出 <code>com.zicode.devtools.json-file@0.1.0</code> candidate-02 的格式化、压缩和校验。Studio 已在隔离 Host 和真实 Worker 核验运行能力，原生文件选择及保存界面仍待本版复核。接入范围和历史输出边界见[专项记录](../iterations/2026-11-18-json-file-transform.md)。

上游的公开提交包含打包脚本，候选目录及外部收据未随该提交发布。v0.82.0 Release 无独立包，公开 Actions 也未找到仍可获取的对应文件。为接入 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)，请提供方发布以下两项并给出固定链接：

- <code>release/plugin-candidates/json-file-0.1.0-candidate-02/</code> 的完整目录，预期 7 个文件共 189,064 字节。
- <code>release/plugin-candidates/json-file-0.1.0-candidate-02-verification.json</code>。此前记录目录索引 SHA-256 为 <code>2bfa0a11291d4c291f50b2ecca042b42256817a5ff33b24861d5f4040107e2ad</code>。若重新构建导致字节变化，请分配新的候选标识，并发布匹配的独立收据。

Studio 另从提供方已固定的源码提交 <code>8476912755c0373660296aae358380df4f261689</code> 在隔离目录重建验收包 candidate-90。重建包 7 个文件、207,080 字节，目录索引 SHA-256 为 <code>756189d0e2f14e234caa3d2d28637f0c9e93cd6e94d8e5bceb005ae8c5e9ae75</code>。Windows 真实 Host/Worker 通过三项操作、结果确认另存和恰好 8 MiB 的输出回读。使用本机 Rust 1.88 和既有 WASI 目标，产物字节与 candidate-02 不同。跨机安装待提供方交付，桌面原生选择和另存也仍待验收。
## 2026-11-23 获取 JSON 文件工具

`com.zicode.devtools.json-file` 0.1.0 candidate-91 已随 Studio 公开源码提供。只下载此包时，可复用上方的稀疏检出命令。将 `$dir`、`$receipt`、`$commit` 和 `$dest` 更换为以下值，其余步骤相同。

```powershell
$dir = 'tests/fixtures/devtools-json-file-0.1.0-candidate-91'
$receipt = "$dir-verification.json"
$commit = '882182722ccc8cb897c79cb72efd7386463cc11b'
$dest = 'studio-plugin-json-file'
```

核验应显示 7 个文件、189,064 字节，`directoryIndex.sha256` 为 `0740629545823a99b9e212126a1bb9c743742648fe5546e783c603ce3f96eab2`。在插件管理安装通过校验的目录，启用后在工具中心搜索「JSON 文件格式化」「JSON 文件压缩」或「JSON 文件校验」。每次按提示确认共享文件和保存结果。

候选从提供方固定提交 `8476912755c0373660296aae358380df4f261689` 用 Rust 1.99.1 的 `wasm32-wasip1` 插件构建配置重新构建。模块 SHA-256 为 `244ac722fce1b1fec7d1d34ad79e7c21d8936aa56480cc12e0d8c307742af312`，与此前提供方 candidate-02 的模块字节一致。构建来源记录和逐文件收据属于本候选。已在开启 CRLF 转换的全新 Windows 目录按固定提交从 GitHub 回下载，七个文件和收据均保持原始字节。

本批真实 Windows Worker 和原生对照适配器通过 38 个正反例及 2 个身份和执行 profile 拒绝用例。隔离 Studio Host 安装后验证三项操作、取消写入、重复确认回执、撤权和确认另存。恰好 8 MiB 的输出逐字节回读，原文件保留。打开 Windows 原生文件选择和另存窗口仍待集中验收。候选独立安装，包为无签名开发目录。其余四个文件工具包见下一节。

## 2026-11-23 获取其余四个 Windows 文件工具包

在「只取一个包」的命令中，用下表的候选目录名替换示例中的文件路径和提交。每个候选独立安装。已装同一插件 ID 的旧候选时，在插件管理核对版本后再更新。

| 工具 | 候选目录 | 文件数 | 目录索引 SHA-256 |
| --- | --- | ---: | --- |
| 文件摘要与原文件接力 | `files-0.2.0-candidate-01` | 8 | `f43a2119309fbebe56aa58db427f53f74715a623e6e09042eb80f8751769a71b` |
| 校验清单生成与核对 | `checksum-manifest-0.2.0-candidate-01` | 8 | `501217f0cf455eb8f269cbeecb69c3f01e1267f6956f97ad64f01b95cc05426d` |
| 文件编码检测与转换 | `encoding-0.4.0-candidate-03` | 8 | `ed0ef3cbbbd46a718e861d8719df448c6beb6de6b442cecf1034afe6184886bc` |
| JSON 文件查询与对比 | `compare-json-file-0.1.0-candidate-02` | 7 | `690377f74a0f117702dec9cb759a91117e8777b31d304b1551f4d441e9b18dc0` |

下面以编码工具为例。其余步骤沿用「只取一个包」。

```powershell
$dir = 'tests/fixtures/devtools-windows-file-tools/encoding-0.4.0-candidate-03'
$receipt = "$dir-verification.json"
$commit = '7590da9a5afaeb23c831097911c5441e0f8e03ef'
$dest = 'studio-plugin-encoding'
```

这四个目录沿用提供方已交付的无签名候选及外部收据。各自 `provenance.json` 保留 `dirty: true`，所以固定提交和校验收据用于取得并复核本次验收的候选字节。在开启 CRLF 转换的全新 Windows 目录按固定提交回下载，31 个包文件与 4 份外部收据逐一匹配。

2026-11-23 用相同字节通过六次隔离 Windows Host 与真实 Worker 运行。文件摘要覆盖 96 MiB 文件、64 文件批次、进度、取消、撤权和原文件接力。清单覆盖确认目录、核对及生成。编码覆盖 8 MiB 检测和输入、七种编码转换、16 MiB 确认保存、冲突及原件替换。JSON 覆盖查询、有序与无序对比、明确确认后写入和结果字节回读。所有编码分支集中留在一个测试 Host 时曾收到 409，分到独立 Host 后各路径通过，未修改产品预算。原生文件选择与系统另存窗口仍列入集中验收。

## 2026-11-25 获取已验证的 Windows 工具候选

这一批将历史 Windows 矩阵中 16 个尚未映射的源工具带入 Studio。所列范围已在隔离 Windows Studio 用实际工具中心、Host 和 Worker 验证。20 个候选共 37 个按插件 ID 区分的能力入口。表中的验收记录写明输入限制和剩余的源工具功能。

按「只取一个包」的步骤，将示例中的 `$dir`、`$receipt`、`$commit` 和 `$dest` 替换成下方四项。选择其他候选时，只需将 `$package` 改成表中候选目录的最后一段。

```powershell
$package = 'service-config-0.1.0-candidate-01'
$dir = "tests/fixtures/devtools-windows-file-tools/$package"
$receipt = "$dir-verification.json"
$commit = 'b9c9310ff3dab4b244cf87d5289e672af4903c0e'
$dest = "studio-plugin-$package"
```

在插件管理安装通过校验的目录，审核所需权限，再从工具中心搜索验收记录列出的名称。每台机器各自安装和确认文件权限。这一批以独立、未签名的候选目录提供。

| 源工具（版本） | Studio 已验证入口 | 冻结候选与能力清单 | 收据 | 独立版仍待补齐的范围 |
| --- | --- | --- | --- | --- |
| 全能计算器 0.15.0（advanced-calculator） | [非线性方程求根](../iterations/2026-11-25-root-solver.md) | [root-solver-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/root-solver-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/root-solver-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/root-solver-0.1.0-candidate-01-verification.json) | 方程工作表、曲线图、变量持久化 |
| 全能计算器 0.15.0（advanced-calculator） | [公式计算器](../iterations/2026-11-25-expression-calculator.md) | [expression-calculator-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/expression-calculator-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/expression-calculator-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/expression-calculator-0.1.0-candidate-01-verification.json) | 原生工作表与变量持久化 |
| 全能计算器 0.15.0（advanced-calculator） | [矩阵计算](../iterations/2026-11-25-matrix-calculator.md) | [matrix-calculator-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/matrix-calculator-0.1.0-candidate-01) / [7 项](../../tests/fixtures/devtools-windows-file-tools/matrix-calculator-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/matrix-calculator-0.1.0-candidate-01-verification.json) | 原生工作表与多步接力 |
| 全能计算器 0.15.0（advanced-calculator） | [日期与工作日](../iterations/2026-11-25-date-calculator.md) | [date-calculator-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/date-calculator-0.1.0-candidate-01) / [4 项](../../tests/fixtures/devtools-windows-file-tools/date-calculator-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/date-calculator-0.1.0-candidate-01-verification.json) | 原生工作表与日期结果接力 |
| 全能计算器 0.15.0（advanced-calculator） | [数值统计](../iterations/2026-11-25-numeric-statistics.md) | [numeric-statistics-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/numeric-statistics-0.1.0-candidate-01) / [7 项](../../tests/fixtures/devtools-windows-file-tools/numeric-statistics-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/numeric-statistics-0.1.0-candidate-01-verification.json) | 原生工作表与统计结果接力 |
| Agent 记录查看器 1.1.0（agent-replay） | [Agent 运行记录检查](../iterations/2026-11-25-agent-record.md) | [agent-record-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/agent-record-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/agent-record-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/agent-record-0.1.0-candidate-01-verification.json) | 批量归档检索、超过 64 KiB 的记录 |
| 网页与对话收集 1.2.0（browser-clipper） | [本机 HTML 正文预览](../iterations/2026-11-25-local-html.md) | [local-html-0.1.0-candidate-02](../../tests/fixtures/devtools-windows-file-tools/local-html-0.1.0-candidate-02) / [1 项](../../tests/fixtures/devtools-windows-file-tools/local-html-0.1.0-candidate-02/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/local-html-0.1.0-candidate-02-verification.json) | 网页和对话采集、来源接力 |
| 万年历与日程 1.7.0（calendar-planner） | [ICS 日程预览](../iterations/2026-11-25-ics-preview.md) | [ics-preview-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/ics-preview-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/ics-preview-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/ics-preview-0.1.0-candidate-01-verification.json) | 日程写入、重复展开和提醒 |
| 工作区与工具集合 0.3.0（command-collections） | [工具集合导入预览](../iterations/2026-11-25-tool-collections.md) | [tool-collections-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/tool-collections-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/tool-collections-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/tool-collections-0.1.0-candidate-01-verification.json) | 实际导入、持久合并与提交 |
| 批量重命名 0.1.0（file-rename） | [批量改名预览](../iterations/2026-11-25-batch-rename-preview.md) | [rename-preview-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/rename-preview-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/rename-preview-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/rename-preview-0.1.0-candidate-01-verification.json) | 多选实际改名、提交复核及撤销 |
| 日志工作台 0.2.0（log-viewer） | [本机日志筛选与末尾预览](../iterations/2026-11-25-local-log-filter.md) | [log-viewer-0.2.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/log-viewer-0.2.0-candidate-01) / [2 项](../../tests/fixtures/devtools-windows-file-tools/log-viewer-0.2.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/log-viewer-0.2.0-candidate-01-verification.json) | 实时跟踪与超出末尾窗口的内容 |
| 备忘资料库互通 0.4.0（memo-library） | [备忘导入预览](../iterations/2026-11-25-memo-text-preview.md) | [memo-text-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/memo-text-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/memo-text-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/memo-text-0.1.0-candidate-01-verification.json) | 导入写入、批次合并和资料库恢复 |
| PDF 文本提取 0.0.0（pdf-text） | [提取 PDF 单页文本](../iterations/2026-11-25-pdf-page-text.md) | [pdf-text-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/pdf-text-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/pdf-text-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/pdf-text-0.1.0-candidate-01-verification.json) | 多页范围、扫描页 OCR、独立版完整交付 |
| 日程进阶与互通 0.1.0（planner-interop） | [ICS 重复截止预览](../iterations/2026-11-25-ics-count-cutoff.md) | [ics-count-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/ics-count-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/ics-count-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/ics-count-0.1.0-candidate-01-verification.json) | 农历生日、复杂例外和系统通知 |
| 提示词模板库 0.1.0（prompt-library） | [提示词变量检查和模板展开](../iterations/2026-11-25-prompt-expansion.md) | [prompt-expansion-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/prompt-expansion-0.1.0-candidate-01) / [2 项](../../tests/fixtures/devtools-windows-file-tools/prompt-expansion-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/prompt-expansion-0.1.0-candidate-01-verification.json) | 完整模板库、持久化及管理 |
| RAG 质量评测 1.0.0（rag-eval） | [检索评测报告复核](../iterations/2026-11-25-retrieval-review.md) | [retrieval-review-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/retrieval-review-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/retrieval-review-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/retrieval-review-0.1.0-candidate-01-verification.json) | 本机索引、数据集编辑与模型评测 |
| 文档解析与分块 1.4.0（rag-ingestion） | [DOCX 正文分块预览](../iterations/2026-11-25-docx-chunk-preview.md) | [docx-preview-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/docx-preview-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/docx-preview-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/docx-preview-0.1.0-candidate-01-verification.json) | 完整多格式解析、OCR、后续索引 |
| 本地知识源管理 1.2.0（rag-sources） | [知识源文件预检](../iterations/2026-11-25-knowledge-source-preflight.md) | [knowledge-preflight-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/knowledge-preflight-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/knowledge-preflight-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/knowledge-preflight-0.1.0-candidate-01-verification.json) | 递归扫描、内容读取和索引 |
| 本地服务管理 1.8.0（services） | [本地服务配置预检](../iterations/2026-11-25-service-config-preflight.md) | [service-config-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/service-config-0.1.0-candidate-01) / [1 项](../../tests/fixtures/devtools-windows-file-tools/service-config-0.1.0-candidate-01/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/service-config-0.1.0-candidate-01-verification.json) | 实际导入、服务启动、停止及管理 |
| 文本 / 表格流程 1.13.0（text-flow） | [文本流程配方检查](../iterations/2026-11-25-flow-recipe-inspection.md) | [flow-recipe-0.1.0-candidate-02](../../tests/fixtures/devtools-windows-file-tools/flow-recipe-0.1.0-candidate-02) / [1 项](../../tests/fixtures/devtools-windows-file-tools/flow-recipe-0.1.0-candidate-02/catalog.json) | [逐件 SHA-256](../../tests/fixtures/devtools-windows-file-tools/flow-recipe-0.1.0-candidate-02-verification.json) | 完整配方执行、批处理和工作流接力 |

Windows 全新稀疏检出启用 CRLF 转换后，20 份外部收据与 160 个包文件（6,914,976 字节）逐项匹配。核对了包身份、源工具 ID 以及清单声明的 37 个能力。来源版本来自 [ZiDevTools 目录提交](https://github.com/ax2/zi-devtools/blob/ebc79dc3ab9fa08c7240767b6e4289cb14f78dd7/docs/tools.json)。先前的 [154 项矩阵](devtools-windows-current.json) 保留 2026-10-30 冻结数据。各项业务验收沿用表中与同一冻结候选对应的 Windows 回执。

### Windows 同装与重开验证

将上述 20 包放在同一份专用 Windows 测试资料里，真实 Studio Host 逐一预览安装、审核并启用，按各包声明授予最少权限。37 个目录和详情条目均可独立定位，操作标识和工具访问标识无冲突。停止并重新打开同一资料后，已启用状态和权限保持，160 个已安装文件与冻结收据一致。公式、均值、模板和逐次授权的日志四个代表操作通过真实 Worker 复现。Host 回执 SHA-256 `4cb288b496a96e5852f2421aed2a2749ac8713841e312100590638b777ed5176`。

另将实际 Host 目录回执交给生产工具中心，在无窗口 DOM 审核 37 张工具卡与 20 个来源筛选。界面回执 SHA-256 `dc6a3aff10868c06db1a03b9eb03aeb6ebf800211ffff9abf3765493b1f4f609`。正式安装器、原生系统选取以及每个源工具的剩余操作继续沿各自验收记录跟进。[同装验收回执](https://github.com/ax2/zicode-studio-desktop/issues/26#issuecomment-7167949326)

## 2026-11-26 获取备忘备份提取和原尺寸图片转换

沿用「只取一个包」的步骤。候选与对应的逐件收据位于同一固定提交。将表中的目录用于 `$dir`，同名加 `-verification.json` 用于 `$receipt`。

| 源工具与来源版本 | Studio 已验证范围 | 冻结候选、能力和收据 | 固定 Studio 提交 | 独立版仍待补齐的范围 |
| --- | --- | --- | --- | --- |
| `memos` 1.5.0 | [确认一份备忘 JSON 后列出普通备忘，按原序号逐字节提取单条 Markdown。128 KiB、64 条以内，含空正文](../iterations/2026-11-26-memo-backup-extract.md) | [memo-backup-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/memo-backup-0.1.0-candidate-01) / [`devtools.memos.backup.markdown`](../../tests/fixtures/devtools-windows-file-tools/memo-backup-0.1.0-candidate-01/catalog.json) / [收据](../../tests/fixtures/devtools-windows-file-tools/memo-backup-0.1.0-candidate-01-verification.json) | `7c4a5ad8a41b11027926297a4e2059f7087f400d` | 资料库管理、备份恢复或合并、日程和提醒 |
| `image-tools` 1.7.1 | [确认单张静态 PNG、JPEG 或 WebP，保持原像素宽高转换并另存。分别验证三种输出、原件保护、撤权重启及动画拒绝](../iterations/2026-11-26-image-original-size-convert.md) | [image-convert-0.1.0-candidate-01](../../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01) / [`devtools.image.convert.original-size`](../../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01/catalog.json) / [收据](../../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01-verification.json) | `de354c40f2733e546854ea1e77cf024aa698cb29` | 批量、编辑、剪贴板和实例接力、拍摄元数据保留 |

这两个候选分别通过隔离 Windows Studio 的真实工具中心、Host 和 Worker，保存结果已逐字节回读。上节 20 包同装回执仍涵盖原批次。

逐件回读两批共 22 个候选、176 个文件（8,161,889 字节），以及 39 个按插件身份区分的能力。18 个源 ID 在 10 月 30 日冻结表中为未映射，本次为各自的部分范围提供实测入口。提供方两个固定目录的 154 个 ID 一致，`pdf-text` 仍是 0.0.0 / planned。来源见 [11 月 25 日目录](https://github.com/ax2/zi-devtools/blob/ebc79dc3ab9fa08c7240767b6e4289cb14f78dd7/docs/tools.json)和 [11 月 26 日目录](https://github.com/ax2/zi-devtools/blob/80544a5caf88ef3ec2ff70b1ce526ec07f43a742/docs/tools.json)。
