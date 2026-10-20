# Inspect 0.1.2 工具直达候选只读接收（2026-10-18）

## 目标和范围

Studio 的 `tool.open.v1 = 1.0.0-preview.1` 接收侧已存在，但此前只用 Studio 自有合成插件验证。ZiDevTools 交付 `com.zicode.devtools.inspect` 0.1.2 无签名目录候选，声明此 profile，目标是让工具目录中的 8 个具体能力定位其自有主 View。此次只读审查 `E:\zi-devtools\release\plugin-candidates\inspect-0.1.2-candidate-01` 和包外 `inspect-0.1.2-candidate-01-verification.json`；没有修改提供方目录、安装或启用插件，也没有更改用户选择暂不启用的 JSON 对象插件及其权限。

## 实际核对

- Studio `scripts/verify-devtools-package.mjs` 按包外收据逐相对路径、字节数及 SHA-256 比较，**616/616 文件、2,341,254 逻辑字节全部匹配**；收据 SHA-256 为 `2c5a158139de83c71d1ed889683a862867ad1bd3771c382210bdee3df052a51c`。工具报告 `signatureVerified=false`、`runtimeAccepted=false`、`fullToolAcceptance=false`。
- `scripts/check-plugin-manifest-profiles.mjs` 对候选 `plugin.json` 返回 `issues=[]`、`preflightOnly=true`、`hostAccepted=false`。清单 schemaVersion 2、包版本 0.1.2、8 个能力、一个主 View；目录合同和工具直达合同均精确声明 `=1.0.0-preview.1`。`catalog.json` 映射仍为 8 个能力，来源修订 `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8` 且标记 dirty。
- `runtime/tools.wasm` 与现有 0.1.1 candidate-02 的 SHA-256 均为 `1db3fc37df01cd3a8371320d4f897a7fdf750c87e6202b736ed6870f046b8f29`。此次没有重新执行 8 个算法；前版验收不能自动转移到新包的 View/Host 生命周期。
- `verification/tool-open-vectors.json` 声明已知能力定位、未知 ID 拒绝、慢回调超时三类提供方样例；`views/main.html` 注册 `navigation.onOpenTool` 并按完整能力 ID 选中操作，静态检查没有看到定位回调直接调用 `capabilities.invoke`。这些是源码/提供方记录，不是 Studio 实际 Host/View 回执、原生截图或跨平台结果。
- 清单 8 个能力 ID、catalog 8 个 ID、定位向量 mapping 的 8 个键集合相等，向量 View ID 与清单主 View ID 均为 `devtools.inspect.main`。这只验证静态一致性，不证明 View 回调按向量运行。

## 阻塞：包外目录索引编码降级

0.1.1 candidate-02 的包外收据以结构化 `directoryIndexEncoding` 指定 SHA-256、UTF-8、文件列表顺序、键顺序、JSON 分隔符、非 ASCII 编码及末尾换行规则。0.1.2 candidate-01 把它换成自由文本 `"sorted paths; compact UTF-8 JSON array of {path,size,sha256}; non-ASCII unescaped; no trailing newline; SHA-256"`，使 Studio 的独立校验器返回 `directoryIndex.status="encoding-unverified"`。按收据现有文件列表顺序使用固定 `{path,size,sha256}` 键和紧凑 UTF-8 JSON 独立重算，得到 `1d3af04bb9e35fa9594a673ff71058e56ffbb94e516f4086dba275472d1678ee`，与声明值相等；这项手工重算不能代替机器可识别编码契约，也不证明提供方宣称的排序规则已被 Studio 校验。

请提供方**保留当前候选及旧收据作为证据**，仅新增包外修订收据，例如 `inspect-0.1.2-candidate-01-verification-v2.json`，恢复上一候选的结构化编码对象并让收据中的目录索引摘要与文件列表继续一致；若包内字节也要变，则另出新候选与新完整收据，不原地覆盖。Studio 会重新独立运行逐文件校验，要求 `directoryIndex.status="matched"`，并检查新旧收据间的差异。具体字段和验收命令见[提供方接口需求](../plugins/inspect-012-receipt-interface-request.md)。

