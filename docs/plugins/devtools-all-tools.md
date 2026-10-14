# Zi DevTools 全部工具插件接入目标

2026-10-14 只读发现提供方未提交目录中 `agent-runner` 与 `super-clipboard` 范围、版本变化，但目录版本号仍为 dev.105；冻结基线暂不覆盖，接口与交付要求见[在途目录变化](devtools-catalog-drift-2026-10-14.md)。

2026-10-13 补充：[Trace 候选接收与当前运行记录](devtools-trace-acceptance.md)接收并核对 Java/Django 两项未签名候选；Windows Pi→Host→Worker 发现、按需加载、两条基本样例及10阶段权限生命周期通过。真实原生 View、全部边界、签名生命周期和其他 OS 待验收，完整接受仍为0。

更新：2026-10-09。持续目标尚未完成。

2026-10-11 当前证据：[Pi 权限生命周期回放](devtools-current-pi-lifecycle.md)以当前源码 Host/保留 Worker/Pi1.1.0完成 Inspect 7、Transforms 23 个基本操作与两组10阶段权限检查；150次未授权等调用、90次缓存权威性调用拒绝，50个Worker均回收。对应13条目的当前证据与人读原因已同步，旧超时仍保留为历史记录。不是完整来源工具接受，154项完整接受仍0。

