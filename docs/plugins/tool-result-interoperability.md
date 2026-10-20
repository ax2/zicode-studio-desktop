# 工具结果互通与持久化设计

2026-10-17 增加 Studio 内部 [`result.json.v1` 显式对象结果候选](result-json-profile.md)：Host 保留 JSON 对象类型并可在可信界面确认后映射到另一 WASI 工具的 object 输入字段或保存为 JSON 成果。静态与定向单测已覆盖；没有声明此 profile 的真实 DevTools 提供方包，不能将其计入完整插件闭环验收。

状态：2026-10-08 通用互通设计与局部实现候选。当前 `compute.wasi.v1` 契约和固定候选包不变；此文不授权提供方声明 `resource.v1`、`service.v1` 已支持。

后续源码进展：[成功文本结果保存Host候选协议](result-save-contract.md)已实现有界暂存、作用域/来源绑定、保存预览和确认提交。生产父页面预览/确认/取消已接通，真实最小接收页面的保存和工作区切换已验证，完整原生桌面仍待验收。文本发送Host候选见[result-transfer-contract.md](result-transfer-contract.md)；它不等于通用资源授权或完整结果平台。实际证据分别保存在plugin-result-save-ui-2026-10-08和plugin-result-transfer-2026-10-08档案。

2026-10-16 普通文本结果的父页面保存错误处理改为固定文案：若提交响应丢失，当前视图将结果标记为待核实并停止再次提交，避免同一视图中对不确定写入重复确认；另一个工具结果可继续使用。Host 普通结果保存仍缺只读状态/回执恢复接口，因而此处不能宣称已解决崩溃后幂等或完整保存恢复。真实 Windows 文件资源的保存预览与取消已目视验收，但它走独立 `resource.save.draft1` 路径，不能代替普通文本结果错误界面的原生验收。详见[OCR 迭代工作日志](../iterations/2026-10-16-host-resource-ocr/work-log.md)。

同日后续：普通文本结果 Host 已加入桌面专用的只读保存状态查询，并用持久成果中的 grant 摘要在内存回执丢失后识别同一保存。父页面在不确定状态提供“检查保存状态”，仅确认查到的有效成果并显式打开；查不到仍保持未知，不重试写入。真实 Host HTTP 专项覆盖未保存、已保存、错误作用域、无桌面令牌、内存状态清空及重复提交。此进展不等于原生插件 View 的错误画面或跨进程重启验收；旧成果没有摘要，不能追溯恢复。协议见[结果保存候选](result-save-contract.md)。

2026-10-14 补充两份冻结但未签名的 DevTools 候选在真实 Chromium Studio 页面、Host 和 Worker 中的单链路：Trace Django 结果经可信父页面预览，确认后交给 Text JSON 格式化；接收结果再次预览、确认并保存至隔离工作区。可见结果、保存回执及截图见[Trace 接收记录](devtools-trace-acceptance.md)。这仅证明单次开发候选接力与确认保存，不满足本页阶段 2/3 的全部版本、撤权、冲突、恢复、原生窗口和跨平台门槛。

## 当前证据与缺口

