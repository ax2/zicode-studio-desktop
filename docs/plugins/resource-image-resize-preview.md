# 图片缩放资源执行预览契约

状态：Studio Host 已实现 `resource.wasi.image.resize.v1@1.0.0-preview.1` 预览执行配置。ZiDevTools 已交付 0.1.1 未签名候选目录，但没有可安装的签名 `.zicode-plugin` 包；真实 package-to-result 流程仍未验收，完整工具目录也未完成。

## 范围

首阶段只覆盖单张 PNG、JPEG 或 WebP 的纯计算缩放及图片编码。Zi DevTools 当前候选能力 ID 为 `devtools.image.resize`；Host 协议按能力声明校验，不绑定提供方或固定能力 ID。不包含批量处理、裁剪/标注、EXIF 清理、OCR、持久图库、截图、流程实例 UI 或宿主文件路径访问；这些能力须按自己的输入/权限/取消/结果边界另行映射。

配置按 capability 生效，不能把更高预算授予同一插件里的全部工具。manifest `schemaVersion: 2` 的 `requiredProfiles` 声明 `resource.wasi.image.resize.v1: "1.0.0-preview.1"`，恰好一个 capability 声明 `executionProfile: "resource.wasi.image.resize.v1"` 且包含 `outputSchema`，不得声明 `resourceInputMax`。未声明时按现有通用 profile 执行；未知版本、错误字段或 capability 与 profile 不匹配时 fail closed。

WASI 输入/输出 framing 继续使用现有 Studio `resource.wasi.input.draft2` 与 `resource.wasi.output.draft1`。插件须同时声明 `output.schema.v1` 和 `resource.output.types.v1`；不能以 capability 输入输出约束替代 Host 的调用权限、资源身份、撤权或输出登记检查。

## 固定执行预算

| 资源 | 预览上限 |
| --- | ---: |
| WASM module 文件 | 2 MiB（沿用现行包边界） |
| guest Store memory | 每次最多 256 MiB，且最多一个线性内存实例 |
| Wasmtime fuel | 每次最多 30,000,000,000 |
| 墙钟 deadline | 每次最多 10 秒，含进程调用生命周期 |
| 输入 | 恰好 1 项；最多 32 MiB；MIME 必须为 `image/png`、`image/jpeg` 或 `image/webp` |
| 派生输出 | 最多 1 项、最多 32 MiB；MIME 必须为 PNG、JPEG 或 WebP |
| 图像维度 | 宽和高各不超过 4096，总像素不超过 16,000,000；由插件解码后校验，Host 不把 MIME/字节检查冒充像素验证 |
| 活动缩放并发 | 全局最多 2；同一插件最多 1 |
| 预留内存 | 每个活动调用按 512 MiB 计，其中 256 MiB guest、最多 96 MiB 输入副本、64 MiB 输出副本、96 MiB 运行时余量；profile 总预留最多 1,024 MiB |

预算由 Host 决定，manifest 只能 opt in，不能自报扩大数值。Host 在复制资源内容或 WASM module 前取得并发 lease；图片 profile 固定最多两个全局活动调用、同一插件最多一个，每个活动槽按 512 MiB admission reservation 核算，profile 聚合最多 1,024 MiB。lease 在 Worker 已退出、子进程回收且临时输入/输出均释放后归还。获取不到槽时立即返回可识别的 busy 错误，不排队、不启动 Worker。普通资源调用继续使用当前既有预算；全部 resource Worker 仍受 Host 全局调用槽约束。

512 MiB 是基于有界缓冲区与 guest 上限的并发准入核算，不是操作系统对子进程驻留内存的硬性 job limit。当前硬限制包括单个 256 MiB guest linear memory、输入/输出字节上限、子进程隔离和超时；完整接收验收还须在实际目标系统测量 Worker 进程峰值内存，并确认异常退出不会影响 Studio 主进程。若实测超过预留值，应收紧格式/尺寸边界或增加独立的跨平台进程内存限制后再接受。

30B fuel 为当前最大观测 22,532,110,853 的约 1.33 倍上限，不代表每次调用都会给插件无限运行。10 秒 deadline 为独立硬上限；先到的 fuel 或时间限制都终止调用。超预算、陷阱、损坏输入、格式不支持和超大尺寸必须返回稳定错误，不泄漏 panic、路径或输入内容。

## 权限、取消与结果

- 只接受用户逐次确认、由 Host 颁发且绑定 plugin、capability、资源 ID/contentVersion、scope 和权限代次的只读资源授权。插件不得读取绝对路径、环境变量、任意文件、网络或独立 ZiDevTools 进程。
- 复用 Host 的在途调用取消生命周期；Host 必须能终止同步解码/缩放中的 Worker 子进程，而不依赖 guest 主动轮询。取消/超时后不登记输出、不生成 resultRef、不写项目文件，且在确认子进程回收前不释放调用与资源 lease。
- 输出先登记为受限派生资源；显示预览、跨工具转交和保存各自保留现有用户确认。不得自动覆盖原文件，保存失败须可见并支持安全核对。
- 取消、撤权、插件禁用、Host 身份变化和资源版本变化都必须阻止迟到输出被显示、接力或保存。
- 首阶段不提供进度事件；不得假装只有 guest 内部进度就能取消同步图片 codec。若后续确需进度，另立有版本的事件/背压契约。