2026-10-11 补充：[关闭工具应用内确认](tool-directory-navigation.md#关闭工具的应用内确认2026-10-11)已完成默认取消、键盘循环和焦点恢复，实际Windows取消保留/明确关闭隔离/重开空白通过；103项回归通过，不增加完整工具接受计数。

2026-10-11 补充：[当前诊断候选运行验证](diagnostics-current-runtime.md)完成实际Windows通用工作台11基本样例与1历史边界样例、生产Worker142向量语义比较；46 raw报文仍未覆盖。旧失败保留，完整工具接受仍0。

2026-10-11 补充：[手动调用排查记录](manual-call-diagnostics.md)提供固定错误提示和有界元数据；实际Windows超时、显式终态查询、独立DevTools基本操作及主动恢复通过。不会以错误响应自动解锁，154项完整工具验收仍为0。

2026-10-11 补充：[多工具单行切换与窄屏布局](tool-directory-navigation.md)已通过实际 Windows WebView/Host 验证。
八个真实诊断工具打开不执行，切换保留输入与结果；资源输入控件横向溢出修复。首轮真实 HTTP 500 与第二轮脚本文案误判保留，最终专项通过；不增加完整工具验收计数。

2026-10-11 补充：[保存响应不确定后的只读核对](resource-save-recovery.md)已接入 Studio 资源保存对话框。真实 Host/Worker 验证保存响应被拦截后核对成功、同长度文件修改后拒绝确认，均不额外写入；59 项前端回归通过。当前对话框内核对不能代替持久交易日志、原生完整界面、真实 DevTools 算法或其他 OS 验收，154 项完整接受仍为 0。

后续[项目保存记录候选](save-attempt-recovery.md)补充关闭工具/刷新页面后的只读恢复入口，使用现有输出目录临时收据而非第二套内容副本。64前端回归、41资源域Rust及真实HTTP/Worker最终专项通过；子进程无Drop退出、两次新Host且无来源运行会话的恢复分别有验证。尚非完整应用崩溃/断电、持久交易终态、原生完整界面或其他OS验收，154完整接受仍0。

## 目标与范围

通过独立插件体系接入 Zi DevTools 的全部工具，覆盖已实现、进行中和规划条目。保持独立版可运行、两个项目独立构建和数据隔离；Studio只消费版本化插件包和公开契约，不引用提供方源码、配置、数据库或启动其独立EXE。

当前目录基线以机器可读清单记录的提供方0.82.0-dev.105快照为准，共154项：91项标记implemented、20项in-progress、43项planned。这些是提供方声明，未在本会话逐个验证。新增、重命名、拆分和工具版本变动必须更新接入清单；不能把今天的154项当永久固定范围。

- [逐项接入矩阵](devtools-all-tools-matrix.md)：154条目、版本、源状态、接入状态及原因。
- [暂不能完整接入清单](devtools-blocked-tools.md)：逐项责任方、所缺接口和重开条件。
- [机器可读清单](devtools-all-tools-matrix.json)：完整原始scope、评审路径、来源摘要和首批能力证据。
- [图片工具接口需求](devtools-image-interface-requirements.md)：dev.91新增流程及图片/截图资源、接力、确认保存与提供方交付要求；尚非已发布Host协议。
- [诊断候选接收与接口需求](devtools-diagnostics-acceptance.md)：11项自包含报告分析包已按53文件摘要接收，真实Worker五秒兼容失败及后续观察边界逐项记录。

## 当前进度与口径

完整工具验收为0项。JSON、Base64、SHA-256三个条目中，固定dev57包的五项能力已有Windows真实Host/Worker/Pi/View证据；包内工具版本1.1.0不同于当前独立版1.1.3，不能推定当前版本及完整scope已接入。

2026-10-09此前Windows开发EXE通用工具工作台的Base64编码worker_timeout（5220ms）保留；优化dev运行时编译热点后，当前EXE真实搜索、加载、主动编码/解码、展示结果分别494/626ms成功，切换保留输入及结果。仅两个基本样例，不是完整工具接受；旧失败见previousManualToolAcceptance，当前证据见currentManualToolAcceptance及技术博客iterations/wasi-startup-2026-10-09。[运行成本与边界](wasi-runtime-performance.md)说明测量范围。

后续已将5个JSON排版漂移文件精确恢复到原冻结SHA，索引和WASM未改，13文件完整验证及既有真实HTTP专项重新通过，旧失败保留。当前EXE另完成Inspect84/Transforms164个可表达Worker语义用例（0失败，20个不能原样传输的raw用例单列未覆盖）及真实工作台JSON→YAML/URL解码两个基本样例1252/1015ms。见JSON currentRuntimeVerification及技术博客iterations/fixture-integrity-2026-10-09。该阶段Pi失败未重验，不能用Worker/UI通过替代；后续当前Pi证据见[2026-10-11生命周期回放](devtools-current-pi-lifecycle.md)，全工具接受仍0。

当前主状态与机器清单一致：3项试点子集有历史验证、26项候选包已接收待完整验收、15项待提供方插件包、43项待Host扩展、4项待Host管理接口映射、20项提供方部分实现、43项规划未实现，合计154项。每项只计入一个主状态；其额外接口需求仍记录在行内。纯计算评审路径不是可行性证明，实包/预算/授权/跨平台仍要验证。

目录条目不等于能力数量。每个工具需继续拆分其操作、输入类型、输出、平台和写入行为；部分完成必须展示已验证子能力和未覆盖范围，不能用一个操作通过代表整个工具完成。合成1000条摘要只是规模测试，不计作实际工具接入。

## 推进顺序

1. **纯计算**：提供方抽离有界算法并交付独立WASI包，新增操作固定schema和工具版本，覆盖文本/数据及诊断报告解析。先核对预算，不盲目扩大首批8192字节协议。已有Java/Django文本报告解析不因名称涉及系统就一律等进程接口。
2. **资源与结果**：Studio实现通用资源grant、文件身份/内容版本、流式读取、进度/取消、结果类型与显式发送到。保存、覆盖、删除分别预览并由用户同意，处理版本冲突和恢复；再接入文件、图片、数据库、备忘和日程。
3. **服务与受控进程**：发布网络、凭据引用、模型、MCP、受控程序及任务协议；逐目标授权、超时/取消、幂等和脱敏审计。Java/Python等允许用户指定可信程序，不允许任意shell或启动DevTools独立程序替代插件。
4. **桌面能力**：逐OS实现截图、录屏、音频、剪贴板、快捷键及窗口回调；明确支持平台、采集授权、资源预算和真实设备验收。Windows专有功能可以声明仅Windows支持，不冒称全平台，也不自动从总目标中删除。
5. **平台能力与例外**：插件安装器、MCP导出、任务管理等逐操作映射Studio通用Host，验证实际入口及行为。DevTools自身EXE/MSI更新不能原样移植，应记录独立版专属理由、可拆校验算法与Studio插件生命周期替代路径。

每一阶段同步提供方接口需求、版本化契约和conformance材料；首批冻结契约不私自扩展。进行中的工具允许先交付已实现子能力，规划条目保留待办和原因，不能静默遗漏。

## 完成与例外要求

2026-10-09 Host资源候选推进到[输入draft.4](resource-input-contract.md)：可信父窗选择/明确确认、隔离View引用交付和读取已通过实际浏览器/Host链路。该证据使用派生授权fixture，完整原生壳、DevTools资源实包、WASI图片执行及输出/接力保存仍待完成；不改变154项完整验收计数，也不把Host输入候选视作完整resource.v1。

后续Windows原生开发程序的输入确认/读取/撤销已单独验证，发现并修复临时到正式会话的凭据绑定与顶部授权说明遮挡。该项仍使用Studio验收fixture；操作系统文件对话框、DevTools资源实包、图片执行/输出接力保存、其他OS与新冻结EXE未验收。dev.95全154条目版本/scope/原因/责任方已核对，完整工具验收仍0。

每项完整接入必须有：完整scope的操作映射、版本化包/工具/schema、权限声明与输入输出用例、真实发现→加载→执行→展示、必要的结果传递及用户确认写入、超时/取消/错误/日志、撤权/更新/失败隔离、支持OS与对应证据。

Windows原生Tauri壳的五子能力及结果互通已验证；模型自主发现/调用、原生View取消、更新链路及其他OS仍待验收。同次Pi取消与WASI进程回收证据见Worker取消文档，不能替代完整工具验收。组件/mock通过不替代实包和真实环境；重用Host内置能力只有实际插件入口和等价行为验证后才算接入。

无法原样接入或当前阻塞的每项必须记录：工具ID/版本及操作范围、具体理由、缺失接口或提供方能力、责任方、替代方案、重新接入条件和最近证据。暂时阻塞与架构/OS固有限制分开，不能以“等待Host”“不支持”一句话结束。

整体交付必须做到全目录无遗漏：已接入条目有真实证据，未接入条目有上述逐项说明。存在待办时持续标记未完成；不能用首批五能力、目录分页或一份方案文档宣告所有工具接入完成。

## 独立交付与磁盘规则

本轮仅做目录审计与目标文档，读取提供方公开目录是维护操作，Studio运行时不依赖该本机路径。后续以提供方交付的版本化目录快照更新矩阵，不引入公司代码或运行环境。

沿用单一构建缓存，文档变更不启动Rust构建或下载；有用缓存保留。Windows交付保留完整目录与EXE，不生成应用ZIP。开发记录持续同步技术博客项目档案。






## 下一批交付请求（2026-10-09）

已向提供方原会话发送[九项纯文本计算工具交付需求](devtools-next-compute-request.md)，按dev.105具体scope逐操作验收；这是批次排序，不缩小154项总目标。候选03Windows基本View与Pi机制证据已记录到矩阵，完整scope/正式profile/模型自主调用/签名更新及其他OS仍待。

后续接口需求见[下一批插件接口需求](devtools-next-batch-interface-requirements.md)：补充JWT/CIDR/color/unicode/YAML完整范围、regex/diff多字段输入与结果映射，以及时间/随机/网络能力边界。它是待评审需求，不更改冻结首批协议或宣称扩展已经可用。

2026-10-09本轮真实Pi回归补充：Inspect候选yaml.from_json及文本转换候选url.decode出现worker_timeout；两者当前Pi门禁未通过。历史23操作/权限流程通过证据保留，不外推为当前回归通过。预算保持5000ms，原因待分段定位，详见devtools-inspect-runtime-acceptance.md及逐工具矩阵。

## 2026-10-09 通用工具结果与最近记录

本轮progress，详见技术博客档案`iterations/tool-result-2026-10-09/work-log.md`。工作台直接展示已知版本规范文本；业务失败明确提示、不写最近，重试清旧结果，原始响应可折叠。13项定向测试/check通过；真实Windows Base64成功→失败→重试→展开响应已检查1442×931浅色截图，只读持久记录确认失败不变、成功revision+1。全量typecheck仍有Habits/Watch两个既有mock类型错误，console/其他平台未验。复用EXE及依赖，只构建当前tool-center前端产物；154项矩阵/fullToolsAccepted0保持，Pi/取消/工具级收藏与最近筛选/结果接力授权等继续推进；未发布/改版本/生成ZIP。

## 2026-10-09 工具级收藏与最近目录

本轮progress，新增全部/收藏/最近工具入口，Host按当前工作区和场景筛选、搜索、排序后40项分页；个性化页绑定目录与访问记录修订，已卸载工具/应用入口不混入工具列表，浏览仍只读取元数据。Windows真实收藏→列表/搜索、最近→按需表单→URL解码→返回自动置顶通过；再次从收藏执行Base64后标签保持移除收藏，刷新可恢复。截图发现并修复旧翻译缓存覆盖动态标签问题，失败日志保留。

静态Rust/check通过，Rust筛选5项通过（4目录相关+1已有图像测试），前端25项定向通过；全量typecheck仍仅Habits/Watch两个既有错误。新EXE SHA 1c0172828795ec5b9376cbe82ae1544ec38b901874a6d8036b23243026595b59，0.1.0/单target/已有运行资源，未发布/ZIP。进程10/10最终退出。全部154范围与fullToolsAccepted0保持，其他OS/console/全仓回归未验，分类/命令面板/取消/结果接力授权/Pi等继续推进。证据见技术博客iterations/tool-access-directory-2026-10-09/work-log.md及互操作文档新增章节。

### 2026-10-09 通用工具结果接力

通用工作台新增Host捕获结果→兼容接收端搜索→字段映射预览→确认执行，以及保存预览/取消/确认。Windows原生URL解码→独立文本插件Base64编码→保存交付物通过，取消后已有12文件摘要不变，确认后新增2文件（1产物）；45项前端定向通过，截图与持久证据见技术博客iterations/tool-result-flow-2026-10-09。矩阵manualResultFlowVerification记录本轮边界；所有154项状态/完整接受0不变，不能把这条数据链推广为所有工具验收。接收端最近记录、复杂资源/其他运行时和多平台仍待。

### 2026-10-09 工具来源分组

当前通用工作台可在完整目录中按声明来源筛选，并组合收藏/最近/搜索，保持40项分页和按需加载。实机273目录/18来源、文本转换23项、空收藏来源恢复、来源+收藏+搜索→Base64执行及205项来源第二页/切换归零通过；31前端/6Rust筛选通过。矩阵manualSourceDirectoryVerification记录证据边界；全量154状态和fullToolsAccepted0不变。跨插件任务分类/别名仍待双方协商的元数据扩展，接口草案单列，不改冻结提供方包。

### 2026-10-09 当前 Pi 机制重验终态

此前超时记录保留；当前EXE303fd49a、当前源码Host及嵌入Pi0.84.2重验Inspect7/Transforms23基本操作和各10权限阶段全部通过。150次旧缓存拒绝、11次独立插件对照、Inspect业务错误恢复通过，50Worker全部回收/管道关闭，预算仍5000ms。13个相关条目piVerified和currentPiReplay更新，既有失败证据保留；完整154范围及fullToolsAccepted0保持。无模型请求，完整源scope、原始字节、签名生命周期和其他OS仍待。详见[当前运行验收补充](devtools-inspect-runtime-acceptance.md)和技术博客iterations/current-pi-replay-2026-10-09。

### 2026-10-09 具体工具命令入口

命令面板可直接检索具体工具，复用宿主40项分页、收藏/最近和当前工作区作用域；选中只打开表单，实际执行仍需显式点击。同一工具重新定位保留输入/结果，8页上限保持，左侧固定入口不增加。Windows实际搜索/收藏→Base64打开执行、最近重新打开保留、273项第二页通过；56项定向/check通过，全量typecheck两项既有错误保留，console/其他OS未验。矩阵toolCommandEntryVerification单独记录，154完整接受仍0。

### 2026-10-09 通用类型输入

Studio工作台补齐平面整数/数值/布尔及同类型枚举，保留0/false/空字符串与可选省略，显式执行前拒绝精度丢失、非法数值和范围错误。Windows真实自有Worker夹具发现→加载→执行→展示保持原类型，错误输入未产生调用；76项定向回归/check通过。矩阵typedInputVerification单列宿主证据，不代表DevTools对应scope已完成；154状态/fullToolsAccepted0保持。嵌套/数组/资源/其他schema关键字、类型化结果映射和其他OS仍待，详见技术博客iterations/typed-tool-inputs-2026-10-09。

### 2026-10-10 接力接收端最近使用

通用工具结果经显式确认执行成功后，当前工作区/场景记录接收工具recent，失败/缓存重放不重复记；历史保存失败保留成功结果并提示，不能诱导重算。Windows实际URL解码→Base64编码→命令面板最近首位通过，持久revision19→20（源执行）→21（接收执行）、收藏保持；94项定向/check通过。失败/重放/多跳/迟到/无resultRef分支为组件验证，未外推原生全量。矩阵receiverRecentVerification记录，154/full0保持。普通工具取消需求见[独立Host扩展草案](manual-tool-cancellation-request.md)，后续Host候选进展见下节。

### 2026-10-10 普通调用取消Host候选

实现[manual.tool.call.v1](manual-tool-call-v1.md)：Host先登记绑定完整作用域/目录修订/输入摘要，再单次执行；取消确认与执行终态分开，活动16/总128/结束保留60秒，避免无界记录。真实HTTP接当前源码Host和既有生产Worker验证提前取消不启动Worker、运行中取消、禁用后取消、外工作区拒绝、重复取消/执行及新句柄恢复。3个Worker均回收/管道闭合；取消12ms，目录+其他插件探测122ms（单次样本，不是性能分位数）。4项新验证及3项既有生命周期回归通过。

这不是原生取消按钮验收：前端/生产EXE未接入，WASI和其他OS未验，夹具不是DevTools算法。154个工具的完整接受仍0，矩阵manualCallCancellationVerification只记录宿主能力，技术博客证据iterations/manual-tool-cancel-host-2026-10-10。


## 2026-10-10 可信界面取消接入补充

manual.tool.call.v1现已接入工具中心：Host能力探测、prepare UUID、执行、取消ACK与实际终态分开、不确定状态查询、旧Host回退。切换应用保留工具中心及执行，busy禁止关闭/重复执行；取消不写最近，迟到成功保留真实结果。当前Windows debug EXE/真实WebView/Studio夹具验证取消后新调用恢复、输入结果保留及recent21→22；95项定向测试通过。详见manual-tool-call-v1.md及技术博客iterations/manual-tool-cancel-ui-2026-10-10/work-log.md。历史Host-only条目保留其当时验证范围。

本轮不修改DevTools；154项逐工具接受仍0。WASI/其他OS、运行中原生关闭、状态过期后的安全恢复入口、独立分发目录和全部源工具scope仍待验；夹具不支持result capture，不能代替结果接力/保存验收。


## 2026-10-10 普通调用状态恢复源码候选

新增[manual.tool.reconcile.v1](manual-call-reconciliation-v1.md)，prepare保存原Host实例身份，call-status明确unavailable后才允许可信前端请求恢复。prepared在同一锁下封闭，active仅请求取消且不作为终态，已退休句柄在同Host不能再启动；跨Host或离线保持锁定，不自动重放、不推断业务成功/失败，也不写成功recent。无需DevTools改造。

103项前端/8项Rust（含真实HTTP+保留生产Worker）通过，3/3 Worker回收及管道关闭。初次真实HTTP启动观察超时、最终审计worker_timeout保留；同配置重验通过，不提高预算。TTL推进仅测试中进行。新生产EXE/原生截图、WASI及其他OS未验；154逐工具接受仍0。证据技术博客iterations/manual-call-recovery-2026-10-10/work-log.md。此前取消界面实机证据不能代替本扩展原生验收。


## 2026-10-10 状态恢复Windows原生补验

后续已用当前debug EXE b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a/0.1.0实际验证：目录发现/按需加载Studio夹具→真实Worker成功但测试网络侧丢弃响应→锁定且recent不变→生产60秒TTL自然过期→原Host身份恢复证明→解锁并提示核对，无自动重放→主动新UUID调用成功展示→recent22→23且收藏不变。原生浅色1442×931截图已检查。源/运行目录五项资源摘要匹配，无ZIP/新全运行副本；正常关闭后10采样自有进程剩余0，临时夹具2文件1029B已清除。

这是故障注入与Studio合成guest验收，不代替真实写入事故、跨Host旧进程结束、WASI/其他OS、全部DevTools工具算法或独立分发目录；原首次启动超时仍待诊断。154完整接受仍0。详见manual-call-reconciliation-v1.md和技术博客iterations/manual-call-recovery-native-2026-10-10/work-log.md。


## 2026-10-10 诊断实包接入通用工作台

修复通用平面表单拒绝 $id/default 注解的问题：$id 只作为字符串标识，不请求外部URI；default 不注入缺失参数，未支持的引用/约束继续拒绝。Inspect7/Transforms23/Diagnostics11静态schema探测由30/41提升为41/41，其中Diagnostics0/11→11/11；这不是所有源工具的覆盖率。

实际Windows debug EXE b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a /0.1.0复用原隔离个人profile，冻结源包与已安装包各456文件核验通过；真实目录搜索→打开加载→WASI执行→报告展示11基本样例通过，13次Host调用12成功/1 INVALID_REPORT，均HTTP200。未填写secondary时真实请求仅有text；Spring等显式secondary保留，Spring输出脱敏。业务错误保留输入，无成功结果；修正后重试、笔记切换后返回保留结果通过。随后真实诊断SQL报告→Base64编码，预览无commit，显式确认后执行且结果精确匹配；未保存数据/调用模型。

62项定向测试、check、React构建通过；全项目typecheck仍两项既有Habits/Watch测试类型错误，未修改其他工作。原生页面console/pageerror均0，正常关闭后采样10个自有进程剩余0；没有单独采样生产Worker管道闭合，不能外推。首次驱动误用必填字段精确label导致0执行等待失败，保留native-driver-attempt01.json；改成匹配实际含星号标签后最终通过，不是产品超时。

截图已实际检查：浅色原生1442×931、WebView1440×900/DPR1.25（PNG1800×1125），左侧固定工具入口，无每能力新增icon；表单/结果/接力分区可读。仍有可用性问题：可选secondary排在必填text前且标签无语义；长表单结果在首屏下方，多工具标签会换行。提供方应在下个独立版本为text/secondary提供通用title/description（区分左右配置/补充报告），Studio另改通用字段优先级和结果定位，不能在Host硬编码11项业务。

本轮仅修复源码解析并复用EXE更新现有public前端，不编译Rust、不复制完整运行目录、不改0.1.0、不发布/ZIP，无清缓存。前扫描先结束再开始测试/构建，前后exit0/UnknownEntries0；逻辑增量target +112 B、独立.cache +0 B、task-scratch +14467 B、site +0 B，树不可相加，不主张释放卷空间。既有profile及插件保留供复验，本轮未新增临时安装。

154项状态及fullToolsAccepted=0保持，11项仅增加逐能力genericWorkbenchObservation。正式诊断profile、2MiB源scope与8192字节候选差异、历史Worker141通过/1超时/46raw跳过、签名升级回滚、WASI取消、其他OS、完整源功能均待验，详细逐工具原因继续见原矩阵。goal active。

证据见技术博客项目档案 iterations/diagnostics-tool-center-2026-10-10，逐工具矩阵 providerCandidate.genericWorkbenchObservation。

## 2026-10-10 跨插件分类与别名目录扩展

本轮progress：实现通用 tool.directory.v1 / 1.0.0-preview.1，schema2显式声明后支持12种任务分类、别名与描述；旧包归入未分类，固定工具入口不增加左侧icon。Host执行UTF-8预算/控制字符/重复别名校验；NFKC搜索、来源+分类+收藏/最近组合、40项分页及按需表单加载。桌面筛选并排，窄窗口纵向；修复切换设置返回后翻译缓存恢复旧计数的问题。大文件只增加注册调用、profile分支及18项翻译，主要逻辑拆为独立模块。

70前端定向、27注册表Rust、1真实HTTP通过；Rust check/clippy通过，fmt既有漂移保留，check exit0（既有133 warnings/7 infos）。全量typecheck仍HabitsApp.test.tsx:53和WatchApp.test.tsx:63两项旧错误，未改其他工作。Windows实际当前0.1.0 debug EXE验证原273+Studio合成1000项目录，跨来源文本500、来源组合250、第二页、全角别名、收藏/最近均通过。浏览detail/invoke均0；选择后只加载1表单并显式执行1次，结果精确展示。深浅主题计数500、600×900窄窗口无横溢出、console/pageerror0；截图实际检查。Browser plugin not available，使用已捆绑Playwright连接真实Windows WebView；原生窗口截图另存。未验证手机平台。

实际反馈后修正三项驱动问题：含选项label精确匹配、JSON输出误按原始字符串断言、隐藏应用grid计数；失败记录保留，不能当产品超时。首次截图真实发现计数1273/过滤500不一致，修复并新增翻译刷新回归，再跑70项和原生深浅验证。

本轮未改DevTools或冻结包，不推断其业务类别；提供方需按独立契约在下个插件版本声明分类/别名/描述，并提供收据及符合性证据。当前旧包仍未分类。154项原状态/fullToolsAccepted=0保持；千项为规模夹具，不是新增1000个工具，也不是全源scope验收。其他OS、提供方metadata实包、正式发布、完整工具功能继续待验。

本地版本0.1.0不变，复用单target/Cargo缓存，build:local无installer/ZIP/全运行副本；完整target/debug目录和EXE保留。EXE SHA 89d2504f3bcff4513589949a4f3c0c062df8c8428634be60e00a7363910f25d8；最终5项public源码/运行资源摘要一致，详见delivery.json。正常关闭采样10自有进程，剩余0。两个本轮合成插件4文件355796B及2注册项删除被自动审批以blocked by policy拒绝（未返回更具体原因），未绕过，原profile和测试插件暂留，不能声称已清理或释放空间。

前后只读空间扫描exit0，UnknownEntries0；逻辑树不相加，保留有用缓存，卷空间不作为本轮释放量：
- E:\zicode-studio-desktop\target：逻辑差异 2220540430 B。
- E:\zicode-studio-desktop\.cache：逻辑差异 0 B。
- E:\zicode-studio-desktop\.cache\task-scratch：逻辑差异 828030 B。
- E:\zicode-studio-desktop\site：逻辑差异 0 B。

证据：[阶段工作日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/tool-directory-metadata-2026-10-10/work-log.md)、verification-summary.json、native-result.json、theme-result.json、delivery.json；协议见 docs/plugins/tool-directory-v1.md，独立便携快照在阶段contract-snapshot。goal active。

## 2026-10-10 通用工具表单与结果定位

本轮progress：通用字段按必填优先、同组保持提供方顺序；title/description以文本展示，说明和必填提示通过aria-describedby关联，不改输入key/默认值/可选省略语义。新增“查看最近执行结果”与“返回输入”：用户点击才滚动/焦点定位，不自动抢焦点、不触发调用或保存。成功和业务错误均支持，结果区增加分隔。跳转顶部留白修复窄屏悬浮按钮覆盖入口。实现位于独立通用字段/输入/结果模块，公共i18n大文件只增5项映射。

最终72项定向前端测试（13文件）、check与React/CSS构建通过；既有133 warnings/7 infos和project-terminal-engine 20px样式警告保留。全量typecheck仍HabitsApp.test.tsx:53及WatchApp.test.tsx:63两项旧错误；未修改其他工作。首次新增测试漏大括号导致测试解析/check/typecheck失败，修复后通过，初始log保留；移除新增3处非空断言警告，回到既有133项。

Windows实际当前debug EXE/0.1.0，冻结诊断0.1.2源包与安装包各456文件摘要复验通过，目录发现→按需打开Django SQL→必填text在secondary前且真实英文说明展示→显式执行成功→结果/输入往返→INVALID_REPORT→返回输入修正重试→笔记切换保留结果通过。最终单轮3次调用（2成功/1业务错误），实际请求均仅text，跳转不新增调用；console/pageerror0，不保存产物/不请求模型。单元覆盖描述HTML转义、全部平面控件的说明关联、false/0/空字符串/可选省略及无自动焦点。未执行真实数据库连接。

Browser plugin not available；使用已捆绑Playwright连接实际Windows WebView。身份标题/工作区路径、非空、无错误覆盖层、执行结果、焦点、截图已验。浅色桌面1440×900/DPR1.25（PNG1800×1125）、600×900窄视口截图已实际检查；目标不再被悬浮按钮遮住，无横向溢出。首次原生驱动在600宽点击隐藏的笔记侧栏超时30秒，已保留native-attempt01-hidden-notes.json/png，恢复桌面视口后通过；不是工具执行超时。第二轮图片暴露输入跳转入口覆盖，保留inputs-narrow-before-scroll-margin.png并加留白后最终复验通过。

本轮只改Studio前端，不改DevTools/冻结包/Rust/权限/执行协议，无新临时插件、依赖树、target或完整运行目录副本；完整target/debug和EXE保留，版本0.1.0不变，无installer/ZIP。EXE SHA 89d2504f3bcff4513589949a4f3c0c062df8c8428634be60e00a7363910f25d8，最终4项public源码/运行资源摘要一致。正常关闭两次运行，最终采样10自有进程剩余0；未单独采样生产Worker管道，不能外推管道关闭。上一轮两个测试插件删除审批拒绝仍保留，本轮未再次删除或绕过；无释放空间主张。

前扫描结束后才测试/构建；前后扫描exit0/UnknownEntries0，逻辑树不可相加，缓存保留：
- E:\zicode-studio-desktop\target：逻辑差异 2026 B。
- E:\zicode-studio-desktop\.cache：逻辑差异 0 B。
- E:\zicode-studio-desktop\.cache\task-scratch：逻辑差异 -1288826 B。
- E:\zicode-studio-desktop\site：逻辑差异 0 B。

待验收：深色主题/其他OS/屏幕阅读器/所有源工具scope/签名升级回滚；本轮不能覆盖上述范围。提供方后续独立版本仍需为text/secondary提供业务title及中文description；目前英文技术说明可读但语义不足，Host不得猜测业务。154项状态和fullToolsAccepted=0保持，goal active。完整说明见 docs/plugins/tool-form-presentation.md；[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/tool-form-navigation-2026-10-10/work-log.md)、native-result.json、verification-summary.json、delivery.json记录证据和边界。

## 2026-10-10 资源Worker主动授权失效

本轮progress：检查已有资源输入draft4/Worker模块快照draft2/原生View调用后，补齐活动资源计算的主动授权监视。独立lifecycle模块每100ms轮询完整身份/权限/包和模块证明、资源确认/版本/有效期；失效或证明panic设置本次既有取消标志。最多两个监视器，随作用域正常/异常退出并join；无新队列/长期线程。资源配额持有至Worker回收、管道和监视器退出，保留结果前复核；进程清理失败优先返回worker_cleanup_failed，不能被权限错误覆盖。两项并发、五秒执行和全部字节预算不扩大。无新HTTP/SDK权限，仍为内部资源候选，不发布resource.v1。

最终资源域12项Rust通过/1项环境专项ignored；该环境专项随后显式运行1项通过，未把ignored算通过。实际HTTP当前源码Host+Studio自有WAT+现有兼容EXE首次五场景通过，加入模块变更后六场景通过；最终build:local更新EXE后同配置六场景再通过。六项为权限撤销、插件停用、凭据轮换、模块内容变化、资源撤销、实例停止；全部无需主动cancel调用，观察自动取消信号后同PID cancel_live/reaped/pipes_closed，配额释放且无旧result。五种可恢复情形重新授权/恢复后新材料新UUID执行成功。原有未确认拒绝、严格schema/桌面鉴权、两项满载429、HTTP断开不释放实际配额、busy期间bootstrap及锁可用、显式取消恢复、128条内存审计回归通过。

最终六次检测样本(ms)：permission=89, disabled=83, credential=94, module=100, resource=104, runtime=90。这是启动观察点暂挂的控制实验，不是性能分位数或100ms SLA，也不是WASI算法指令级中断证明。模块场景改的是自有临时夹具字节并恢复，不代表签名包更新/回滚已验。运行实例仍为Host测试内存登记；没有原生操作系统界面/真实Pi实例或DevTools图片算法验收。证明检查可能产生模块摘要IO和锁等待，低端CPU/IO/内存压力仍待。进程清理失败优先分支为代码保护，未注入真实kill/wait失败。

Rust all-target check/strict clippy通过，fmt既有漂移保留；仅格式化两个自有新模块，未格式化冻结包。初次环境专项误加不存在的exact-filter-ignored参数，测试未执行，actual-host.log保留；改正参数后通过，无预算放宽。证明/执行panic单元测试打印的synthetic失败为预期注入，不是未处理的产品错误。普通资源域测试日志resource-tests-final.log，实际终态actual-host-delivery.log/json，源码门槛rust-static-final.log。

只修改Studio、保留原716项dirty；不改DevTools或冻结提供方包。0.1.0不变，复用单target及D:/Work/.caches/cargo，build:local --debug --no-bundle，无installer/ZIP/全运行目录副本；完整target/debug和EXE保留，SHA 1e2fc4e87138dd6b7a52f80ce7b8e7a91d5e0afce5a379f4f16ff8890510d416。最终4项public源码与运行目录摘要一致，Rust源码摘要列于delivery.json。成功Host专项按原有路径校验清除自身临时目录；历史失败host-resource-worker-d56bb201-62dc-4ed4-8473-d2bff10430bb保留。之前两个目录测试插件删除被审批拒绝仍保留，本轮没有重试该删除或绕过。无释放卷空间主张。

前扫描终态后才测试/构建，后扫描亦exit0，UnknownEntries0；逻辑树不可相加，保留有用缓存：
- E:\zicode-studio-desktop\target：逻辑差异 129552620 B。
- E:\zicode-studio-desktop\.cache：逻辑差异 0 B。
- E:\zicode-studio-desktop\.cache\task-scratch：逻辑差异 0 B。
- E:\zicode-studio-desktop\site：逻辑差异 0 B。

154项逐工具状态和fullToolsAccepted=0不变。资源Host生命周期取得进展，但图片/文件实包、二进制输出登记/预览、跨工具资源接力、显式保存、持久审计、原生运行中撤权/停止、正式升级/回滚和其他OS仍待；不能将六项夹具实验推广为全部工具接受。协议说明docs/plugins/resource-worker-lifecycle.md；[阶段工作日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-worker-lifecycle-2026-10-10/work-log.md)、verification-summary.json、actual-host-result-delivery.json及delivery.json是本轮证据。goal active。

## 2026-10-10 有界模块证明读取

结果证明/资源捕获改为打开句柄后的固定缓冲区读取（最多2MiB+1），拒绝空/超限/短读/观察到的长度变化；借用快照同样校验。24项分域测试通过，ignored仍单列；资源真实HTTP专项七项失效在新debug EXE 50b0766d11ebb41a39fac7bef93d3c7055b80e2fe7b6b4b438cff15198ffdafb /0.1.0上复验通过，含模块超限自动取消/回收/管道结束及恢复。静态check/strict clippy/local build通过，复用缓存/运行目录，无ZIP。保持全部154项状态/full0；同长度写入/打开前替换、全局证明作用域、原生/其他OS/真实图片工具和二进制结果流仍待。详见[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/bounded-module-proof-2026-10-10/work-log.md)及docs/plugins/bounded-module-snapshots.md。goal active。

本轮清理补记：多输入 HTTP 成功夹具 `E:\zicode-studio-desktop\.cache\task-scratch\multi-input-http-2290b40a-d9e8-4562-8adb-446e9c477971` 保留 24 文件/329604 B；自动审批以“blocked by policy”拒绝精确目录删除，无更具体原因、未执行删除、未换方式重试。收据和摘要见 bounded-module-proof-2026-10-10 阶段，未声称释放空间。


## 2026-10-10 插件执行修订隔离

普通Worker完成校验和结果证明改为插件包/场景授权世代，无关插件权限、其他场景和无变化扫描不使本次结果失效；目标撤权/重授及字节相同的托管重装仍拦截旧调用。目录继续使用全局修订。56项相关测试通过（29 registry/3 detached/12 result/12 resource），ignored 3+1单列；两个显式环境专项用当前源码Host和当前0.1.0 EXE 4b3f1dba65db7ddb28b0624a90a9d1860dc4b4c092efb395208a76016ea1792d复验通过。资源专项新增无关修改后实际成功结果/回收/管道结束，原七项失效仍取消；DevTools冻结Base64包执行、确认保存和幂等通过。check/strict clippy/build:local通过，fmt既有漂移保留。完整154项状态/full0不变，原生Pi/GUI运行中生命周期、正式签名升级链路、其他OS和完整源scope仍待。详见[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/scoped-plugin-revisions-2026-10-10/work-log.md)和docs/plugins/scoped-execution-revisions.md。goal active。


## 2026-10-10 成功缓存授权绑定

成功调用缓存绑定插件包/场景授权世代、能力与模块摘要；目标撤权后重授/重装拒绝旧缓存，保留记录且不自动重算。无关插件/场景继续重放。新错误idempotency_authority_changed经HTTP409和客户端固定复核提示交付，不透传服务端message。初次Pi restored暴露客户端把新码隐藏为http_500，修复前失败证据保留。

23项Rust及23项客户端测试通过；3个显式环境专项在当前源码Host+新0.1.0 EXE a762416337d14b73739dc5d0b32a641451b882344990d3b33c000a9bad2f1d82通过：真实缓存仅1Worker且3次旧缓存拒绝不重启，跨插件接力确认/幂等，Pi动态目录/加载/7样例/10授权阶段/21旧授权缓存拒绝/35旧目录拒绝/6独立对照。18Pi Worker全部回收/管道结束，阶段启动数匹配。Text13/Inspect493冻结文件收据核验通过。check/strict clippy/build:local通过，fmt既有漂移保留；typecheck仍两项Habits/Watch既有错误，未修改其他工作。

154范围/full0保持，非原生GUI或模型自主调用/全源scope/其他OS/跨重启永久幂等接受。详见[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/cache-authority-2026-10-10/work-log.md)及docs/plugins/cached-call-authority.md。goal active。

清理：本轮三个Pi目录1562文件/7476337 B已存证，删除被自动审批以blocked by policy拒绝，无更具体原因，0文件移除、不换方式；准确路径见阶段cleanup-candidates.json。此前已拒绝目录未触及。


## 2026-10-10 资源Worker原始二进制输出基础

内部resource.wasi.output.draft1支持guest创建/64KiB分块追加/精确长度封存，最多四项合计32MiB、4096次调用；显式选择仅限input draft2模块快照。原始帧携带严格版本/类型/长度/SHA-256描述符，不使用Base64；未封存、trap、非零退出和非法JSON丢弃所有输出。独立模块承载实现，大型plugin_worker.rs仅必要接线，保留其他工作。

20项Worker测试通过、4 ignored单列；其中两项真实环境专项显式运行通过。新0.1.0 EXE a09b982e19efd7caf4c0d055d2e32996941f3452bbfde9107c4f5e5f2c566d45完成2MiB原始输出及恢复、四类拒绝/失败、启动取消/过期deadline，8个Worker全部回收/管道结束。旧资源Host真实HTTP授权/配额/取消/断连/七项失效/无关修改成功路径回归通过。Host由源码测试进程启动，不是独立GUI；WAT为Studio传输夹具，不是DevTools图片算法。初次guest测试夹具错误和clippy失败均保留；修正后check/strict clippy/build:local通过，fmt既有漂移保留。

完整154项状态/fullToolsAccepted=0不变。生产Host尚未启用输出profile或登记/预览/接力/确认保存，实际图片算法、完整源scope、原生GUI及其他OS仍待；不能把承载基础通过视作全工具接入完成。协议[resource-worker-output-candidate.md](E:/zicode-studio-desktop/docs/plugins/resource-worker-output-candidate.md)，证据[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/binary-worker-output-2026-10-10/work-log.md)和verification-summary.json。goal active。


## 2026-10-10 Host派生输出资源登记

资源Host新增manifest显式resource.wasi.output.draft1选择、原始帧验证及结果schema校验，整组原子登记到现有资源库。原owner、来源证明和父资源授权链保持；原输入撤销/过期清理后代。输出与输入共享32条/128MiB预留，单次最多4项/32MiB；两个Worker/五秒保持，不授予文件写入或跨工具权限。旧JSON通道保持。

16项资源域测试通过、1 ignored单列；增强真实HTTP专项用源码Host和新0.1.0 EXE 37fecec8ee9b8a4120f427908a54d9e2953201fc3f5bb7f4ae42c37b596f9bb6通过：2MiB输入→二进制输出→资源登记→同owner再次执行→完整分块读回，越权拒绝、祖先级联撤销，已封存后trap及声明outputSchema错误都未登记资源。4个新输出Worker全部回收/管道结束；原旧资源HTTP授权/两槽配额/取消/断连/七项自动失效/无关修改成功/运行时停止回归同次通过。初版3Worker通过记录保留；追加schema校验后重新check/strict clippy/build与实测。fmt既有漂移保留。

全部154项状态/fullToolsAccepted=0不变；可信预览/媒体检查、跨工具用户授权、确认保存、持久审计/幂等、实际DevTools图片文件算法、原生GUI/Pi交互和其他OS仍待。不要把同owner链式执行称跨工具接力，也不要把内部confirmed可读标记称用户批准保存。旧JSON资源结果schema尚待统一。文档[Host输出候选](E:/zicode-studio-desktop/docs/plugins/resource-host-output-candidate.md)，证据[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/host-binary-output-2026-10-10/work-log.md)及verification-summary.json。goal active。


## 2026-10-10 二进制输出发布前复核

输出摘要/描述符准备移到资源库锁外，准备完成后复核当前授权、源资源、共享配额和取消，再整组插入；不增加排队/缓存/profile。19项资源域测试通过，1 ignored另行显式运行。新0.1.0 EXE 563c368be723f23ad3292f1d0d4b5be271a627ce53c1534c04f83650de03ce4a的增强真实HTTP专项通过：Worker已结束/完整2MiB输出准备好但尚未登记时，取消、源撤销、权限撤销、禁用、凭据变化及准备后占满配额六项均零输出登记；无关插件变更保持成功。七项均确认库锁可获取、原Worker已回收/管道结束和最终槽位释放。连同旧2MiB读回/链式执行/schema失败样例，本轮11个二进制输出Worker闭合；旧JSON生命周期专项同次回归通过。check/strict clippy/build:local通过，fmt既有漂移保留。

154项工具状态/fullToolsAccepted=0保持；以上是源码Host测试构建的确定性发布前观察点与真实生产Worker，非原生GUI/Pi/DevTools算法或全部指令窗口/OS接受。可信预览、跨owner用户确认传递、保存、幂等/持久审计、实际提供方资源包仍待。文档[输出发布边界](E:/zicode-studio-desktop/docs/plugins/resource-output-publication.md)，证据[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/output-publication-2026-10-10/work-log.md)及verification-summary.json。goal active。

## 2026-10-10 插件资源输出预览

可信父级新增按点击读取的PNG/JPEG/WebP、纯文本和二进制预览；引用白名单、完整SHA-256、字节/像素预算、关闭/切换清理及每5秒授权复核。大型View Host只做必要接线，未覆盖其他修改。37项定向前端测试、check与Rust check/严格clippy通过；fmt既有漂移保留。真实HTTP Host+生产Worker+Edge隔离页面已完整验证发现→加载→执行→展示，五类输出、4097宽PNG拒绝、源撤销清屏/取消共享及4个Blob URL全部释放；桌面1280x900明暗/390x844深色截图已实看，补拍稳定主题后控件可读，无横向溢出，无页面脚本错误，仅故意撤销时一次预期HTTP拒绝。

这不是原生GUI或DevTools算法接受；跨owner授权接力/确认保存、完整源scope/审计/幂等和其他OS继续待验。154项工具/fullToolsAccepted=0保持；逐项阻塞原因与重开条件继续按matrix。版本0.1.0不变；复用单target，build:local保留target/debug完整运行目录与EXE，不生成ZIP或新完整副本。使用测试自有复制夹具，提供方冻结包未修改。三个失败浏览器初始化/按钮定位记录均保留，与通过证据并列。

文档：[预览边界](E:/zicode-studio-desktop/docs/plugins/resource-output-preview.md)；[本轮阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-output-preview-2026-10-10/work-log.md)。

## 2026-10-10 资源跨工具授权基础

新增内部resource.transfer.draft1两步Host接口：准备无目标读取权；仅桌面明确确认后生成同runtime/session中目标插件/能力专属引用，16张/60秒票据，32条/128MiB配额，重复确认返回原引用、不重复登记。不可变Arc分块避免锁内复制大字节。显式祖先owner/proof贯穿读取、Worker运行和输出登记；源撤销/过期级联，双方撤权重授拒绝旧授权，未开放任意路径、Broker转授权或写盘。大型host_server.rs只增加路由与桌面白名单接线。

25项资源域测试通过（1 ignored另行显式执行），check/严格clippy通过，fmt既有漂移保留，frontend check/设计回归通过。0.1.0本地EXE fae1acb22439612428f31c0f42ca81fdd155dd27ae0773c36451e2623469d346实际专项通过：Studio自有源Worker生成300000字节原始输出→准备/确认→另一插件Worker消费；32KiB读回对照、Broker/未确认/owner覆盖拒绝、重复确认单记录、双方撤权重授拒绝、有效新来源撤销级联与独立目标输入成功。旧授权/配额/取消/断连/输出发布七边界和Edge预览同次回归通过。

当前是Host协议接受，尚未接入接收工具搜索/分页/确认与切换界面，非原生GUI、人类实际确认、真实DevTools算法或其他OS接受。正式resource.v1、跨会话、持久审计/幂等、确认保存与冲突恢复仍待。154条/fullToolsAccepted=0不变，资源类原因已更新为候选Host已验证而真实界面/正式协议/实包仍缺。单target缓存与完整target/debug/EXE保留，不生成ZIP。

文档：[跨工具候选](E:/zicode-studio-desktop/docs/plugins/resource-transfer-candidate.md)；证据：[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-transfer-grants-2026-10-10/work-log.md)与actual-host-transfer-attempt1.json。goal active。

## 2026-10-10 资源转交界面

可信父级新增独立接收工具对话框，复用统一目录每页40项与选中后参数加载，不增加工具侧栏图标。共享检查/取消/确认与运行分开，复用类型表单和资源Worker；关闭/Escape/切换/迟到响应回收引用，执行中独立取消。结果授权每5秒复核，撤权清屏；固定超时/取消/授权提示，不自动重试。大型View Host仅必要接线，原740项工作树修改与冻结提供方包保留。

41项前端测试、7项目录测试、check/严格clippy通过，fmt既有漂移保留；全量typecheck仍仅Habits/Watch两项既有错误。当前0.1.0 EXE bb7ba977e23d5f75a9e10ce68d60f30d2dab376b86140d5d71782c65eddc5ed9 完成源码HTTP Host+生产Worker+Edge实际链路：源输出→目录→参数→取消确认不授权→明确共享不执行→独立运行→展示；false/0保留，目标撤权5秒内清结果、其他工具正常。旧资源生命周期、输出发布边界、跨owner授权和五类预览同次回归通过。1280×900明亮确认、390×844深色结果/撤权截图已实看：实色对话框、固定关闭、确认说明与结果可读，无横向溢出/错误覆盖；无页面脚本错误，两次故意撤权HTTP拒绝符合预期，5/5 Blob URL释放。

首轮接收夹具缺版本声明、早期拥挤布局和透明对话框的失败/截图均保留，修复后重跑。Browser plugin not available，沿用已有Playwright/Edge，非原生WebView或DevTools图片算法接受；确认保存、真实提供方实包/完整scope、多跳交互、正式协议/持久审计和其他OS仍待。154条/fullToolsAccepted=0保持。单target/已有Cargo缓存、完整target/debug与EXE保留，不改版本/发布/复制运行目录/生成ZIP。存储终态UnknownEntries=0；本轮保留明确失败23文件93029 B，未重试历史拒绝删除。详见[界面说明](E:/zicode-studio-desktop/docs/plugins/resource-transfer-ui.md)与[阶段记录](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-transfer-ui-2026-10-10/work-log.md)。goal active。

## 2026-10-10 资源输出确认保存

新增内部resource.save.draft1与可信父级保存对话框：准备仅元数据，不写盘；用户确认后以生成名称写入当前项目.zicode/outputs，原始二进制与来源收据各自刷盘，不覆盖已有文件。票据60秒/最多16张，绑定源/祖先授权、项目位置及存储授权世代；重复确认核验字节和收据，不新增文件，用户编辑后拒绝重放。32MiB单资源、128目录/256MiB项目预算只限制新保存，不删除用户数据。大型View Host/HTTP facade只必要接线，新逻辑独立模块。

40项前端、31项资源域测试通过（1 ignored另行显式运行）；check/strict clippy/build:local通过，fmt既有漂移保留，全量typecheck仍仅Habits/Watch两个既有测试mock错误。0.1.0 EXE 5718a655be11cd311c0c78d0ddda5105e39a03ebb4f9a0b88ac4cde32d363b1a 完成真实HTTP源码Host+生产Worker+Edge：300000字节原始输出保存、同票据重放、用户编辑保留、Broker/路径覆盖/未确认拒绝、存储撤权重授/项目改变/祖先撤销拒绝，发布前两类撤权清理未发布字节且资源库锁可获取，独立新资源仍正常。浏览器发现→加载→执行→预览→取消保存无磁盘变化→确认保存精确PNG/来源→重放不增文件通过，跨工具接力/五类预览/撤权清屏同次回归通过。

1280×900明亮保存确认与390×844深色成功/撤权截图已实看：不透明对话框、路径换行、关闭/确认可见，无横向溢出/错误覆盖；无页面脚本错误，只有两次故意撤权的预期HTTP拒绝，5/5 Blob URL释放。Browser plugin not available，使用已有Playwright/Edge隔离生产模块页面；临时本机端口结束后关闭，未保留具体端口。不是原生WebView、人类文件体验或真实DevTools资源算法验收。

两次真实环境失败均为测试恢复/顺序问题：撤销required权限同时禁用插件；旧票据在授权世代变化后应先被拒绝，文件编辑断言需先测。仅修正Studio测试，失败日志/自有目录保留。提供方冻结包未改，154条状态/fullToolsAccepted=0保持。正式resource.v1、真实算法包/完整scope、二进制交付物索引与备份、任意目的地/覆盖冲突恢复、跨重启幂等/崩溃恢复、多跳流程和其他OS仍待。持续目标active。

单target/已有Cargo缓存，完整target/debug运行目录与EXE保留，版本不变，无新发布/ZIP/完整运行副本。证据见[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-save-2026-10-10/work-log.md)、actual-host-resource-save-attempt3.json与browser-result-2026-10-09T21-57-53-384Z.json；协议见[资源保存候选](E:/zicode-studio-desktop/docs/plugins/resource-save-candidate.md)。最终存储统计另见阶段storage-after.txt和verification-summary.json。


## 2026-10-10 已保存插件文件库

交付物页面新增独立“已保存的插件文件”入口：按项目元数据搜索/40项分页，点击后核对来源记录版本/原始字节SHA-256并安全预览或明确下载，不新增工具侧栏图标，不复制原始文件到第二套索引。保存副本独立于源临时资源授权；当前交付物存储权限仍须有效，撤权5秒复核后清预览。选中预览位于列表上方，下载为正常状态提示；切换只重置自身组件，不重挂共享容器覆盖其他工具。大型Host facade只路由接线，ArtifactApp只必要组合，逻辑独立模块。

28项前端/5文件、36项资源域测试通过（1 ignored另行显式运行），check/strict clippy/local build通过，fmt既有漂移保留；typecheck仍仅Habits/Watch两个既有mock错误。当前0.1.0 EXE 5ea0dfe82bc8fef11409472ef6856c41977c21eaa6c9dd0f49f2ad842f268e67 的实际HTTP源码Host+生产Worker+Edge完整流程通过：发现→加载→执行→保存→项目库搜索→校验预览→原始PNG下载，字节完全一致、项目目录不增副本；同长度编辑保留/拒绝、收据替换拒绝、跨项目/Broker/路径覆盖拒绝、源撤销后批准副本仍可读、存储撤权清屏/重授恢复。旧资源生命周期/配额/取消/断连、输出发布/接力/保存/五类预览同次回归。

最终浏览器http://127.0.0.1:18508（临时端口已关闭），1280×900明亮预览、390×844深色下载/撤权截图已实看：无旧容器空白、路径换行/控件可读、预览靠前、无横向溢出/错误覆盖。页面脚本错误0，四次故意撤权/编辑HTTP拒绝符合预期，Blob URL 8/8回收。Browser plugin not available，使用已有Playwright/Edge隔离生产模块页面，非原生WebView/提供方算法或其他OS接受。

初次generic测试类型推断/可访问性/URL mock失败、早期验证容器空白、搜索过渡定位失败均保留。修正真实setTarget重挂风险并补其他活动工具容器回归；中间通过与最终通过分开，最终见actual-host-library-attempt3.json、browser-result-2026-10-09T22-31-46-962Z.json和verification-summary.json。

154条状态/fullToolsAccepted=0保持；18项资源工具加image-workflow的原因已按各自scope细化，新增[接口需求](E:/zicode-studio-desktop/docs/plugins/devtools-resource-library-gaps.md)，明确目录枚举、多文件/100项批量、图片预览像素差异、HTML/SQLite交付类型、持久记录/提醒等尚缺条件。未修改DevTools或冻结包、未发送跨会话消息。正式resource.v1、二进制备份/导入与统一交付物、持久副本重新授权给工具、原生下载/真实算法包/全scope/并发性能/其他OS仍待。

缓存/版本配置保持，完整target/debug和EXE保留，无ZIP/新发布/完整运行副本。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 12919088 B/49文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 149714 B/37文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-17440768 B，与逻辑字节分列；失败自有夹具保留37文件/149714 B，没有重试任何历史拒绝清理。持续goal active。

协议：[文件库候选](E:/zicode-studio-desktop/docs/plugins/saved-output-library-candidate.md)；证据：[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/saved-output-library-2026-10-10/work-log.md)。


## 2026-10-10 已保存结果作为工具输入

插件主视图可信文件选择区新增“从项目已保存文件选择”：按当前项目搜索/40项分页，只读元数据，选中后收起列表露出接收插件版本及确认。确认后读取收据版本和SHA校验原始字节，复用接收方runtime/session/capability绑定的临时资源上传；不会自动运行、不新增持久副本，取消/改选/销毁撤销临时授权。独立saved-output-picker模块，CapabilityGateway最小接线，上传增加所选摘要核对；未修改DevTools/冻结包。

37项相关前端测试、check和i18n检查通过；实际HTTP Host+已有生产Worker+Edge回归通过：生产输出PNG→用户保存→搜索/选择不读字节→明确确认→接收方临时快照→独立点击运行→另一个Worker返回received→取消撤权且保存文件哈希不变。实际完整资源/输出/保存/文件库回归同次通过，页面脚本错误0，5次预期HTTP拒绝，Blob URL 8/8回收。最终浏览器http://127.0.0.1:13781（已关闭），1280×900明亮确认/390×844深色结果截图已实看。初轮截图发现确认按钮被列表推到滚动区下方，改为选中后收起列表并重验通过；早期通过不作为最终UI接受。运行按钮为独立验证适配，非原生完整界面/提供方算法接受。

初轮一个切换用例错误要求已失效旧视图重启控件，改按实际宿主销毁旧视图验证不发布；失败记录保留。最终证据actual-host-attempt2.json、browser-result-2026-10-09T22-48-14-094Z.json、verification-summary.json。

该实现为可信父界面重新上传，非Host零复制导入/签名来源链；文件库读取完成后持有的内存快照不随之后的存储撤权回收，接收权限仍实时校验。无主视图工具入口、正式导入协议、二进制备份/导入、原生WebView/真实DevTools包/全scope/其他OS仍待。154条工具及完整接受0保持，goal active。详见[候选说明](E:/zicode-studio-desktop/docs/plugins/saved-output-input-candidate.md)。

没有版本变更/新发布/ZIP/完整运行目录复制，未改Rust/React，debug解析主动使用项目public，复用完整target/debug及原生产Worker EXE 5ea0dfe82bc8fef11409472ef6856c41977c21eaa6c9dd0f49f2ad842f268e67。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 574246 B/10文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 0 B/0文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-1466368 B，与逻辑字节分列；成功夹具按原有所有权检查清理，未重试历史拒绝清理。

[阶段记录](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/saved-output-input-2026-10-10/work-log.md)。


## 2026-10-10 工具目录资源工具统一入口

无主视图资源工具已接入生产工具中心：元数据搜索→按需加载Host资源profile详情→确认共享本机/已保存项目文件→类型参数→独立执行/取消→结果展示。无需提供方主视图或新侧栏图标；普通invoke不绕过资源权限。Host准备请求可选catalogRevision，目录入口始终绑定当前详情版本，身份→目录→身份复核，旧目录拒绝且不分配资源；执行前再次检查。独立JS runner/React桥复用资源模块，相同scope值/回调更新保留运行，真实session变化清理，子参数React root延后卸载避免父清理冲突。大型plugin-shell仅getTarget接线，其他逻辑独立。

88前端/18文件、7目录、36资源测试通过（1 ignored另行实际专项），check/strict clippy/local build通过；fmt既有漂移，typecheck仍仅Habits/Watch两个既有mock错误。当前0.1.0 EXE 9b4b27f75818f3896f3a181ba7c80dfdcf9d1fd6d38912ebbddca4e2f26186f3 的实际HTTP源码Host+生产Worker+Edge最终attempt4通过：生产ToolCenter发现→无主视图接收工具→项目PNG搜索选择不读字节→目录版本绑定明确共享→类型false/0参数→独立运行另一个Worker→received→取消撤权清屏且持久文件哈希不变；此前完整资源、输出、接力、保存、文件库/下载回归同次通过。新目录入口资源输出预览/保存/接力仅接线，尚未在该入口实际接受；不将旧主视图回归泛化为新入口接受。

最终浏览器http://127.0.0.1:65425（临时已关闭），1280×900明亮确认/390×844深色结果截图已实看；数值输入盒模型越界已修正并加入卡片边界检查，控件/路径可读，无框架覆盖/横向溢出。页面脚本错误0，5次预期HTTP拒绝，Blob URL 8/8回收。Browser plugin not available，已有Playwright/Edge隔离生产模块验证；不是原生完整应用、提供方算法或其他OS接受。

attempt1验证脚本重复变量（未生成浏览器收据）、attempt2旧标题定位超时、attempt3功能通过但窄屏越界均保留为过程证据；最终见actual-host-attempt4.json、browser-result-2026-10-10T00-44-44-062Z.json和verification-summary.json。两个失败自有夹具保留72文件/254267B，未重试历史拒绝清理。

构建将可信controller作为运行时模块引用，tool-center.js 42506 B，未把旧生成文件递归打包。沿用单target及Cargo缓存，完整target/debug与EXE保留，无新发布/版本变更/ZIP/完整运行副本。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 14189435 B/81文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 254267 B/72文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-875888640 B，与逻辑字节分列。static clippy本次91m24s后终结通过，未因耗时或容量清除可复用缓存。

154项逐工具状态及完整接受0不变，goal active。正式resource.v1/来源链、目录入口资源输出实际验收、原生WebView/真实DevTools包完整scope、二进制备份/导入与其他OS仍待。[候选说明](E:/zicode-studio-desktop/docs/plugins/directory-resource-tools-candidate.md)；[阶段记录](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/directory-resource-tools-2026-10-10/work-log.md)。
## 2026-10-10 目录入口资源输出补充验证

本次补齐目录入口的真实资源输出验证：生产ToolCenter搜索文件输出示例→按需详情→明确共享输入→独立生产Worker生成PNG→按需预览→保存预览取消不写盘→明确确认保存原字节→选取另一工具并填写false/0参数→确认共享后独立执行接收Worker→展示received→撤销源输入清除临时预览/结果而保留已批准磁盘副本。该目录路径没有提供方iframe。

实际HTTP Host专项1通过（52.32s），复用已验证且相关Rust源摘要一致的测试Host及当前0.1.0/Pi1.1.0 debug EXE 6c14d757c277b87040f7c98c592e4e8380368a0ef4536d4641f38a428844ba6b。生产UI/Worker实际行为通过，不等于原生完整WebView或提供方算法验收。最终页面http://127.0.0.1:41108已关闭；页面脚本错误0，5次预期撤权/文件变更HTTP拒绝，Blob9/9回收。

已实看1280×900明亮保存确认与390×844深色转交结果截图：对话框背景/正文/生成路径可读，false/0及接收结果可见，无框架覆盖或横向越界。本轮无需修改生产代码或重新构建，也没有修改冻结提供方包。证据：技术档案iterations/directory-resource-output-2026-10-10/actual-host-attempt1.json、browser-result-2026-10-10T01-02-39-225Z.json、verification-summary.json。此前“目录资源输出仅接线”属于历史验证边界，本条补充该入口接受证据，不改写历史记录。

154条工具状态及完整工具接受0不变。正式resource.v1与签名来源链、多输入/目录/批量、真实DevTools包完整scope、原生完整应用与其他OS仍待。

## 2026-10-10 工具详情异常隔离
独立React异常边界保留其他工具/目录，失败不自动重试；共享vendor补Component并增加回归。真实HTTP Host+生产Worker+生产ToolCenter故障注入通过，桌面/窄屏截图已实看。页面脚本错误0，预期React捕获日志1/预期HTTP拒绝5，Blob9/9回收。94项前端通过；typecheck仅既有Habits/Watch错误。最初vendor缺导出失败保留，最终attempt2通过。未新增原生EXE构建/版本/ZIP/完整运行副本，154项完整接受仍0。详见[说明](E:/zicode-studio-desktop/docs/plugins/tool-view-failure-isolation.md)及技术档案iterations/tool-failure-isolation-2026-10-10。

## 2026-10-10 Pi1.1.0真实DevTools链路
当前debug EXE保持6c14d757，单target编译新版Pi锁定测试Host一次，Inspect7/Transforms23基本操作与各10权限阶段通过；150旧缓存拒绝、11独立对照、50Worker回收/管道关闭。三个原始包13/493/797文件逐SHA通过。矩阵current证据更新，旧记录保留历史；154项状态及完整接受0不变。没有模型/原生界面/其他OS/签名生命周期验收。清理本轮两夹具被自动审批拒绝（无具体原因），实际删除0，6812396B/1346文件保留并给手工清单；不重试。详见[复验记录](E:/zicode-studio-desktop/docs/plugins/pi-1.1-devtools-acceptance.md)及技术档案iterations/pi-1.1-devtools-2026-10-10。

## 2026-10-11 资源调用状态与可信界面恢复

Studio 目录资源工具及跨工具接力现支持调用前捕获 Host 身份、执行请求实例校验、响应丢失后保留调用并显式核对。未知、活动或 Host 更换均不自动解锁；原 Host 匹配 finished 才允许用户发起新调用，明确原结果未恢复。没有自动保存/重试或向提供方 iframe 增加权限。

165项前端、42项资源Rust、严格静态与真实HTTP Host/生产Worker最终专项通过（13.67秒）；桌面/窄屏5张最终截图已检查。接力和目录各一次真实执行的成功响应被代理扣留，随后独立核对结束、没有额外执行或项目文件写入；未知记录和Host变化为代理注入的UI分支，不是完整原生重启验收。

154项工具矩阵/完整接受0不变。资源类尚缺一次性准入与延迟请求封存、控制器销毁及跨重启的调用恢复、原结果恢复、正式resource.v1及真实DevTools完整scope；Host责任由Studio继续推进，提供方无需因此修改既有Worker ABI。见[资源状态契约](resource-call-status.md)及技术档案iterations/resource-call-recovery-ui-2026-10-11/work-log.md。保持0.4.2，没有新安装包或ZIP，target净增5.03MiB，沿用既有缓存。

## 2026-10-11 Host一次性调用准入

新增Studio-only resource.call.admission.draft1候选：Host生成带前缀的调用凭据并绑定资源/输入摘要与完整scope；消费和恢复封存在同锁内互斥；已消费/封存/过期/淘汰的凭据不能再次执行，缺失凭据也不重新创建。活动恢复只设置取消标记，直到lease释放才确认结束；恢复接口有状态，不能称为只读查询。

46项资源Rust回归（含100轮消费/恢复竞态）及真实Host/正式Worker最终专项10.57秒通过，严格Rust静态通过。新接口只允许桌面身份，不读取文件/启动Worker来准备调用，不改变提供方ABI。当前目录/接力父界面尚未采用新接口，旧unknown限制、控制器销毁与跨重启恢复仍待；154项完整接受保持0。[契约](resource-call-admission.md)与技术档案iterations/resource-call-admission-2026-10-11/work-log.md记录边界与首轮夹具失败。


## 2026-10-11 一次性资源调用界面接入
目录与接力父界面已采用resource.call.admission.draft1：Host颁发凭据、一次消费、输入/资源快照、显式“停止并恢复调用”。恢复会封存未开始请求或请求取消，四类结果分别展示；原Host不符/无效证明继续限制再次运行，不恢复原输出、不自动重放/保存，旧iframe路径不变。
226项插件前端测试、check及真实HTTP Host/正式Worker+Edge最终13.25秒通过。目录和接力各扣留一次成功响应后恢复；先封存再投递迟到请求被真实Host拒绝且无新增Worker审计。6张1280×900浅色/390×844深色截图已检查；活动与Host更换为代理注入，非真实重启验收。
154项完整接受仍0。控制器关闭/刷新/跨Host重启的持久恢复、原输出恢复、正式resource.v1、真实DevTools全scope与其他OS仍待。版本0.4.2不变，无新应用构建/安装包。技术档案iterations/resource-call-admission-ui-2026-10-11记录原始失败和最终证据。


## 2026-10-11 本地调用恢复记录
目录与接力执行前先提交本地IndexedDB元数据，失败/满额/同工具存在待核对记录均不启动执行。工具中心可在关闭工具或同origin刷新后查找记录，显示应用与工具名称，显式封存/取消并验证原Host结束后移除；忘记记录需明确确认，不等于执行已结束。记录最多128条，不保留输入/输出/路径/凭据，不自动淘汰未确认记录。
324项插件与工具中心前端测试、check、类型检查及React构建通过。真实Host/正式Worker+Edge最终16.24秒验证了并发128上限、第二仓库实例读取、项目隔离、刷新后记录恢复、新执行被待确认记录阻止、显式恢复后用户新运行成功。没有自动重放或项目文件保存，11图留存，其中6张代表性桌面/窄屏图已实看。两次验证脚本断言错误保留，未放宽生产准入/权限或断言范围。
154项完整接受仍0。跨Host/换origin、原生进程崩溃与安装迁移、原结果恢复、正式resource.v1和真实DevTools全集仍待；本地记录不是持久执行收据。target净增0，保留失败夹具211,752B；版本0.4.2与正式安装包未变。见[恢复记录契约](resource-call-journal.md)及技术档案iterations/resource-call-journal-2026-10-11/work-log.md。

2026-10-11 补充：[三个实包间的文本接力](cross-package-transfer.md)完成真实Windows JSON/YAML/URL往返、明确确认和JWT输入业务失败后改选恢复；1来源invoke/5接力commit/0保存，双视口截图实看。仅限定样例，完整154接受仍0。
