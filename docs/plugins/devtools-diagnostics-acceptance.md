# DevTools诊断候选接收与接口需求

日期2026-10-09，阶段进行中。全部目录目标继续覆盖154项，完整工具验收仍0。

## 已接收的实包

提供方交付 `diagnostics-0.1.0-candidate-01`，包ID `com.zicode.devtools.diagnostics`、包版本0.1.0，11项能力的工具版本1.1.1，源码revision `d97f9ce83acb984c539881feed6be986002b06d9`、dirty=true。它是未签名目录，包摘要为null；目录索引摘要不能冒充签名容器摘要。

Studio已独立核对53文件、2,150,827字节，与包外verification的每项大小/SHA256一致，复制后再次核对。固定接收材料在 `tests/fixtures/devtools-diagnostics-candidate01`，包含模块、View、schema、catalog及许可证。Studio不引用提供方源码、核心crate、独立EXE或配置。提供方源码目录 `plugins/diagnostics` 缺少runtime模块，不能代替冻结交付包。

## 能力与未覆盖范围

| 来源工具 | 候选能力后缀 | 当前包范围 |
| --- | --- | --- |
| java-thread-dump | java.threads | 导入线程转储文本，非进程采集 |
| java-dependencies | java.dependencies | 导入Maven/Gradle文本，非执行构建 |
| java-gc-log | java.gc | 导入GC文本，非文件/进程采集 |
| java-jfr | java.jfr_json | JFR导出JSON，非二进制JFR或启动JDK |
| spring-config | spring.config | 两份JSON/YAML比较与脱敏，非Actuator访问 |
| django-migrations | django.migrations | 导入计划与可选SQL，非迁移执行 |
| django-sql | django.sql | 查询日志JSON分析，非数据库执行 |
| django-urls | django.urls | 路由JSON及可选查询，非项目加载 |
| django-drf | django.openapi | 两份OpenAPI JSON，非远程API |
| django-checks | django.checks | 导入check输出，非manage.py执行 |
| celery-diagnostics | celery.report | 导入任务日志，非连接Broker |

全部源工具的更大scope继续保存在全工具矩阵；候选能力不能代表完整源功能或平台支持。

## 协议候选评审

提供方标识 `diagnostics.compute.wasi.v1.proposal`，未被发布为Studio支持profile。外层command结构沿用1.0.0-rc.1，包含pluginId/sceneId/capabilityId/commandId（null）/input；目标能力严格枚举。input严格允许text及可选secondary，各限8192 UTF-8字节；请求与完整序列化结果各限48KiB。sceneId限1–128 UTF-8字节。JSON Schema maxLength是字符数，不代替字节预算。

成功返回严格 `{contractVersion,ok:true,data:{text},error:null}`，text为完整诊断JSON报告。失败返回data=null，code枚举 INVALID_INPUT/INPUT_TOO_LARGE/UNSUPPORTED_OPERATION/INVALID_REPORT/OUTPUT_TOO_LARGE，消息不含原报告或解析错误。后两项是诊断扩展，不得修改或伪称既有文本错误枚举已包含。Host通用结果传输不等于这些业务schema已获正式接收。

View使用既有公开capabilities.invoke，按Java/Django/Celery分类及保存内存草稿；八秒View等待超时不能取消Host任务，不能当作Host生产执行预算。没有持久报告库、进程/网络/数据库权限。

## 初次真实验证及失败

使用现有Studio调试EXE，SHA256 `635078339c28806587c932bf58cd3cbed725073694c075a66a12725a3821be8c`，调用真实Wasmtime Worker与固定提供方模块。模块1,898,081字节，小于2MiB上限；生产路径64MiB guest内存、1000万fuel、2MiB栈、五秒父进程截止保持不变。

首项java.threads在五秒截止内未完成，被测试驱动终止并等待退出：**生产兼容验收失败**。另用30秒诊断观察截止定位（不是生产预算变更）：java.threads/dependencies/gc/jfr_json/spring.config五项完成，严格结果结构与JSON报告非空核对，Spring合成敏感值未出现在结果中；第六项django.migrations返回Worker执行失败，后续五项与四负例未执行。未取得执行阶段/fuel归因证据，不能将其断言为fuel不足或算法缺陷，也不能把五项观察成功计作Host/Pi/View接入。

最早驱动正则遗漏View源码中的空格，未启动Worker，失败日志保留；修正的是驱动，未修改提供方包。没有用Node WASI或mock替换Studio引擎，没有放宽生产内存/fuel/超时。

证据在技术博客 `iterations/devtools-diagnostics-receive-2026-10-09`：package-receipt、provider-verification、worker-conformance-five-second-failure、worker-diagnostic-observation-result与失败日志。所有本次Worker退出后才结束观察，无本次残留Studio进程。