## 提供方构包与验收门

提供方须为该 capability 使用可移植 Rust 核心和独立 WASI adapter，使用 256 MiB module ceiling 构建，不改变通用 WASI 默认 ceiling；adapter 必须在权限之外拒绝超过 16 MP 的图像。manifest、输入输出 schema、格式/MIME、模块摘要、sourcescope 对照、fixtures、unsigned 状态及包外验证收据须齐全。WASI 与原生核心对固定格式样例做字节或语义一致性校验。

Studio 接收后逐项验证真实 package → catalog → permission → resource grant → worker → output registration → preview/transfer/save。资源测试至少覆盖 1–16 MP、4096 边长、损坏/截断/错误 MIME、透明 PNG、方向信息、三种输入格式、三种输出格式、32 MiB 边界、30B fuel、10 秒 deadline、并发 1/2/3、同插件第二调用拒绝、跨插件第二 slot、取消时立即/执行中/临近完成、撤权、Worker 崩溃、无迟到输出，以及 lease 回收。验证收据须带 package/module/Worker SHA-256、设备和执行配置；直连 Wasmtime 成功不能代替真实 Studio Host 验收。

首轮测量依据与当前失败见[图片接口需求](devtools-image-interface-requirements.md)和[提供方交接](E:/zi-devtools/docs/studio-image-workflow-handoff.md)。当前完整 DevTools 工具验收数仍为 0/154。

## Studio 实现与验证状态（2026-10-15）

- Manifest 协商现只接受 `resource.wasi.image.resize.v1@1.0.0-preview.1`，每个插件只允许一个声明该 profile 的 capability；能力 ID 由提供方定义。缺少匹配的 `requiredProfiles`、资源输入/输出 runtime、输出 schema 或 `resource.read` 声明时拒绝。
- Host 在复制资源与模块前取得 profile 并发 lease；Worker 只接受一项图片输入，校验字节数和 MIME；WASI guest 限制为单个线性内存实例、256 MiB、30B fuel 和 10 秒子进程 deadline。图片输出被限制为一项、32 MiB 和 PNG/JPEG/WebP。每个调用按 512 MiB admission reservation 计，最多两个全局调用（1,024 MiB），同一插件最多一个。该预留通过并发槽执行，不是操作系统对子进程驻留内存的硬限制；接收验收仍需核对各目标系统峰值内存和主进程隔离。输出仍经过既有 JSON schema、授权复核及资源登记。
- `bun run check:rust:static` 通过：`cargo check --all-targets`、Clippy（warnings as errors）和 `cargo fmt --check`。
- Worker 的 `ok:false` 结果现仅接受固定字段与已知错误码；Host 丢弃 Worker 提供的 message 并换成固定安全提示。失败调用须无输出资源，作为无资源的失败 result 返回；未知错误码、额外字段、超长 message 或失败帧附带资源均 fail closed。成功结果仍经声明的输出 schema 校验与资源登记。
- `cargo test --manifest-path src-tauri/Cargo.toml image_resize -- --nocapture`：5 passed、0 failed，610 filtered。新增失败信封白名单和路径/任意诊断文本丢弃用例。
- 已检查候选目录和外部收据；它仍是未签名目录，不能走签名包安装路径。尚未完成开发目录安装、catalog 发现、权限确认、资源授权、真实图片 Worker、结果预览/接力/保存和失败隔离的完整运行验收。提供方图片候选尚未成为可发布插件包，154 项全目录验收仍未完成；当前只能称 Host profile 已实现、接口定向测试通过。

### 0.1.1 Host HTTP 接收验收进展（2026-10-15）

DevTools 提供方 0.1.1 unsigned candidate 已按外部收据逐项复核并冻结到 `tests/fixtures/devtools-image-resize-candidate02/`，包外收据为 `tests/fixtures/devtools-image-resize-candidate02.verification.json`。Studio `bun run verify:devtools-package` 通过：7 文件、1,036,667 字节；index SHA-256 `9934cd3eb751fac04f064c141b696d70ffdbbc0dad503c397b0ba8c77d688ecb`；WASM SHA-256 `a38e4743475f33f8c04aed87e064c942067956d4d0a366a4a12e36371df8f77a`。候选签名仍为 false，未改动 ZiDevTools 仓库。