Studio 接收脚本随后收紧命令行出口：声明了目录索引摘要却因编码描述不可校验时，仍输出已核实的逐文件报告，但进程退出 1，防止只看退出码的自动接收误判。`scripts/verify-devtools-package.test.js` 33/33、`bun run check` 通过。当前 0.1.2 候选实际运行结果是 `verified=true`、616 文件、`directoryIndex=encoding-unverified`、退出 1；旧 0.1.1 candidate-02 的结构化收据是 612 文件、`directoryIndex=matched`、退出 0。`verified` 只说明文件清单核验通过，不代表目录索引或运行接受。此脚本变更不读取/修改提供方以外的数据，也不安装插件。

检查前后 `scripts/storage-budget.ps1` 均有 `UnknownEntries=0`，`target=30,039,229,199 B`、`.cache/task-scratch=1,333,041,652 B` 未增加；E 盘空闲 8,283,758,592 → 8,282,685,440 B，仍低于保留线，脚本退出 1。卷空闲的小幅变化未归因于本轮只读核验，未清理既有缓存或此前被审批拒绝的目录。

## 后续真实验收

收据修复只是接收前置。Studio 还需在隔离 Host 中核对安装/禁用/启用后的 View 读取和目录摘要，实际工具目录点击 → 主 View 定位回执，并覆盖未知 ID、超时、旧帧/旧会话、项目切换、撤权及失败不影响其他工具；原生界面截图和支持的 OS 需要单独记录。正式签名容器、完整 Inspect 来源工具范围和 ZiDevTools 154 项全工具目标也未因此完成，矩阵 `fullToolsAccepted` 仍为 0。

## 修订收据到达后的续验

提供方新增包外 `inspect-0.1.2-candidate-01-verification-revision-01.json`，保留原候选及旧收据。Studio 独立比对新旧收据：`files` 数组完全相同，仅 `directoryIndexEncoding` 从文字描述变为结构化对象。新收据 SHA-256 为 `29afb75e81cea5e7606ad238708b6bef796809eb1df8ee9ab58e66b1b011c202`。现有 Studio 校验器对原候选加新收据返回退出 0、`verified=true`、616 文件、2,341,254 逻辑字节、`directoryIndex.status="matched"`；摘要 `1d3af04bb9e35fa9594a673ff71058e56ffbb94e516f4086dba275472d1678ee`。因此原先的机器可识别收据阻塞已解除。它仍是无签名候选，`signatureVerified=false`、`runtimeAccepted=false`、`fullToolAcceptance=false`。

Studio 增加独立的 Inspect 0.1.2 Host/View 生命周期专项（`current_inspect_tool_open_candidate_survives_real_host_view_lifecycle`），只在显式给定候选和修订收据路径时运行，使用带归属标记的隔离暂存目录；不会改动当前桌面用户配置或用户选择禁用的 JSON 对象插件。运行结果、空间预算及剩余范围另记于本节后续记录。

该专项在 Windows 上以 `RUST_TEST_THREADS=2` 单独运行，**1/1 通过**（其余 705 个主测试被过滤），耗时 2.51 秒，编译复用项目 `target/debug`。它对源候选和安装到隔离 Host 的副本分别用修订收据校验；真实 Host 安装后返回版本 0.1.2、默认禁用、`toolOpenProfile=true`、8 项不含输入 Schema 的列表摘要。带桌面令牌读取主 View：禁用时 403，测试隔离注册表中临时启用后得到 `devtools.inspect.main` 和包含 `navigation.onOpenTool` 的 HTML，再禁用后恢复 403。专项成功后删除**该测试自己创建**的暂存目录。没有修改用户配置或实际插件开关。

`bun run check:rust:static` 通过（`cargo fmt --check` 提示已有格式差异，仅 advisory）。此证据是 Host 安装/列表/View 读取生命周期，**尚未覆盖**目录点击后的实际 View JS 定位回执、未知 ID 与超时、旧帧/场景切换、原生截图、签名包及跨平台。`runtimeAccepted` 与 `fullToolAcceptance` 仍不应标为 true；完整 DevTools 154 项接受数仍为 0。

测试后空间盘点：`UnknownEntries=0`，`target=30,036,693,723 B`，`.cache/task-scratch=1,333,041,652 B`（与本次测试前相同），E 盘空闲 `8,286,306,304 B`。脚本因既有 target/scratch 超预算及空闲低于保留线退出 1，属于预算提示；没有创建新的完整 Debug/Release 运行目录，也没有删除缓存或重试此前被拒绝的清理。

## 真实候选 View 定位回执专项

