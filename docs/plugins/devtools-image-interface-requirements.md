# DevTools 图片工具接入接口需求

## 2026-10-16 接收端 MIME 声明增量要求

下一份独立构建的图片插件候选需要在每个接收资源的 capability 上声明 `requiredProfiles["resource.input.types.v1"] = "=1.0.0-preview.1"`，并设置 `resourceInputMimeTypes`。`devtools.image.resize` 的当前输入范围应明确列为 `image/png`、`image/jpeg`、`image/webp`；列表必须是 1–32 个互异的小写 ASCII `type/subtype`，不接受参数或通配符。实际解码器支持范围、输出 MIME、大小/像素限制和错误码仍要按能力分别交付，不可仅凭此声明推断。提供方需交付新的独立包、manifest、逐文件摘要及有效/不支持 MIME 的端到端收据；Studio 将在发现、目录筛选、详情、转交准备/提交及 Worker 执行处复核。冻结在 `tests/fixtures/devtools-image-resize-candidate02/` 的旧候选保持不变，当前不满足新的类型化接收目录要求。协议详见 [资源输入类型声明](resource-input-type-declaration.md)。

日期：2026-10-09。来源：dev.95公开目录快照（154项），逐项状态见全工具矩阵。本文件是给提供方与Studio后续开发的接口需求，尚非已发布协议；不能按它声明Host支持。独立版继续独立运行，禁止通过共享路径/配置或启动独立程序接入。

## 覆盖范围

2026-10-09只读目录补核到dev.95，仍154项：7项版本/scope变化，image-workflow现0.5.0，声明实例操作接入统一任务中心、按实例/任务版本取消和打开、关闭后终态保留，并增加选择已有实例时身份/修订复核及确认替换；公共插件端口和全局内存预算仍待完成。该声明不是本会话的原生运行证据；Studio的8项资源工作配额与提供方工作实例/任务是不同层级，没有自动映射。

image-tools、image-batch、image-crop-annotate、image-metadata、image-workflow需要资源能力；screenshot-workbench另外需要逐OS采集授权。已实现的子操作可以先打包，流程和截图剩余功能继续单独记录。image-workflow当前0.5.0尚在开发，不能标为完整接入或永久不兼容。

## Studio需要定义并实现的接口

Host已开始实现[资源输入授权候选draft.4](resource-input-contract.md)：内存分块草稿、明确确认、版本绑定读取和撤销，隔离View读取SDK和可信父窗选择/确认/引用交付。Windows实际Tauri输入确认/读取/撤销已用Studio验收fixture验证；操作系统文件对话框、真实DevTools资源包和WASI图片任务仍待接入/验收，不替代下列完整要求，也不是resource.v1支持声明。

1. **资源授权与版本**：用户主动选择后创建不泄露本机路径的会话资源句柄；绑定运行实例、会话、授权范围、资源版本和有效期。拒绝跨实例、已撤权或旧版本读取；采集资源单独请求授权，不能把文件选择授权当截图/剪贴板授权。
2. **有界二进制输入输出**：声明媒体类型、编码、字节数、像素数及摘要；资源读取分块并有总预算、超时、进度和取消。输出经Host登记并用于可信预览；不能塞进首批8192字节text字段或将Base64视为已解决图片协议。禁止解码膨胀绕过像素/内存限制。
3. **结果接力**：用户选择目标操作后固定源结果版本与来源工具/版本链、目标schema及资源权限；目标已有工作或后台任务冲突时预览并明确确认。取消保留原工作，变化后的材料拒绝复用旧报告；元数据/图片不自动进入模型、日志或其他工具。
4. **确认保存**：Host展示目标、新建/覆盖意图与冲突；单次批准绑定实际结果版本及输出清单。默认无覆盖，写入完整后发布，失败清理本次临时材料并保留既有文件。批处理取消停止未发布项，已发布项明确列出，不能声称回滚；覆盖另需专门授权和恢复方案。
5. **流程与任务**：步骤版本、裁剪坐标空间、方向处理、实际编码及报告schema固定；逐步预览与累计资源预算。独立任务ID、取消状态和完成状态分开，插件失败不能阻塞主界面或其他工具。流程定义导入/另存属于显式数据操作。
   提供方工作实例ID与任务ID需要在操作/结果中固定；切换/关闭不能让旧后台结果落入新工作实例，关闭时释放专属授权与任务。跨实例接力须再次绑定目标并确认；独立版流程库不能成为Studio共享配置或数据依赖。现有输入Owner只有Pi运行实例/会话/插件/能力，不代表此工作实例协议已实现。