- `plugin-view-host.js` 将能力调用绑定当前插件、场景和工作区，插件不能用请求参数替换这些身份。可信父页面在 Host 捕获成功的能力调用结果后提供显式“发送到/保存到”面板；View SDK 没有跨插件结果传输方法。`model.generate.v1` 现由 Host 捕获到同一父页面结果目录，结果引用不会回传 iframe；其 Host HTTP 级接力/确认保存证据见[模型生成预览](model-generation-preview.md)。真实原生窗口与提供方模型仍待验收。
- 文本候选接受 `{text:string}`、返回 `data.text`。直接模块、实际HTTP/交付Worker、生产View和内置Pi目录动态加载的四步串联已通过。手工取文本再传入另一能力不是完整互通平台。
- `ArtifactStore` 已有工作区/场景、MIME、内容版本和 provenance；其现有 handle 不能直接视为绑定插件、操作、有效期的资源授权。
- Pi 动态工具现在可选择让 Host 捕获成功文本输出；Pi 的 `details.studioResult.resultRef` 携带 Host 来源引用，原始工具内容不变。Text 0.3.0 candidate-03 的真实嵌入 Pi 调用后，Studio 桌面令牌以该引用预览 SQL→Base64 转交，未确认提交被拒，测试显式提交确认后真实 Worker 执行成功；Broker 令牌准备转交被拒。这是定向测试中的同包跨能力证据，不是用户在原生界面点击确认、跨独立插件或自动保存的验收。
- 2026-10-17 聊天卡片已为实时成功且带合法 Host 文本引用的 Pi 结果加入“使用结果”，由可信父页面核验身份后复用“发送到/保存”预览及确认面板；无效引用、业务错误、历史卡片和跨会话旧面板均不能继续操作。组件/父页面定向 29/29 通过，1280×720 组件截图已审查；新原生 EXE 中的聊天点击与真人确认转交仍待验，详见[阶段记录](../iterations/2026-10-17-pi-chat-result-actions.md)。模型或插件仍不持有桌面令牌，`resultRef` 不进入可复制输出。
- 2026-10-17 隔离 Windows Debug 原生窗口中，无签名 Inspect 0.1.1 的 NFKC `ABC123` 输出经可信父页面预览（接收目标、字段、版本、6 字节原文），明确确认后交给同包 Unicode 码点 Worker，接收结果显示 `U+0041` 等并提供后续操作入口；未保存或写入。此为一次同包开发候选流程，不代表跨独立插件、签名生命周期、Pi 聊天入口或本轮新 Host 并发修复的原生验收。见[Inspect 原生阶段记录](../iterations/2026-10-17-inspect-011-intake.md)。
- 当前 WASI 资源调用已有最多 4 个、合计 32 MiB 的有界输入和资源读写回调；大归档流式输入与长任务通道仍缺。不能靠新增 manifest 权限让插件访问路径、数据库或启动其他 EXE。

2026-10-14 补验：普通 JSON 资源工具执行结果现与二进制输出一样，在返回页面前按能力声明的 `outputSchema`/`maxResultBytes` 验证。Studio 自制 schemaVersion 2、`output.schema.v1` WASI 夹具的真实 HTTP→Worker 专项证明不合 schema 的 JSON 被 Host 以 `invalid_output` 拒绝，后续正常调用仍可继续。该校验也适用于未来 ZiFile 的有界 WASI 只读子集；它不开放原生归档 Worker、不证明任何 ZiFile 算法或全部 DevTools 工具验收。

2026-10-16 原生 UI 图片候选验收后核对：`plugin-resource-transfer.js` 的接收目录查询使用 `resourceOnly: true`；Host `manual_catalog` 仅返回已启用、获准 `resource.read` 且声明 `runtime.resourceInputProfile=resource.wasi.input.draft2` 的 WASI 插件。图片候选输出已在 Windows Studio UI 登记并预览，但当前隔离会话没有满足条件的接收工具。Studio 内置 `com.zicode.ocr` 虽有 `ocr.text` 能力且 schema 输入为图片字符串，当前 manifest 没有 WASI runtime 和资源输入 profile；因此不能经通用资源接力接收派生图片。原生 `/v2/ocr/extract` 单独接受 data URL，并不等同于 `resourceId`/`contentVersion` grant。

2026-10-16 后续进展：已增加 Studio 自有 `resource.host.input.v1` 预览契约，当前仅允许内置 `com.zicode.resource-inspector/image.inspect`。目录只在 `resourceOnly` 查询中列出它，Host 在分享准备、提交和执行阶段校验固定插件/能力、启用状态、`resource.read` 授权及当前资源 proof。执行从 Host 有界资源存储取数据，在内存检查 PNG/JPEG/WebP 元数据；20 MiB 输入、每边 20,000 像素和 256 MiB 解码分配上限，不产生文件或派生资源。WASI DevTools 契约保持不变。规范见[Host Resource Input Profile](host-resource-input-profile.md)。

