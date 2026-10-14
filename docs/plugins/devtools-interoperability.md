# ZiDevTools 独立插件交付规范

日期：2026-10-07。契约标识 `zicode.devtools-plugin/1.0.0-rc.1`。
状态：首批实现契约已固定，双方实包验收待完成；不是“所有工具已接入”的声明。

整体目标已调整为通过插件体系覆盖ZiDevTools全部工具，包含已实现、进行中和规划项。首批五能力仅是接入切片；逐项状态、当前阻塞原因与完成标准见[全部工具接入目标](devtools-all-tools.md)。冻结首批契约保持不变，后续能力通过版本化扩展推进。

## 1. 独立构建与职责

ZiDevTools 维护自己的纯 Rust 工具核心、独立 egui 程序和插件构建适配器。
同一核心可由独立程序和 WASI 插件调用，但 Studio 不引用 ZiDevTools 源码、Cargo crate、
EXE、绝对本机路径或配置目录；两仓库之间没有 path dependency、symlink 或共享可变数据库。
Studio 只消费版本化插件包与公开契约。提供方可把契约快照复制进自己的仓库，记录版本和摘要；
编译与 CI 必须在只有自己仓库的机器上完成，不得读取本机 Studio checkout。

Studio 负责通用安装、校验、隔离执行、场景权限、UI 消息桥、Pi Broker、更新/回滚与接收验收。
ZiDevTools 负责工具算法、输入输出、工具版本、独立 UI、插件 View 和生成包。
规范变更通过新版本及迁移说明交接；两边不能私自增加只适用于对方内部代码的快捷入口。

## 2. 能力分层与迁移范围

| Profile | v1 状态 | 范围和边界 |
| --- | --- | --- |
| compute.wasi.v1 | 首批目标，现有 Host 有执行基础 | 文本、编码、JSON 等有界纯计算；无文件、网络、进程、持久状态 |
| resource.v1 | 内部候选渐进验证，正式v1未发布 | 由 Host 授权资源句柄，流式读写、预览、冲突及恢复；数据/图片/目录工具 |
| model.catalog.read.v1 | Studio 只读预览 `1.0.0-preview.1` | [按当前运行时、插件及场景授权列出不透明模型引用](model-catalog-preview.md)；不能调用模型 |
| model.generate.v1 | Studio 受控预览 `1.0.0-preview.1` | [View 逐次确认后由 Host 调用已配置模型](model-generation-preview.md)；无运行中取消、来源证明或通用服务总线 |
| service.v1 | 设计待实施，不可宣称支持 | Host 受控网络、任务、服务、数据库与模型访问；权限、取消和生命周期 |
| desktop.v1 | 设计待实施，不可宣称支持 | 录屏、剪贴板、快捷键等按 OS 单独声明与验证 |

每项 ZiDevTools 目录功能必须映射为可迁移、已有能力整合、等待宿主接口或未实现。
“独立版 implemented”不等于“插件 implemented”。Windows 专有功能不得标记全平台。
所有功能最终有映射，不为赶进度让插件启动独立 EXE、访问任意路径或另起无鉴权 HTTP 服务。
未来 profile 需先定义版本化请求/结果、权限、资源上限和取消契约，再由 Studio 实现通用接口。
当前源码已提供 [resource.output.types.v1 预览版](resource-output-types-profile.md)，仅协商 WASI 输出 MIME 索引 5–26 与固定保存后缀；插件须同时声明 `output.schema.v1` 和资源输入/输出运行标识。它不替代未发布的 `resource.v1`，也不表示任何提供方资源工具已完成接入。
资源调用状态的 Studio-only 候选扩展见 [resource.call.status.draft1](resource-call-status.md)；
目录资源详情与接力父界面已接入显式核对，当前不向提供方宣告完整恢复支持；延迟请求封存、控制器销毁与跨重启恢复仍待完成。
Host 已新增[一次性调用准入候选](resource-call-admission.md)，验证原子消费/封存与迟到请求拒绝；父界面仍待切换，不能将其保证套用到旧调用路径。
当前 WASI stdin/stdout 是一次调用，无法通过声明权限凭空获得 Host 回调或双向 RPC。