6. **采集/字体/平台**：截图、剪贴板与本地字体采用独立版本化desktop扩展，列支持OS/设备与拒绝行为。当前纯WASI取消证据不代表系统采集、字体加载或图片任务已支持。

## DevTools需要交付的内容

Studio另有[内部资源Worker输入承载候选draft.1](resource-worker-input-candidate.md)：有界原始二进制帧、摘要核对与WASI只读imports。后续draft2已有可信父窗Host候选路由，见[Host资源计算接口](resource-worker-host-candidate.md)；尚未发布manifest profile，不得据此交付声明完整兼容的资源包。该候选不含二进制输出，新任务预算、真实图片峰值及Host并发/生命周期仍需双方固定后验收。

- 每个已实现子操作的独立插件包、工具版本、严格输入输出schema及可携带fixtures；不包含独立程序配置/状态、公司运行环境或Studio仓库引用。
- 明确PNG/JPEG/WebP、动画拒绝、方向/透明度/元数据处理，以及输入32MiB/1600万像素等来源限制。提供编码精确大小与摘要，保证声明限制与真实实现一致。
- 提交实际解码/编码峰值内存与时间/fuel证据。现有compute.wasi.v1为64MiB内存、256KiB Worker请求及五秒预算；1600万RGBA像素本身已约61MiB，不能默认连同源材料、编码器和输出一起容纳。新的资源执行profile须另定预算与传输，不扩大或伪称现有首批协议支持完整图片范围。
- 正常、空/损坏/超限、旧资源、撤权、目标冲突、处理中取消、失败恢复、报告过期及结果接力用例；截图另交逐OS、混合DPI/多屏证据。
- 对每个工具列完整scope与当前包覆盖的子集。当前目录的独立版implemented只作为来源声明，不能代替插件实包验收。

## 验收条件

2026-10-09补充：Studio自有资源计算包已在实际Windows Tauri与真实Pi正式会话完成SDK→父窗→Host→当前EXE WASI→结果显示，同次300000字节确认材料、资源撤销拒绝、权限拒绝/重新授权新材料恢复和实际截图通过。见[Host候选原生记录](resource-worker-host-candidate.md)。这是通用资源输入计算验收，未运行DevTools图片算法，也没有二进制结果；不能替代以下提供方包完整验收。

先发布版本化契约与一致性检查，再用实际Studio完成发现→按需加载→输入授权→执行→展示→接力→确认保存；同时检查取消、失败隔离、撤权/旧版本、冲突及支持OS。未交付或未实现的能力继续保留具体理由、责任方与重开条件。现有text结果链与dev57五能力证据不能计作上述图片工具通过。

### 2026-10-10 Worker输出基础候选

Studio新增内部[resource.wasi.output.draft1](resource-worker-output-candidate.md)：原始字节帧、最多四项合计32MiB、guest分块写入及封存。仅限输入draft2显式选择；生产Host登记/预览/接力/保存仍待，不是提供方可直接声明的正式profile。请保持现有冻结包；实际图片编码器和正式输出资源映射须待Host接口完成后另发版本化候选。

## 2026-10-10 Host输出登记候选

Worker输出已接入[Host派生资源登记](resource-host-output-candidate.md)。需manifest精确选择resource.wasi.output.draft1；输出仅原owner可读取/继续执行，原输入撤销或过期级联失效，共享32条/128MiB总预算。尚无可信图片预览、跨工具转授权和确认保存，请勿直接把本候选视作正式profile或改动已有冻结包。

## 2026-10-11 文件输入发现提示
Studio新增[file.input.hints.v1 预览契约](file-input-hints.md)，按能力声明真实后缀或明确anyFile，协商1.0.0-preview.1；声明缺失保持未知可见。应交付新包/摘要/正反例，不修改冻结包；发现匹配不代替读取授权、内容验证或实际算法接受。新自有夹具真实目录3/4切换、确认执行及旧夹具兼容通过，提供方实包/完整工具仍待。