2026-10-16 OCR 接收能力进展：新增独立内置 `com.zicode.ocr/ocr.resource-text` capability/profile，在 Windows 的资源接收目录中复用 Host 的确认和 one-use grant 流程；图片仍由 Host 从资源存储读取，插件页面不接触原始字节或路径。只允许 Windows 本机 OCR，采用 45 秒 PowerShell 子进程期限、单进程并发和取消终止。OCR 成功后 Host 将文本登记为有 15 分钟期限、带输入来源链的 `text/plain` 资源，可在现有父页面中再次显式转交或单独预览确认保存。Rust 静态检查、前端规则检查通过，Tauri debug profile 编译成功；桌面 UI bridge 无法列出窗口，真实资源→OCR→下游工具流程仍未运行或截图验收。详细证据见[迭代记录](../iterations/2026-10-16-host-resource-ocr/work-log.md)。

2026-10-16 Windows 原生 UI 补验：真实 debug 窗口完成冻结的 unsigned 图片缩放候选发现、按需加载、显式图片授权、WebP 执行、显式转交给内置 OCR、OCR 执行及 `text/plain` 结果呈现；嵌套结果预览的“发送到工具”入口也已实看。补验确认源 MIME 尚未进入资源目录请求：`text/plain` 查询仍展示图片接收工具，故不能证明这些目标类型兼容；未将文本分享给图片工具。详见[OCR接收迭代记录](../iterations/2026-10-16-host-resource-ocr/work-log.md)及[资源输入类型声明缺口](resource-input-type-declaration.md)。

2026-10-16 跨插件图片接力真实 Host 验收：冻结的 DevTools `com.zicode.devtools.image/devtools.image.resize` WASI 候选在真实 Studio Host/Worker 中生成 2×1 PNG；显式 `confirmed=true` 提交 grant 后，资源被转交给独立的 Studio-owned WASI 接收夹具。该接收工具通过 `resource.wasi.input.draft2` 读取前 8 字节并验证 PNG 签名，未确认提交被拒，接收端实际执行后返回结果；同一测试还继续验证内置 Host 图片检查器。此后又验证图片插件报告 `INVALID_IMAGE` 后，接收插件仍可执行并正常返回。定向 ignored 测试 1/1 通过，`bun run check:rust:static` 通过。此证据证明 Studio 允许 DevTools 输出进入另一 WASI 插件的显式授权接力，并覆盖一次插件业务失败后的兄弟工具连续性；不证明进程崩溃注入、已有第二个 DevTools 工具包适配该输入 ABI，也不覆盖原生界面、签名安装或非 Windows 运行。

定位过程保留：把冻结图片 WASM 复制到不同插件 ID 的首轮试验返回 `IMAGE_OPERATION_FAILED`；模块含原 `com.zicode.devtools.image` 与 capability 字符串，因此没有将重命名副本当作接收器。随后分别修正验收夹具的 `resourceInputMax` 下限及其空输入 schema。相关失败 scratch 未清理，目录名与错误摘要记录在[Host 接收端迭代档案](../iterations/2026-10-16-host-resource-receiver.md)。

这只是一个跨平台 Host 接收端候选，不代表原生 UI 闭环已验收。当前还需要完成 Rust/前端检查、Studio 原生页面“发现→确认分享→执行→结果展示”验收，以及至少一个非 Windows 平台运行验收。OCR、其他内置工具和新增 DevTools receiver 仍不自动兼容；每个新 Host receiver 都必须经版本化契约、精确 capability allowlist 和 conformance 证据接入。不得退回传绝对路径、环境变量或由 UI 读取任意插件输出字节。

## 用户入口

每项工具结果使用一致的操作：复制、发送到、保存到工作区、加入流程。界面同时展示工具版本、结果类型、大小、生成时间和来源，业务错误不能误显示成成功结果。

“发送到”按接收能力的输入类型筛选，支持搜索、收藏和最近使用。先展示接收工具、字段映射和数据预览，确认后执行；不能因 MIME 相同就隐式转换。第一条真实闭环是 JSON→文本编码→文本解码→JSON；后续覆盖 CSV→筛选→图表，以及截图→OCR→笔记。

工具页、命令面板、工作区结果列表和流程编辑器使用同一份能力目录，不分别维护工具名称和状态。目录区分已安装、已授权、当前场景可用和待安装；被禁用的收藏保留但显示原因，不让旧入口继续执行。