新增仅在显式设置 `ZICODE_TEST_INSPECT_012_DIR`、`ZICODE_TEST_INSPECT_012_RECEIPT` 时执行的 `public/native/plugins/inspect-012-provider-tool-open.test.js`。它先用 Studio 收据校验器确认候选原件 616 文件与目录索引，再把候选实际 `views/main.html` 脚本装入隔离 JSDOM，与 Studio 当前 `sandboxBridge` 通过真实消息结构连接。候选脚本完成 SDK ready/context 握手后，清单中的 8 个能力 ID 逐一发送 `openTool`；8/8 均得到 `opened`，实际 `#operation` 与提供方映射向量一致、焦点进入输入框。未知 ID 得到 `not_found` 且不改变当前操作；定位消息期间 `invokeCapability` 请求数为 0。另给 Studio SDK 增加慢回调专项：4 秒输出一次 `unsupported`，迟到的 `opened` 不会成为第二次回执。

Windows 定向运行两个文件合计 4/4 通过；`bun run check` 退出 0（现有仓库 lint/design 提示仍在）。此专项执行候选原始 View JS 与 Studio SDK，但**没有实际 Tauri WebView、真实工具目录点击或原生窗口截图**；慢回调使用 Studio SDK 合成处理器，并非提供方候选故意延迟的操作。Host 的安装/权限、View 的定位回执和真实桌面链路仍为不同证据层级；本次结果不改变签名、跨平台或 154 项完整工具接受状态。

本次前后空间盘点 `UnknownEntries=0`：`target=30,036,693,723 B`、`.cache/task-scratch=1,333,041,652 B` 均未增加；E 盘空闲 `8,285,990,912 → 8,238,583,808 B`，其变化未归因于本次只读浏览器层验收。脚本仍因既有预算/保留线提示退出 1；未执行清理。

## Studio 工具目录到主 View 的接线验收

新增按需执行的 `public/native/plugins/inspect-012-shell-entry.test.js`。它先核验提供方原目录及修订收据，然后从实际 `plugin.json` 生成 Host 摘要，用真实 `ToolCenterApp`、`plugin-shell` 和 `plugin-view-host` 连接一个受控的隔离页面。通过界面操作“Open tool”→“Open application”后，Studio 切换到 Inspect 主 View，读取候选原件 `views/main.html`，在主 iframe ready 后发送 `openTool`，能力 ID 与所选目录项相同；测试模拟该 iframe 的 `opened` 回执，Studio 接受回执，没有调用 `capabilityGateway.invoke`。Windows 定向专项 1/1 通过，`bun run check` 退出 0（仓库既有 lint/design 提示）。

此专项覆盖 Studio React 目录、应用切换与 View Host 交界面；View 在 JSDOM 中的 iframe 不执行原生 WebView 脚本，所以下游 `opened` 回执由测试模拟。前一专项独立执行了候选真实 View JS 与 Studio SDK 的 8 项回执；两项证据共同缩小链路缺口，但不能替代原生 Tauri 窗口截图和完整一体化人工操作。测试没有更改用户配置或插件权限，完整工具接受数仍为 0/154。

随后启动当前 `target/debug/zicode-studio-desktop.exe`，显式使用新建的 `.cache/task-scratch/inspect-012-native-20261018/profile` 隔离配置。实际窗口显示此隔离工作区路径，工具中心和插件管理界面均可读取；文件夹选择框已导航到提供方 `inspect-0.1.2-candidate-01`，尚未点击“选择文件夹”。点击前再次运行 Studio 校验器，仍为 616 文件、2,341,254 字节、目录索引 `matched`。computer-use 技能规定 Windows 界面安装新软件前必须即时确认，因此已向用户单独请求此次隔离配置安装授权；**当前未安装、未启用、未变更权限**。隔离验收目录有归属标记，启动后观察为 423 文件、78,670,926 逻辑字节；后续仅在确认无消费者和归档证据后按项目规则处置。

原生准备后的空间盘点：`UnknownEntries=0`，`target=30,036,693,723 B` 不变，`.cache/task-scratch=1,411,786,547 B`（启动前 1,333,041,652 B，新增主要来自上述隔离配置）；E 盘空闲 `8,195,899,392 B`，仍低于项目保留线。预算脚本退出 1 是容量提示，不表示本次原生启动失败。未新建完整应用运行目录或清理旧缓存。