## 明确接口需求与下一步

1. **启动/执行预算**：提供方交付在Studio现有五秒/1000万fuel下的各能力证据，或提交独立版本化新profile提案，明确编译与算法预算、内存及取消。需要测量当前模块的冷编译耗时；Studio评审有界预编译/缓存或任务模型，不能默认把五秒增大或关闭fuel来通过。
2. **执行失败定位**：Studio需补固定原因的trap/fuel/memory/timeout诊断及来源版本关联，保持不记录报告或原解析器错误；提供方给出migrations样例在生产引擎的最小复现与全11项fixtures。未证明根因前共同保留该缺口。
3. **版本协商**：双方先固定诊断扩展标识、严格输入/输出schema、字节预算与错误枚举、输出结构的版本。未来manifest明确声明候选扩展，旧Host须拒绝/展示不支持，不能只靠包ID推断支持。
4. **真实接入**：预算与协议通过后验证实际Studio发现→按需加载→每项执行→显示；Pi需明确pi.tools.register授权，撤权/更新/卸载与超时/取消验证分别列证据。当前包尚未安装到实际原生验收profile。
5. **数据操作**：诊断结果可包含用户报告，跨工具传递、模型输入、持久保存必须分别固定版本、预览并确认；现有64KiB文本结果Store容量不是48KiB诊断协议验收证明。
6. **交付**：正式签名包、升级/回滚及其他OS仍待。保持独立程序，提供方输出可携带包与fixtures，不要求Studio读取其本机路径。

这些都是可继续推进的暂时缺口，不属于永久不能接入。11项候选接收状态与逐项理由已加入矩阵；不能因新包出现把完整工具验收计数提高。

## 后续引擎归因与优化构建比较

同日完成真实源码Wasmtime全11项观察（单独ignored专项，观察完成不表示插件通过）。调试构建冷编译记录约24.0–45.9秒；算法执行记录0–9毫秒（毫秒精度，0不是没有执行），说明前次五秒失败包含明显的调试编译成本。记录见engine-observation-result、engine-observation.log及engine-metrics。这是该次环境测量，非所有机器时延保证；并发系统工作影响时间，fuel是该固定模块/样例的确定预算证据。

9项样例在1000万fuel内成功；django.migrations和celery.report明确返回worker_fuel_exhausted，fuel_remaining=0。django.urls消耗9,915,761，剩余84,239，不能由小样例成功推断8192字节完整输入范围适配。

另复用现有优化冻结EXE，只执行`--zicode-plugin-worker`，未启动其旧GUI/普通用户数据。EXE SHA256 `e6adf68c72d2b4aa0dd47c7429b27f48e5ef249891de2517096087c4c4737478`。全11样例分别尝试，9项在五秒截止内完成，迁移/Celery失败；两项负例正确拒绝，UTF-8超限负例触发五秒超时，最后invalid-report负例未运行。完整专项exit1，不能标绿，也不能把这份旧EXE当新代码交付或具体Trap分类证据。该负例受限于当次观测，尚需最终优化源码/稳定环境复核。

明确下一步：9项不再笼统写为算法无法启动，先在更新优化构建完成Host/原生View/Pi及全部输入/输出边界；两项由提供方优化或提出版本化计算预算，Studio审查后才可采用。调试冷启动应评审开发构建优化或有界编译复用，不以调试时延直接扩大生产截止，也不因此增加无界磁盘缓存。提供方Node功能验证没有fuel计量，不能覆盖这两项失败。

Studio新增[固定执行错误分类](worker-failure-codes.md)，不输出原报告/guest堆栈。真实递归验证另发现原生线程栈不足：WASM限制2MiB可先耗尽测试线程的原生栈。生产Worker的WASI计算现采用固定8MiB原生执行线程以使2MiB guest栈trap可返回，guest内存/fuel/父进程截止均不变。源门槛、修复失败记录和实际更新EXE验证分别记录，不将未构建的新分类说成旧EXE已包含。

后续终态：完整Rust413通过/17ignored及严格Clippy、前端1594通过；当前EXE已重建为 `e5e0c45336ea24c88717a4c7b1c52bc3219082fb54cc682ce3c203cabf5ac0ac`。普通/资源帧真实失败分类与恢复、真实HTTP资源Host回归通过。全11诊断算法的编译/fuel观察发生在专用线程修复之前，作为当时归因记录保留；当前新EXE未重新完成诊断实包全部边界与原生链路，不把旧观察冒认为新EXE工具接入验收。guest预算未变，2项燃料问题继续由提供方与版本化profile评审处理。