规模边界（2026-10-08）：Studio已改用按需目录，启动只注册搜索/加载入口，授权目录分页保留全部摘要，不再发送全量schema环境变量。实际注册集合最多128项、256KiB；超限拒绝新增并提示，执行仍实时核对授权与目录修订。真实内置Pi SDK五能力动态加载/执行已验证，但没有模型自主调用或无限工具容量验收。旧宿主兼容快照保留明确超限诊断。

## 数据与版本

Host 管理结果标识与授权，不让插件持有其他插件目录或数据库。结果记录至少包含：工作区/场景、来源包标识与包版本/内容摘要、能力标识与工具版本、契约/schema版本、MIME、字节数、内容版本/摘要、生成时间及输入结果引用。

输入结果引用用于追踪和重跑，不把原始输入或模型凭据写入审计。保存内容和审计是不同用途：用户可以同意保存原文、文件和处理结果；审计仍只记录必要的非敏感元数据。

每条已保存流程固定节点的工具/包/schema版本和字段映射。升级改变 schema、算法或结果语义时，先显示影响并显式迁移；旧流程不能静默改用最新工具。重试、撤销和重新执行是不同操作：已有调用结果不能跨版本误用，带副作用节点不能因重试重复写入。

## 授权与本地写入

- 用户选定来源、目标和操作后，Host 发出绑定接收插件、场景、工作区、内容版本、操作和有效期的 opaque grant；结果 ID 本身不等于权限。
- 发送到仅授予选定输入的使用权；保存、覆盖、删除、网络上传和模型发送分别确认，可以提供有范围、可撤回的记住授权选项。
- 支持用户同意的本地数据增删改。写入先预览，提交携带预期内容版本；冲突不自动覆盖。覆盖/删除需要恢复记录或备份及清晰的恢复入口。
- 切换工作区、撤权、禁用、卸载或来源版本变化后，未提交的 grant 失效。Host 在实际读取/提交时再检查，不能仅检查目录快照或缓存。
- AI 入口单独授权“可调用工具”和“可读取哪些结果”；授权工具不会自动上传历史结果或整个目录。模型、MCP、RAG 等访问通过后续通用 Host 接口实现。

结果历史可以持久保存。首次启用显示保存位置、内容范围、保留策略、导出和清理入口；用户可选择会话暂存、保存选定结果或自动保存结果。清理默认预览，不为固定容量门槛删除仍有价值的数据或开发缓存。

## 实现顺序与验收

| 阶段 | 实现范围 | 完成证据 |
| --- | --- | --- |
| 1 | 当前文本候选真实 View/Host/Worker/Pi 接入 | 五工具正反例、串联、授权/撤权、生产预算、签名生命周期；组件测试不能替代 |
| 2 | 版本化通用结果目录、显式发送到和纯文本/JSON字段映射 | 两个独立插件实包互通；伪造身份、错误schema、超限、撤权、跨工作区均拒绝 |
| 3 | 用户同意的工作区持久化与资源授权 | 保存/重启恢复/导出；版本冲突、恢复、grant失效和卸载数据选择；不读取提供方配置 |
| 4 | 大文件、图片、异步流程和 Agent/MCP/RAG | 流式上限、取消/超时/进度/幂等；逐操作授权；失败恢复；独立平台运行证据 |

阶段2之前先发布新扩展的请求/结果/schema、错误码、权限与迁移说明，再实现双方 conformance；不能在首批契约快照中悄悄增加私有方法。尚未实现的阶段不进入“已实现工具/插件”列表。

接入证据维护于[文本插件接入进展](devtools-text-acceptance.md)，提供方边界维护于[独立交付规范](devtools-interoperability.md)。

大规模入口与Pi按需发现的实现范围和剩余验收要求见[工具目录与按需访问](tool-catalog-access.md)。这些Studio内部能力不改变当前冻结插件契约；通用结果目录、资源grant、覆盖/删除恢复、自动化流程及完整跨插件UI仍待实现和验收；局部保存与文本发送候选不代表这些需求完成。