## 2026-10-15 image-workflow 交付状态与 Host 预算核对

ZiDevTools 原开发会话报告当前 `image-workflow 0.10.0 / in-progress`，流程定义 schema v1、动作 v1、`image.info` 报告 schemaVersion 2。新图片→文本接力 UI 在浅色/深色原生窗口中通过：选择目标后才确认；确认创建独立流程实例；图片输入有效、流程不会自动运行、来源图片保留。单测 `image_material_produces_versioned_report_and_chains_into_text_actions` 为 1 passed、891 filtered；本轮全量测试未重跑。`cargo check --example image_text_flow_relay_ui --features ui-preview`、带 `ui-preview` 的全目标严格 Clippy、工具目录同步检查通过。

这仍不是插件算法接入：提供方本轮没有独立构建的 `.zicode-plugin`，也没有图片插件目录；没有包版本、manifest、WASI adapter、跨适配器 fixtures 或包摘要。Studio 迁移清单保持 `not_delivered` / 无候选能力，工具完整接受数不变。独立 ZiDevTools 工作流 UI与算法可以继续开发，但 Studio 不启动其 EXE、共享路径或应用状态来代替插件执行。

Host 预算核查修正了旧文案可能造成的混淆：一般 `compute.wasi.v1` 是 64 MiB；当前资源型 WASI 执行已使用 256 MiB guest memory、10,000,000 fuel、每次最多 4 项且输入总量 32 MiB、执行时限 5 秒。二进制输出最多 4 项/总量 32 MiB；资源 Worker 为全局 3 槽、每插件 2 槽。以上是通用资源执行配置，不代表 16MP 图片算法已在此预算内通过。Studio 可信图片预览仍限单边 4096、总计 4 Mi 像素、编码数据 8 MiB；预览上限和原始 16MP 算法输入是不同边界。

给提供方的下一步要求已澄清：先以真实 WASI adapter 测量声明范围内的解码、变换、编码峰值内存、fuel、墙钟和结果；能在现有资源预算内运行时复用现有 profile。若超界，才提交最小版本化执行预算/进度/取消扩展与总并发/内存预算。WinRT OCR 必须明确为原生平台能力，不能列为跨平台 WASI。交付包还需列清逐操作 schema/权限、拒绝与撤权/取消/错误 fixtures、跨适配器一致性及支持平台；完整流程另验收实例版本、各步取消、失败后恢复和结果留存。

## 2026-10-15 测量环境复用复核

原 DevTools 会话确认 `E:\zi-devtools\target\diagnostics-verification-python36` 已有 Python Wasmtime 绑定和 DLL；`scripts/bootstrap_diagnostics_engine.py` 固定官方 C-API v36.0.2 来源并验证摘要。探测 `wasmtime.__version__` / `_ffi.ffi` 使用了错误的 Python API 名称，不能据此认定运行时缺失。初次 pip 安装因镜像没有该版本失败，未安装或写入新 wheel。当前会话决定复用现有运行时、先读输入/输出帧协议再基准测试；实际图像性能数值尚未产生。

## 2026-10-15 共享图片核心进展

ZiDevTools 原开发会话在独立仓库新增 `crates/zi-image-core`，开始将图片解码尺寸限制及流程裁剪、缩放、编码逻辑抽到可复用的 Rust 核心；核心定向测试 `cargo test --locked -p zi-image-core` 与应用库定向编译 `cargo check --locked -p zi-devtools --lib` 均通过。早期检查发现编码模块缺少 `bail` 导入、核心测试的 limits 初始化写法不兼容，提供方已修复并重跑通过。