Studio 新增忽略运行的实际 HTTP Host 验收 `actual_http_devtools_image_resize_candidate_host_flow`。用 `bun run build:local` 生成的 Windows Debug EXE（123,575,296 B，SHA-256 `cbdf39e8389c7562529050d8358c6c27e59bb70c2f0c04e45a636e3e93cef595`）作为隔离 Worker，验收执行：冻结目录安装和 manifest/catalog capability 发现、明确 grant 后启用 `resource.read`、PNG 资源确认与读取、真实 WASI resize、Host 派生输出登记、资源读回 SHA-256 校验及解码尺寸核对。4×2 PNG 缩为2×1 PNG成功；损坏 PNG 返回固定 `INVALID_IMAGE`，没有输出资源，易失 Worker audit 记录 `ok=false` 与该错误码。定向真实 Host 测试1 passed；测试成功时会停止 Host 并清理其自有 scratch。

静态检查通过：cargo check all targets、Clippy warnings-as-errors；`cargo fmt --check` 仍提示已有格式漂移（advisory）。真实 HTTP Host + EXE + WASI 流程已验证，但原生窗口安装、工具结果 UI 截图/预览、接力保存与跨平台验收未完成。候选没有签名，未作为正式包安装；全目录完整工具验收仍非完成状态。

第一次验收尝试因测试先启用插件再授予必需权限而失败；修正为先授予后启用后通过。两次尝试各留下一个 scratch（合计 2,221,155 B）：
- `.cache/task-scratch/host-image-resize-7978e768-b72b-4a5a-8323-d70ee631d19b`
- `.cache/task-scratch/host-image-resize-f5a4ae4a-94fd-4af2-a2ea-42cea2d7a6b0`

清理这两个由本轮测试创建的临时目录时自动审批拒绝；根据项目规则不换方式重试，留给用户手工处理。

### 0.1.1 Windows 原生 Studio UI 验收（2026-10-16）

在隔离 Studio profile 中从候选目录安装并启用未签名的 ZiDevTools 图片缩放 0.1.1 插件；先验证未授权 `resource.read` 时启用被拒绝，再在 Studio 插件管理器授予该插件的资源读取权限。工具中心实际显示 24 个工具，找到并打开“缩放图片”动态工具面板。

通过 Studio 文件选择器选取项目 scratch 中的合成 4×2 PNG（132 字节），确认只向该插件提供本次调用的单张文件快照。输入 `png`、宽度 `2`、JPEG 质量 `85` 后执行。工具完成并返回 `ok=true`、`sourceWidth=4`、`sourceHeight=2`、`width=2`、`height=1`、`mimeType=image/png`、`byteLength=77`。Studio 将输出登记为派生资源，显示“结果尚未保存”，并可在本机预览为 2×1 图像。Windows 桌面截图为 1442×931，已实际目视检查；当前 Computer Use 截图不能导出为项目归档文件，故未伪称保存了截图证据。

点击“发送到工具”打开接力面板后，当前会话没有可接收该 image/png 输出的工具；跨工具接力尚未验收。没有触发保存，也未写入输出文件。当前验证证明的是 Windows 原生 Studio UI 上的候选安装、目录发现、按需打开、资源确认、动态工具执行和本机结果展示，不等同于签名包接受、保存确认、跨工具传递、失败隔离/取消、其他操作系统或 DevTools 全目录接入。DevTools 完整工具接受仍为 0/154。

## 2026-10-16 当前工作树重复验收补记

- 命令：`$env:ZICODE_TEST_RESOURCE_WORKER_EXE=target/debug/zicode-studio-desktop.exe; RUST_TEST_THREADS=2; cargo test --manifest-path src-tauri/Cargo.toml actual_http_devtools_image_resize_candidate_host_flow -- --ignored --nocapture`。
- 第一次运行在图片 invoke 返回 HTTP 409 时失败；当时断言未打印响应体，具体 Host 错误码未知。失败 scratch 保留于 `.cache/task-scratch/host-image-resize-0c221151-c0af-49dc-9dcf-3342d97194aa`，没有清理。
- 为该断言增加失败时打印 HTTP 状态和响应体的诊断。相同源代码与隔离 Worker EXE 连续两次通过，分别 7.37 秒和 6.34 秒；成功运行清理了各自 scratch。
- 当前 Debug EXE SHA-256 `A2121FA0D7E99726F88DB27E0BC08646E186392D12540A2AEFC1F5157F3E0DE8`。两次通过验证 PNG 资源输入、真实 WASI resize、Host 派生输出和内容读回；不能抹去第一次 409。若后续重现，诊断会输出 Host 响应体。
- `bun run check:rust:static` 在测试诊断改动后再次退出 0；`cargo fmt --check` 仍只报告 advisory 格式漂移。

该用例仍只覆盖 Windows 本地 HTTP Host/WASI 后端。原生 View 的插件发现/结果展示、签名包安装和 macOS/Linux 实际运行仍未验收。

Computer Use 复核（2026-10-16）：当前桌面状态返回 pps: []，没有可选的 Studio 原生窗口；没有生成或伪造截图，原生 UI 验收继续待补。