具体可携带交接要求见[诊断接口需求](devtools-diagnostics-interface-request.md)及其JSON；固定已观察样例、现有预算、提供方交付物和Studio验收责任，不构成新profile支持声明。

## 当前优化源码的实包复核

2026-10-09使用当前target/release EXE，SHA256 `1bd9968d2f231b9eb07534bae1733e20bca4e99f083cace15f5b129861a172e9`，固定candidate01模块，生产五秒/1000万fuel等预算不变。11项独立执行：9样例成功；django.migrations、celery.report明确fuel耗尽。首项3232ms，其他成功样例1888–2107ms，仅本机该样例观察。

未知操作、未知字段、UTF8超限、无效报告四负例全部正确拒绝；末尾独立调用恢复通过。整体专项仍exit1，两失败完整保留。新证据补齐旧优化EXE负例未执行/超时的观察缺口，不覆盖精确最大字节有效输入、超大输出及完整源工具操作。真实Host/Pi/nativeUI未在本轮运行，不能提高完整工具验收计数。此EXE是验证产物，不是新冻结完整Windows交付；旧交付和缓存保持。证据见技术博客iterations/devtools-diagnostics-optimized-2026-10-09/current-worker-conformance-result.json与work-log。

加载校验另有待修复缺口：engines.pluginApi/zicode范围当前未强制匹配，诊断所需profile尚未在manifest中明确声明。目录/provenance的提案标识不是Host协商；后续通用机制和提供方声明需独立版本化，不能靠包ID放行。

后续源码已补通用engines.zicode/pluginApi已声明范围强制匹配及固定包兼容验证，完整Rust416通过/17ignored；见[Manifest门禁](manifest.md)。尚未重建EXE或完成required-profile声明/协商，因此上面的版本缺口仅解决引擎范围部分，诊断提案支持和真实Host/Pi/native接入仍未验收。

后续schema2 requiredProfiles源码门禁已通过完整Rust419项/17ignored；[声明规范](manifest.md)仅匹配冻结文本预览，诊断proposal仍拒绝。当前candidate01继续保留schema1原交付，未改包或扩大预算；源码协商基础不等于诊断profile已接收。后续提供方需按已批准扩展输出schema2声明，Studio实际新EXE/Host/Pi/native验收仍待。

## 实际Windows候选链路

当前优化EXE SHA256 af5a8964e7b7b96645f89ea54256b39f9bee3997d5a71eeed35aeadbeb677a5d构建10分19秒，真实隔离Tauri+managed Pi上下文，原样53文件schema1/unsigned候选发现/按需View/SDK→Host→WASI→报告显示：9样例成功（2006–2129ms），迁移/Celery返回HTTP500 worker_fuel_exhausted，输入保留，末尾恢复成功。整体专项exit1，不能标为兼容通过。Pi工具注册/调用、签名安装、完整边界/语义/生命周期/OS/结果操作未验收；profile proposal不改为支持。两次HTTP500解释consoleErrors=2，pageErrors=[]；不是控制台完全无错误。实际成功/失败/恢复浅色截图已读，失败提示笼统问题写入接口需求。证据技术博客iterations/native-devtools-diagnostics-2026-10-09。

## 诊断报告实际接力与确认持久化

合成java.threads报告656字节，在实际优化应用中搜索/选择提供方Base64编码及解码能力，确认后真实WASI执行，roundtrip与原报告逐字一致。取消发送预览零commit-transfer；最终仅两次确认commit-transfer。保存预览与取消前后交付物数量不变，确认仅一次commit-save/新增一条；正常退出再启动后通过实际Host读取，摘要仍与原报告一致。实际预览/保存截图已读，无page/console错误。自动化仅使用隔离profile合成材料并点击应用确认，不宣称真实用户批准了任何外部写入。不是整个诊断profile、其他报告范围、覆盖冲突、文件保存选择器、模型/Pi工具调用或其他OS验收。证据技术博客iterations/native-diagnostic-data-flow-2026-10-09。

## 真实嵌入Pi接入候选（2026-10-09）

新增独立ignored专项，当前源码Host+实际嵌入Pi+当前优化EXE Worker，未经修改的candidate01开发包。首次运行失败：dist与target运行broker一致但均过期，未包含源码已有的worker_fuel_exhausted/stack等白名单；前五项报告成功，第六项预算错误在Pi被降为http_500。保留初次exit101日志/receipt/6个Worker事件。重新构建现有extensions（无新依赖），只同步运行目录的plugin-broker.mjs，摘要0fc5972c28446fc5b994f3358caf0a897498c2ca50c7af6ba99d1dc98d58e67b。