后续提供方工作树新增未提交的 `crates/zi-image-wasi`，只实现 `devtools.image.resize`：单张 PNG/JPEG/WebP 输入、缩放及 PNG/JPEG/WebP 输出，声明使用 Studio 的 `resource.wasi.input.draft2` 和 `resource.wasi.output.draft1`。提供方报告在现有 64 MiB guest module 上限下构建通过，并开始用真实资源帧测量 4MP/16MP 完整调用链。这是一个单能力适配器候选，不是完整图片流程，也还不是 Studio 可安装插件：没有图片 manifest、插件目录/容器/摘要、跨适配器 fixtures 或最终性能收据。首轮基准脚本未产出结果收据，在附加的 output-limit probe 阶段遇到 `Invalid resource Worker frame`；fixture循环在该probe之前，但其运行结果未持久化，故当前不能据此判断4/16MP适配器成功或失败。提供方正在修正/保留此脚本与失败证据。工具目录仍为 `not_delivered`，154 项完整接受不变。Studio 不修改提供方仓库、不依赖其独立 EXE；待独立候选包交付后，按实际协议、像素/字节上限、fuel、内存、时限、取消及结果接力逐项验收。

后续只读核对确认提供方机器已安装 `wasm32-wasip1`，并有 `zi-text-wasi` / `zi-trace-wasi` 等 crate 可参考。但当前 `.cargo/config.toml` 对 WASI target 设置 `--max-memory=67108864`，`dt-plugin` 也复用这一链接限制；这会将 guest module 上限固定在 64 MiB。Studio 的 256 MiB 是 Host 实例预算，不会覆盖模块自身的编译期上限。已将此差异反馈给提供方：先在现有设置下实测，若模块上限阻断受支持图片，再基于测量评估一个明确、可复用的图片插件 profile，不能仅因 Host 有 256 MiB 就声明图片算法可运行。

## 2026-10-15 Studio Worker 性能复测

提供方后续复测的最终 benchmark 收据位于 `E:\zi-devtools\target\image-resource-benchmark\results.json`，SHA-256 `ec0cc3410a1080a99ed78961afe5f0237659fa0ea9e6954a63241819eeca62a4`。最终测量模块 `zi-image-wasi.wasm` 为 1,026,305 字节、SHA-256 `0affecf857f0aadec3786b435e4e3a86ea85cae9dc71916cbf727523b31c3224`，该次诊断构建的模块上限为 256 MiB。提供方 `.cargo/config.toml` 的默认 WASI 链接上限仍为 64 MiB；256 MiB 是该 adapter 自己的 `build.rs` profile 设置，不等于已接受的通用 Host profile 或插件发布产物。Studio debug Worker SHA-256 `98b539006ce9847742fab0b28a3fcb9a73cd041416434b97c9416be991ec61a9`。收据记录 Host fuel 10,000,000、实例内存256 MiB、2 MiB栈；当前 Host deadline为5秒。实际集成插件包仍未生成。

| 输入与操作 | Studio Worker（10M fuel） | 直连 Wasmtime 诊断 | 结论 |
|---|---|---|---|
| 2000×2000 RGB JPEG，缩到1000宽并编码WebP | `WASI fuel exhausted`；墙钟2507 ms，峰值工作集53.6 MiB | 消耗5,638,141,353 fuel、guest 467 ms；模块线性内存51,838,976 B；输出WebP 2,731,564 B | 诊断模块可完成；当前Host预算不通过 |
| 2048×1024 RGBA 透明PNG，缩到1000宽并编码PNG | `WASI fuel exhausted`；墙钟2258 ms，峰值工作集47.3 MiB | 消耗2,124,873,762 fuel、guest 204 ms；模块线性内存29,229,056 B；输出PNG 11,060 B，alpha 73保留 | 诊断模块可完成；当前Host预算不通过 |
| 4000×4000 RGB JPEG（16,000,000像素），缩到2000宽并编码WebP | `WASI fuel exhausted`；墙钟2529 ms，峰值工作集112.0 MiB | 消耗22,532,110,853 fuel、guest 2250 ms；模块线性内存200,540,160 B；输出WebP 10,924,746 B | adapter自有256 MiB诊断模块可完成；默认64 MiB模块和当前Host预算均未接受 |
| 损坏PNG | Worker按预期返回 `INVALID_IMAGE` | 消耗50,501 fuel | 输入拒绝路径通过，不代表正常图像可用 |