2026-10-14 Studio 内部公共网页 GET 边界已收敛到 `public_http`：笔记网页采集与网页监控逐跳检查公共地址，并按各自预算截断读取；没有配置代理的直连会把本次核验的 DNS 地址固定到连接。本机实际依赖环境代理访问外网，故两个现有内置功能保留配置代理支持：此时代理自行解析目标，无法声称连接地址已固定。首次禁代理 smoke 失败、恢复内置代理后真实网页 smoke 成功，均已记录。此代码不提供插件身份、逐目标许可、凭据引用、任务取消、审计或 View 回调；未来插件服务不能默认继承内置代理路径。`service.v1` 与插件网络调用继续保持未支持，提供方不得在清单中声明。代理身份与目标校验、DNS 解析耗时及其他系统仍需单独设计和验证。

## 3. 包、标识与交付物

沿用现有 `plugin.json` schemaVersion 1、Plugin API 1 和 `.zicode-plugin` 签名容器。
首包 ID 为 `com.zicode.devtools.text`，工具命名空间 `devtools.text.*`；独立工具 ID 保留在
交付清单的 sourceToolId，不能把全局原始短 ID（如 json）直接作为跨插件 Capability ID。
其他包按数据、诊断、知识、系统等边界拆分，避免每个工具增加主导航项。

提供方交付：