最终专项exit0/29.80秒：启动仅搜索/加载2入口；未授权目录0项；授权后11项目录/真实Pi注册/active工具保留；11样例9报告、迁移/Celery明确worker_fuel_exhausted，末尾java.threads恢复。撤权后目录0项，缓存java.threads调用拒绝catalog_revision_changed；重新授权11项重新加载和java.threads恢复。取消搜索AbortError通过。撤权缓存/恢复执行只抽样线程工具，不能写为逐工具撤权调用均测；不是模型自动选择、完整GUI同次会话、签名安装、边界/语义或整个诊断profile验收。13次真实Worker启动/管道关闭PID匹配且终态无活Worker/Pi，Host.stop_and_wait成功。证据技术博客iterations/diagnostic-pi-tools-2026-10-09。全部154工具完整验收仍0。

接收/验证构建应先更新extensions产物并核对版本化运行资产摘要；仅源码测试通过或dist与运行资产彼此一致，不能证明产物来自当前源码。当前target运行目录的broker已修正，旧冻结Windows交付不修改。

## 全11项Pi权限/生命周期补充（2026-10-09）

源码Host/实际嵌入Pi/既有优化Worker的增强专项exit0，35.84秒。10阶段包括初始未授权、授权运行、撤权、恢复、禁用、重新启用、再次撤权、卸载、撤权后重装保持未授权、显式再次授权。11项在五个拒绝阶段均返回catalog_revision_changed，共55次；每阶段Worker启动数与明确合法调用数一致，没有拒绝后额外启动。文本独立插件Base64在五个拒绝场景分别实际执行成功。20次Worker启动/管道关闭PID匹配，终态无记录Worker及Pi，Host.stop_and_wait成功。

卸载只处理本次隔离profile内原样开发包；没有卸载源包/用户材料。既有规则保留数据与设置，这里先撤权再卸载，重装仍保持撤权；不是所有卸载自动清除权限。重新启用和重装再授权11项重新发现/加载，恢复执行仍只抽样线程工具，不冒充全部11执行边界或签名/升级回滚/GUI管理流程。原11分析仍9报告/2fuel，两失败不计接受。来源/模块/broker摘要均明确；源Host测试不代替实际GUI同次Pi会话与模型自主选工具。

接口要求已按用户协调授权发送到原会话zi-devtools（既有会话，不新建代理）；发送成功且实际观察恢复active。两项优化、全部边界/范围/公开错误码及profile提案要求明确，不修改提供方，不把请求或排队当成新插件交付。

## 候选02接收与生产重放（2026-10-09）

0.1.1/工具1.1.2/schema1/unsigned候选453文件5292517字节摘要一致，固定tests/fixtures/devtools-diagnostics-candidate02；candidate01历史保持。当前完整Windows阶段EXE e2e85f8f…生产Wasmtime Worker（固定EXE、精确引擎版本未由构建记录复核）的11基本样例通过，边界重放进行中已有五秒超时，不扩预算，不声明整体兼容。原始字节/重复字段/填充请求等生产Worker重建无法原样投递，单列skipped，不计通过。提供方188/9独立测试不替代本项。新包Host/Pi/View/正式profile/全scope仍待验收，154完整接受0。详见技术博客iterations/devtools-diagnostics-candidate02-2026-10-09。

最终同一handle43527 exit1：142执行、120语义结果通过、22 process_deadline、46原始外层用例skipped，共188。11基本样例通过；22失败都是五秒进程期限，不宣称燃料归因。142条close事件及实际进程检查remaining0。没有重启/提高预算；不是Host/Pi/View或全部scope验收。新包整体兼容仍失败，矩阵已更新终态。

2026-10-09 新诊断候选实际Windows（本机技术博客档案：`iterations/native-diagnostics-candidate02-2026-10-09/work-log.md`）：candidate02原样453摘要/版本0.1.1，实际发现/加载/SDK→Host→WASI→显示11样例与末尾恢复通过，12HTTP200。浅色1440×900/DPR1.25截图已读、page/console错误0，9进程正常退出remaining0。首次驱动对卡片版本错误预期失败记录保留。上轮22边界超时未抹去，新包Pi/正式profile/全scope/生命周期/其他OS待，154完整接受0。无新代码/构建/ZIP/cache删除。

候选02真实Pi专项两次失败已固定：未授权隐藏及独立Base64对照通过，第二次仅线程/依赖报告成功，随后worker_timeout；2+4 Worker均关闭/实际PID无残留，Host.stop_and_wait已执行，Pi关闭未单独PID复核。后续55缓存拒绝与生命周期未运行，不计通过；生产预算保持，提供方明确需求已发送。Rust gate67908尚在运行，不宣称测试门禁通过。详见iterations/diagnostic-candidate02-pi-2026-10-09。154完整验收0。