新收据的 WASI 与原生共享核心对三种有效图像均字节一致；损坏图片按预期返回 `INVALID_IMAGE`。超32 MiB输出拒绝探针通过；取消未测（独立Worker CLI没有请求取消控制）。首次64 MiB模块的16MP分配失败记录保留，但被adapter自有256 MiB模块的当前结果取代；提供方通用默认仍64 MiB。实际 Studio Worker 对三种正常图像均在10M fuel处失败，且在fuel耗尽前未触及5秒deadline。Studio没有调高全局fuel；现为单能力制定[版本化图片缩放预览契约](resource-image-resize-preview.md)，将更高配额限制到显式声明的 resize capability，并要求 Host 实现并发/聚合预留、强制超时与在途取消后再交付实包验收。通过单一能力不能计为完整 `image-workflow` 或154项工具接受。

## 2026-10-15 Studio Host profile 实现状态

Studio Host 已实现单能力 profile 协商与 Worker 执行配置：`devtools.image.resize` 必须显式声明 `resource.wasi.image.resize.v1@1.0.0-preview.1`、资源输入/输出协议、输出 schema 和 `resource.read`；执行限制为单个256 MiB guest memory、30B fuel、10秒、单图32 MiB输入/输出和 PNG/JPEG/WebP MIME。并发槽固定全局最多2、同插件最多1，并以512 MiB/活动调用作为准入预算核算（总计1,024 MiB）。此项是 admission reservation，不是操作系统对子进程驻留内存硬限制；实际目标系统峰值内存和进程隔离仍列为接收验收要求。

Studio `bun run check:rust:static` 已通过，profile 定向测试4 passed、0 failed、610 filtered。ZiDevTools 原开发会话正在补真实 Worker 的格式矩阵和包收据；截至本记录仍未交付 `.zicode-plugin`、manifest 或安装包摘要。目录发现、权限确认、用户资源授权、真实 package worker、结果预览/接力/保存和 image-workflow 完整行为仍待实际端到端验收，154项全工具接受仍0。

## 2026-10-15 Host 图片失败结果映射修正

提供方 0.1.1 unsigned candidate 已生成；其 `IMAGE_DIMENSION_LIMIT`、`INVALID_IMAGE` 等失败是 JSON 失败信封且不含派生资源。Studio 曾把这种合法业务失败当成缺少必需图片输出，统一返回 `invalid_output`。现 Host 对图片 profile 仅接受明确错误码白名单和严格结构，忽略提供方自由文本并输出固定安全文案；失败帧若夹带资源或含未知字段/错误码/超长文本则拒绝。失败路径不登记任何派生资源。成功路径不变。

本轮 Rust 静态检查通过，`image_resize` 定向测试 5 passed、0 failed、610 filtered。提供方收据的 `studioReceiptVerified` 仍为 false，插件候选未签名；原生 Studio 目录安装、发现、授权、执行、预览/接力/保存仍待实际验收。

## 2026-10-15 真正接收图片缩放候选

DevTools candidate 0.1.1 已冻结到 `tests/fixtures/devtools-image-resize-candidate02/`，外置 receipt 的逐文件核验通过（7 files / 1,036,667 B）；WASM SHA-256 `a38e4743475f33f8c04aed87e064c942067956d4d0a366a4a12e36371df8f77a`。候选 unsigned，不是签名包。

Studio `actual_http_devtools_image_resize_candidate_host_flow` 以本地 Debug EXE 作为真实隔离 Worker，通过实际 HTTP Host 执行开发插件目录加载、能力目录发现、resource.read 授权、图片 snapshot、WASI 缩放、输出资源登记及分块读回。4×2 PNG→2×1 PNG通过 SHA-256 和真实解码核对；损坏 PNG返回 Host 固定文本 `INVALID_IMAGE`、无输出资源，调用 audit 为失败。用例运行1 passed。host test receipt不改变提供方 candidate receipt 的签名或 `studioReceiptVerified` 字段。

真实图片预览组件及读取器定向 UI 测试 `plugin-resource-preview.test.js` / `plugin-resource-preview-load.test.js`：10 tests passed。它们验证模拟视图，不是原生窗口截图；Computer Use 当前没有可操作桌面应用窗口。本阶段仍欠原生 UI 安装/预览实看、明确保存/跨工具接力、取消/撤权/并发测试及其他平台。`image-workflow`完整流程和154项全工具接受数仍为0。