- 自包含目录：plugin.json、runtime/tools.wasm、views/main.html、LICENSE/NOTICE；
- catalog.json：按本规范的 delivery schema，记录工具 ID、版本、来源和支持状态；
- schemas/*.json 和 fixtures/*.json：输入/输出约束、正反例与预期结果；
- `.zicode-plugin` 正式容器、独立 SHA-256 文件；私钥位于源码和输出目录之外；
- 包外 verification.json：源码 revision、dirty 状态、契约版本/快照摘要、工具链、已做检查、
  目标平台及未验收项，并引用最终包 SHA-256。包内 provenance.json 只记录构建来源，
  不写自身包摘要，避免自引用哈希。开发候选允许 dirty=true，正式交付需固定源码与内容摘要；
- 合法的首次安装、升级、撤权、卸载保留数据说明。文档和 schema 应随签名覆盖。

未配置正式签名密钥时交付候选目录及明确的 unsigned 状态，不能借用 Studio 私钥或伪造正式签名。
`.zicode-plugin` 内部为 ZIP 是现有插件格式；独立程序的 Windows 阶段交付仍保留完整目录和 EXE。
包不得包含 node_modules、target、Pi、Bun、Ollama、模型权重、用户数据库、服务配置或凭据。
总展开内容最多 50 MiB、文件最多 2048、单文件最多 10 MiB；WASI 模块另限 2 MiB。
超过限额先拆包/裁剪依赖，不静默提高 Host 限额。

## 4. 首批 ABI：compute.wasi.v1

Rust 目标为 `wasm32-wasip1`，WASI Preview 1 command 模块导出 `_start`。
每次调用重新实例化，stdin 为一个 UTF-8 JSON 对象并以 EOF 结束，无长度头、无 JSON-RPC：

```json
{"pluginId":"com.zicode.devtools.text","sceneId":"coding","capabilityId":"devtools.text.base64.encode","commandId":null,"input":{"text":"hello"}}
```

由 Host 提供 pluginId、sceneId；capabilityId/commandId 恰好一个非 null。
提供方必须检查处理器是否允许，不能把它当任意代码/命令。首批不注册后台 Command，
UI 通过 Capability 调用；UI 活动入口由既有 Activity/View 提供。
stdout 只写一个 JSON 结果；不要输出启动标语、日志、多行事件或 Host 私有 WorkerResponse 包装：

```json
{"contractVersion":"1.0.0-rc.1","ok":true,"data":{"text":"aGVsbG8="},"error":null}
```

可预期输入错误输出 `ok:false,data:null,error:{code,message}`；code 从
INVALID_INPUT、INPUT_TOO_LARGE、INVALID_ENCODING、UNSUPPORTED_OPERATION、INTERNAL_ERROR 选择。
message 为可展示、不含原始输入/凭据/堆栈的短说明，最多 240 字符。
界面需分别处理插件业务失败与 Host 拒绝/超时导致的 Promise rejection。
未知协议主版本拒绝执行，新增可选字段需要双方兼容测试；破坏性输入/输出变化使用新主版本/Capability ID。

当前 Host 上限：模块 2 MiB，内存 64 MiB，栈 2 MiB，fuel 10,000,000，执行进程 5 秒，
Worker 请求 256 KiB，stdout 1 MiB，stderr 64 KiB；View 消息上限是 64K **字符**。
本 profile 收紧为输入 text UTF-8 最多 8192 字节、序列化请求和响应各最多 48 KiB，
提供方在解析/分配前后检查字节与结构上限。输出上限也适用于错误路径。
无预打开目录、环境变量、网络、宿主路径或跨调用状态；v1 不提供进度事件/长任务/持久化。

Host 当前有两个需由 Studio 验收的实现缺口：

- `_start` 正常返回可用；现有代码把所有 Wasmtime call error 都判失败。标准工具链如使用
  `proc_exit(0)`，Studio 应区分成功退出与真实失败，并验证已有完整 JSON；提供方报告实际行为。
- 外层 Worker 先等待退出再读取管道，较大结果有潜在管道阻塞风险。48 KiB 上限只是产品约束，
  不是修复；Studio 必须验证最大输出，并在必要时并发排空管道，不能仅缩小正例掩盖问题。

这两项列为接收验收门槛，不要求提供方绕过隔离或手写不可靠的退出逻辑。

## 5. 五个试点工具与确定性语义

| sourceToolId | Capability ID | 成功 data.text |
| --- | --- | --- |
| json | devtools.text.json.format | JSON 两空格缩进；无末尾换行；对象键按字典序递归排序 |
| json | devtools.text.json.minify | 无空白 JSON；对象键按字典序递归排序 |
| base64 | devtools.text.base64.encode | UTF-8 → 标准有 padding 的 Base64，无换行 |
| base64 | devtools.text.base64.decode | 严格标准 Base64 → 合法 UTF-8；非法编码返回 INVALID_ENCODING |
| sha256 | devtools.text.sha256 | 输入 UTF-8 字节的 64 位小写十六进制 SHA-256 |

输入均为严格 `{text:string}`，不接受额外字段。JSON 工具限制深度 64，仅接受有限数值，
整数范围限制在安全整数 ±9007199254740991，范围外明确失败；不能悄悄损失整数精度。
重复对象键处理需实现拒绝或在交接时提出契约修订，不能在不同适配器中采用不同结果。
默认 schema 的字符数限制不能替代 UTF-8 字节检查。契约中的 fixtures 是行为对照，不代替真实 Host 验收。

## 6. UI 与 AI 接入

View 为包内自包含 HTML（当前最稳妥方式为内联脚本/CSS）；不 import Studio React 模块，
不访问父 DOM、Tauri IPC、原始 Pi RPC、网络或 file URL。独立 egui UI 继续只服务独立程序。
使用现有注入 SDK：`await window.zicode.ready()`、`context.get()`、`setDirty(bool)`、
`capabilities.invoke(capabilityId,input)`、`ui.showInformation(message)`。
`@zicode/plugin-sdk` 的未来示例不是已发布 npm 依赖。输入、错误和输出以 textContent 渲染。
至少覆盖窄窗/桌面、明暗可读、键盘、运行中、空输入、错误、重复点击与失效调用反馈。
当前 SDK 未承诺主题/语言推送事件；需要的新增通用接口由 Studio 负责，双方先记录缺口。

首包可声明五个 Pi Tool，名称如 `devtools_text_base64_encode`，绑定对应 capability 和相同 schema；
`pi.tools.register` 只作为 optional 权限。未授权时 View 仍可使用纯计算工具，AI 入口不可见。
不得静默把剪贴板、用户文件或整个目录内容送入模型。先安装/启用，后显式授权 Pi Tool。

## 7. 后续 profile 必须保持的接口原则

资源必须使用 Host 颁发、绑定插件/场景/工作区/操作/有效期的 opaque handle，不能直接接受路径
获得权限。写入先预览，按版本提交，权限撤销和作用域变化需失效；用户数据迁移由显式导入触发。
异步任务需请求 ID、开始/进度/终态、取消/超时、幂等键及进程回收，不能承诺当前同步 WASI 已支持。
网络通过 Host 域名/方法策略；凭据只传引用；系统能力按目标 OS 协商，不支持时返回稳定错误。
插件数据按 plugin ID 和 schema version 隔离，升级需备份/迁移/回滚兼容说明，卸载默认保留。

## 8. 分工与完成标准

ZiDevTools 会话先交付：全目录映射清单、独立 core 边界、五个试点的双产物构建、插件 View、
fixtures 结果和尺寸摘要；现有独立程序继续满足其 AGENTS 验收，不把 Studio 作为构建依赖。
Studio 会话负责：核对该包、Host 边界修复、安装/信任/启停/撤权/回滚/卸载，真实 View→Host→WASI
以及实际内嵌 Pi→Broker 调用证据。双方测试缺口单独记录，不能互相推定已经通过。
Windows 首批接收后，分别补 macOS ARM64/x64 和 Linux x64 的真实 Host 运行证据。
达到首批验收只代表五个工具通过，不代表完整 ZiDevTools 目录已迁移。

可复制的机器契约与样例位于仓库 `contracts/devtools-plugin/v1/`；文档是当前版本的解释说明。

## 接收方开发记录（2026-10-08）

Studio 已开始接入首批未签名文本候选，修复标准 WASI 成功退出识别和 Worker 并发排空输出，加入实际模块及串联结果测试。详细状态及未验收边界见[文本插件接入进展](devtools-text-acceptance.md)。固定契约快照保持不变，完整安装/View/Pi/升级验收通过前不提高接入计数。

## Studio 公共目录收包校验（2026-10-09）

只读入口：`bun run verify:devtools-package <公开插件目录> <包外verification.json>`。

支持统一使用`size`的提供方索引，或历史接收快照统一使用`bytes`的索引；混用或同时提供两字段会拒绝。receipt标记indexFormat并统一输出size，不修改原索引或期望摘要。文本试点可在任何接收端本地检查：`bun run verify:devtools-package tests/fixtures/devtools-text-dev57 tests/fixtures/devtools-text-dev57.acceptance.json`。接收夹具目录排除自动格式化，排版变更也会使冻结SHA失效；只有能精确恢复原摘要的排版修复可在保留漂移备份后进行，不能按当前文件重新生成期望值以绕过失败。

标准输出是JSON receipt；失败返回非零退出码和错误代码。流式核对完整文件清单、大小、SHA-256与索引摘要；拒绝越界/绝对/反斜杠路径、Windows非法与保留文件名、大小写重复项、链接/junction、未知文件和摘要不一致。只读取交付，不执行提供方代码、不复制插件或依赖、不创建target。

receipt只证明此次目录内容与包外索引一致，不证明索引来源可信、签名有效、正式Host协议或全部工具接受。目录可能之后变化；安装/执行前仍须固定包，并由Host验证权限、完整性、签名与运行边界。此工具不承担安全解压/安装或恶意并发目录替换防护。固定历史开发运行目录的归档继续独立保留。

## Studio 通用工作台结果呈现（2026-10-09）

通用工作台识别`contractVersion=1.0.0-rc.1`且`ok=true/data.text:string/error=null`的文本结果，直接展示原文本，保留换行、空字符串和中文；不再次解析文本中的JSON，也不渲染HTML。原始响应默认折叠，用户可主动展开。其他版本和普通输出保持原样，不能按某一提供方私有字段猜测文本结构。

返回对象显式声明`ok=false`时显示业务失败及有界错误信息，不写入最近成功使用。已知版本的非预期结构显示`INVALID_RESULT`并保留原响应，不当成成功。每次显式执行清除旧结果，Host错误与业务失败不会继续显示上次成功内容；成功后保存历史失败会保留成功结果并单独提示。

Windows真实Base64解码成功→两次无效编码→修正后成功已验；失败前后只读访问记录逐字节一致，成功重试使revision增加1。13项工具中心定向测试通过。截图、读取记录及验证边界见技术博客`iterations/tool-result-2026-10-09`。这不覆盖其他OS、所有工具输出类型、Pi调用、签名生命周期或自动结果接力与保存授权，不提高全量接入计数。

## Studio 工具目录个性化查询（2026-10-09）

Studio桌面内部`GET /v2/plugin-tool-directory`保留现有query/offset/revision，并支持可选`view=all|favorites|recent`。默认all兼容原调用；个性化查询必须传当前已注册`workspaceId`，Host以sceneId/workspaceId读取自己的访问记录，不能传入任意收藏清单。仍须桌面令牌鉴权，未开放给插件iframe或远程客户端，不要求DevTools改变实现或独立程序。

Host按accessId匹配当前注册工具，先筛选及搜索再分页，每页最多40项；收藏按稳定toolId顺序，最近按保存的使用顺序。已卸载工具及应用入口不计入工具列表；禁用工具仍显示当前状态。仅返回目录元数据，选中工具后独立加载schema，不为浏览注册Pi工具、加载View或启动Worker。

个性化响应含accessRevision；请求非零offset时同时提交catalog revision和accessRevision。收藏/最近记录变化或插件目录变化返回catalog_changed，前端回到第一页重新加载。访问记录读取在独立阻塞线程中完成，释放metadata锁后才读取registry，不与执行工具共享长时间持锁。存储故障返回503，不能回退到别的工作区或把未知当空列表。

验证记录持续写入技术博客`iterations/tool-access-directory-2026-10-09`，完成范围以其中检查/HTTP/截图证据为准。该目录入口不改变154项全工具范围、插件权限、执行预算及签名要求；分类、命令面板工具检索、跨窗口实时推送和执行取消仍需独立实现。

## 2026-10-09 通用工作台结果接力和保存

通用文本工具执行请求启用现有 captureResult。成功后复用Studio可信父层结果控制器，搜索兼容接收工具、显示字段映射/数据/插件版本/工作区预览，用户显式确认后才commitTransfer；保存同样prepareSave→预览→确认commitSave。Host签发resultRef/一次性grant，保持作用域、版本、过期与权限检查；不引入DevTools源码依赖或新协议。接收结果可再次转交或保存。传递/保存提交期间阻止原工具重跑、关闭该工具；离开整个中心尚不取消执行。源结果/作用域变化或卸载销毁控制器，丢弃迟到UI响应。

Windows真实通用目录：URL解码输入a%2Bb%20%E4%B8%AD→a+b 中；搜索58个兼容字段映射、筛选Base64编码→text字段7字节预览→显式确认→YStiIOS4rQ==。接收结果12字节保存预览，取消后12个已有产物文件名称/SHA不变；确认后14文件，只新增一份产物及其元数据，内容及provenance吻合接收插件/能力。1442×931浅色实际截图已检查，详见技术博客iterations/tool-result-flow-2026-10-09。

边界：目前结果捕获/接收仅支持Host已有规范文本与local WASI字符串字段；复杂输出、资源输入、其他运行时接力未验收；不自动发送模型或保存。接收端最近记录尚未接入，连续多跳和接收失败恢复只有既有控制器局部测试，本轮未做全量原生验证。45项定向前端测试/check通过，整体typecheck仍有Habits/Watch两个既有错误。复用debug EXE0.1.0及缓存，无新Rust构建/发布/ZIP；154项完整接受仍0，Pi旧问题未重验。

## 2026-10-09 工具来源分组（Studio内部目录API）

GET /v2/plugin-tool-directory 新增可选pluginId（最多256字节），与query/view/workspaceId/accessRevision/offset/revision组合。省略或空串表示全部来源；未安装/当前列表无该来源返回0项，不能替换成其他插件。sources新增元数据数组，每项pluginId/title/count/enabled；title取已声明displayName/name，count为整个所选all/favorites/recent列表在搜索/来源筛选/分页之前的能力数。来源列表不能从当前40项推导。旧调用兼容；旧Host无sources时前端不显示来源控件。Host仍鉴权、绑定目录修订；不启动Worker/Pi或加载schema。该内部API不是提供方新增分类协议。

Windows实际目录273项/18来源（含Studio自有205项规模夹具），选择文本转换23项；组合收藏无结果时显示明确提示并可清除来源恢复Base64收藏1项。来源+收藏+Base64搜索→按需表单→5LitCm5leHQK→中/next多行结果通过。规模夹具205项分6页，第二页从040开始；改回全部来源回到273项第一页。最终中文禁用状态和上一页/下一页已核对截图1442×931浅色。31项前端定向、6项Rust筛选（5目录相关+1既有图像用例）/静态检查通过；不是全仓、完整154或其他OS接受。

任务分类、别名和规范化搜索仍待版本化扩展；见[分类与搜索元数据接口需求草案](tool-directory-metadata-request.md)。当前来源分组不能替代跨插件任务类别，不采用DevTools专属硬编码映射。

## 2026-10-09 命令面板具体工具入口

桌面命令面板新增“命令 / 具体工具”切换。进入具体工具后才请求当前scene/workspace的手动目录元数据，搜索输入200ms合并、每页40项，支持全部/收藏/最近、方向键选择、Enter打开及PageUp/PageDown分页。加载期间撤下旧结果并阻止旧选择，响应过期/退出时丢弃；目录修订变化显示重载错误，不自动使用旧revision重试。插件不需要增加命令入口或改变包。

选中工具携带宿主返回的revision进入通用工具中心，才加载输入schema；不注册Pi、不执行、不记录执行最近。跳转前后复查当前workspace/scene，遵守现有离开应用确认；已在工具中心时不重新激活/重挂载，同一工具保留输入/结果，最多8个工具页。权限和完整性仍由Host在详情/执行时核对。原生取消和离开整个工具中心草稿保护仍待。

Windows实际273项目录、Base64两结果→收藏一结果→Enter打开→显式解码→多行结果、最近五项首位→再次打开保留输入和结果、PageDown第二页通过。1442×931浅色截图已检查，发现旧340px面板过窄后调整至640px/视口限制并重新生成CSS；未声称窄窗/深色/其他OS或console健康通过。56项定向/check通过，全量typecheck仍Habits/Watch两项既有错误；证据见技术博客iterations/tool-command-entry-2026-10-09。全量154完整接受0不变。

## 2026-10-09 平面标量输入表单

Studio直接读取现有inputSchema，支持string/integer/number/boolean及有限同类型enum；数值minimum/maximum、字符串minLength/maxLength、required在提交前检查。数字原文通过可准确往返的JSON数值检查后再转换；整数限制安全范围，不静默截断或舍入。枚举使用选择索引，false/0/空字符串与未选择分开，可选空值省略。最多16字段/40枚举/32768文本码点，未知约束明确拒绝自动表单。Host执行时仍独立校验权限/修订/schema，不改变冻结插件协议或要求DevTools改包。

Windows自有Worker夹具真实命令发现→加载→执行→结果展示，0/false/0.5/空字符串/1.25及可选省略按原类型到达；精度错误未产生审计调用，修正后唯一成功审计94ms。76项定向/check/前端构建通过，两个既有全量typecheck错误保留。该Worker没有Host支持的结果profile，因此结果展示成功但接力/保存明确result_profile_unsupported；本次输入类型扩展不使文本字段映射变成任意类型映射。复杂schema、资源、其他OS与完整工具scope待验，完整154接受0保持，证据见技术博客iterations/typed-tool-inputs-2026-10-09。

## 2026-10-10 接收端最近记录

工具中心可信父层结果控制器新增可选onReceiverExecuted回调，普通应用视图不提供时行为兼容。仅确认后Host成功的新执行通知；replayed=true、业务/传输失败、销毁或作用域过期不写。最近ID遵循既有Host目录manual.tool:SHA256(JSON([pluginId,capabilityId]))，写入原scene/workspace，刷新当前工具中心访问状态；不把resultRef作为执行成功的必要条件。异步摘要后再次核对挂载状态，历史失败显示独立提示并保留成功结果，不使已执行计算再次可确认。

Windows实际URL解码→确认Base64编码→最近首位，持久revision19→20→21、收藏保持；94项定向/check通过，其他分支仅组件测试。全量typecheck仍Habits/Watch两个旧错误。没有Host/DevTools协议变化，普通工具取消仍待独立版本化内部扩展，详见manual-tool-cancellation-request.md。证据：技术博客iterations/receiver-recent-2026-10-09（开始10月9日、完成10月10日），154完整接受0保持。

## 2026-10-10 普通调用取消内部扩展候选

[manual.tool.call.v1](manual-tool-call-v1.md)由Studio独立提供prepare/invoke/cancel/status，Host生成单次UUID并绑定完整请求，不修改DevTools包协议或要求提供者依赖Studio。可信桌面凭据、已登记工作区及预算有界；撤权/禁用不阻止取消既有调用。原invoke负责交付结果，cancel_requested不代表退出；结束后取消保留真实终态。

当前源码Host真实HTTP→保留生产Worker验证取消/回收、提前取消、禁用后取消与其他插件并行，3个Worker完整闭合；4项新测试+3项既有生命周期回归通过。生产EXE与前端按钮尚未接入，WASI、DevTools全scope、其他OS未验，不能宣称插件取消全量已交付。只更新宿主独立验证记录，154完整接受0保持，证据iterations/manual-tool-cancel-host-2026-10-10。


## 2026-10-10 可信界面取消接入补充

manual.tool.call.v1现已接入工具中心：Host能力探测、prepare UUID、执行、取消ACK与实际终态分开、不确定状态查询、旧Host回退。切换应用保留工具中心及执行，busy禁止关闭/重复执行；取消不写最近，迟到成功保留真实结果。当前Windows debug EXE/真实WebView/Studio夹具验证取消后新调用恢复、输入结果保留及recent21→22；95项定向测试通过。详见manual-tool-call-v1.md及技术博客iterations/manual-tool-cancel-ui-2026-10-10/work-log.md。历史Host-only条目保留其当时验证范围。

本轮不修改DevTools；154项逐工具接受仍0。WASI/其他OS、运行中原生关闭、状态过期后的安全恢复入口、独立分发目录和全部源工具scope仍待验；夹具不支持result capture，不能代替结果接力/保存验收。


## 2026-10-10 普通调用状态恢复源码候选

新增[manual.tool.reconcile.v1](manual-call-reconciliation-v1.md)，prepare保存原Host实例身份，call-status明确unavailable后才允许可信前端请求恢复。prepared在同一锁下封闭，active仅请求取消且不作为终态，已退休句柄在同Host不能再启动；跨Host或离线保持锁定，不自动重放、不推断业务成功/失败，也不写成功recent。无需DevTools改造。

103项前端/8项Rust（含真实HTTP+保留生产Worker）通过，3/3 Worker回收及管道关闭。初次真实HTTP启动观察超时、最终审计worker_timeout保留；同配置重验通过，不提高预算。TTL推进仅测试中进行。新生产EXE/原生截图、WASI及其他OS未验；154逐工具接受仍0。证据技术博客iterations/manual-call-recovery-2026-10-10/work-log.md。此前取消界面实机证据不能代替本扩展原生验收。


## 2026-10-10 状态恢复Windows原生补验

后续已用当前debug EXE b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a/0.1.0实际验证：目录发现/按需加载Studio夹具→真实Worker成功但测试网络侧丢弃响应→锁定且recent不变→生产60秒TTL自然过期→原Host身份恢复证明→解锁并提示核对，无自动重放→主动新UUID调用成功展示→recent22→23且收藏不变。原生浅色1442×931截图已检查。源/运行目录五项资源摘要匹配，无ZIP/新全运行副本；正常关闭后10采样自有进程剩余0，临时夹具2文件1029B已清除。

这是故障注入与Studio合成guest验收，不代替真实写入事故、跨Host旧进程结束、WASI/其他OS、全部DevTools工具算法或独立分发目录；原首次启动超时仍待诊断。154完整接受仍0。详见manual-call-reconciliation-v1.md和技术博客iterations/manual-call-recovery-native-2026-10-10/work-log.md。


## 2026-10-11 一次性资源调用界面接入
目录与接力父界面已采用resource.call.admission.draft1：Host颁发凭据、一次消费、输入/资源快照、显式“停止并恢复调用”。恢复会封存未开始请求或请求取消，四类结果分别展示；原Host不符/无效证明继续限制再次运行，不恢复原输出、不自动重放/保存，旧iframe路径不变。
226项插件前端测试、check及真实HTTP Host/正式Worker+Edge最终13.25秒通过。目录和接力各扣留一次成功响应后恢复；先封存再投递迟到请求被真实Host拒绝且无新增Worker审计。6张1280×900浅色/390×844深色截图已检查；活动与Host更换为代理注入，非真实重启验收。
154项完整接受仍0。控制器关闭/刷新/跨Host重启的持久恢复、原输出恢复、正式resource.v1、真实DevTools全scope与其他OS仍待。版本0.4.2不变，无新应用构建/安装包。技术档案iterations/resource-call-admission-ui-2026-10-11记录原始失败和最终证据。


## 2026-10-11 本地调用恢复记录
目录与接力执行前先提交本地IndexedDB元数据，失败/满额/同工具存在待核对记录均不启动执行。工具中心可在关闭工具或同origin刷新后查找记录，显示应用与工具名称，显式封存/取消并验证原Host结束后移除；忘记记录需明确确认，不等于执行已结束。记录最多128条，不保留输入/输出/路径/凭据，不自动淘汰未确认记录。
324项插件与工具中心前端测试、check、类型检查及React构建通过。真实Host/正式Worker+Edge最终16.24秒验证了并发128上限、第二仓库实例读取、项目隔离、刷新后记录恢复、新执行被待确认记录阻止、显式恢复后用户新运行成功。没有自动重放或项目文件保存，11图留存，其中6张代表性桌面/窄屏图已实看。两次验证脚本断言错误保留，未放宽生产准入/权限或断言范围。
154项完整接受仍0。跨Host/换origin、原生进程崩溃与安装迁移、原结果恢复、正式resource.v1和真实DevTools全集仍待；本地记录不是持久执行收据。target净增0，保留失败夹具211,752B；版本0.4.2与正式安装包未变。见[恢复记录契约](resource-call-journal.md)及技术档案iterations/resource-call-journal-2026-10-11/work-log.md。
