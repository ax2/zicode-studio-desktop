# ZiFile 全功能插件接入清单与接口需求 draft2

Explorer 入口的能力筛选、菜单数量和多选边界见[资源管理器工具入口映射](explorer-tool-entry-policy.md)；菜单注册由 Studio 持有，ZiFile 插件不向系统逐工具注册菜单项。

2026-10-11 建立，2026-10-13 复核 Studio 接口。本清单覆盖现有独立产品能力；目前 Studio 接受的 ZiFile 功能为 **0**。这是接入前置记录，不是可安装插件发布。机器可读清单见 [18 格式 × 6 操作矩阵](zifile-integration-matrix.json)。

## 证据与范围

只读核对 ZiFile 0.1.15、提交 `327a993706f4423c23ad4f6b79646e29a178b5b1` 的当前工作树（有其他工作未提交）。矩阵附四份源码摘要；能力来自 `ArchiveFormat::ALL/CREATABLE/capabilities/create_input/supports_update`、`rename_archive` 及 Worker v3 枚举。源码声明不等于运行验证；本轮没有构建、执行、修改或复制 ZiFile。Studio 不依赖此本地源码目录。

| 格式 | 创建来源 | 声明加密 | 更新/删除条目、重命名 |
| --- | --- | --- | --- |
| ZIP、7z | 文件及目录 | 是 | 支持 |
| TAR、TAR.GZ、TAR.ZST、TAR.XZ、TAR.LZMA、TAR.BZ2、TAR.LZ4 | 文件及目录 | 否 | 支持 |
| Gzip、Zstandard、XZ、LZMA、Bzip2、LZ4、Brotli | 单文件 | 否 | 不支持多条目更新/重命名 |
| RAR、CAB | 文件及目录 | RAR是、CAB否 | 当前提供方明确不支持 |

18格式均有列出/解压/创建源码声明；Worker包含完整性校验操作，逐格式运行仍待实包验收。RAR/CAB为Beta、其余Alpha，均不得写成Studio已支持。矩阵总计108个格式操作单元，仅用于防止遗漏，不是108个独立工具的承诺。

## 暂不能接入的具体原因

1. **提供方交付**：没有收到版本化Studio插件、各OS/架构签名Worker、许可证/SBOM及契约向量。不能以独立ZiFile EXE、CLI或DLL替代插件。
2. **原生运行时**：Studio只有开发JavaScript Worker和WASI执行；原生进程的OS访问约束、进程树回收、取消/超时、升级/撤权、崩溃隔离没有完成。签名不等于沙箱，不能自动把原生二进制当作WASI执行。
3. **资源与密码**：ZiFile Worker v3直接接收绝对路径和可选密码字符串，不能把这些字段暴露给插件页面。缺少目录授权、受控暂存、内容版本和短期密码引用适配。
   Studio 现有可信目录与 Host 可将最多4个已确认普通文件（合计32 MiB）交给一次 WASI 调用；准入指纹和结果血缘绑定全部来源，任一来源撤销可使派生结果失效。这仍不是目录树授权或大归档流式输入，也未把 ZiFile 原生 Worker v3 的路径和密码转为安全资源引用。创建、比较、解压不能仅凭已有多文件界面宣称支持。
4. **大量条目**：v3输出逐行事件，但List实现先取得归档结果再输出。需要明确条目/字节预算、稳定分页和有界暂存；不能以“逐行JSON”宣称算法已流式或无限容量。当前通用JSON结果上限不能直接用来装整个大型归档目录。
5. **写入生命周期**：现有通用产物确认保存不是解压目录授权，也不是原包更新/删除授权。创建、解压、更新、删除、重命名均缺操作预览、目标冲突和版本核对、原子替换及崩溃恢复适配。
6. **提供方格式限制**：单流格式、RAR、CAB的update/rename被`supports_update`拒绝。理由和条件逐格保留；可在支持格式下明确解压再重建，但这是另一个需确认的工作流，不能自动降级成原包更新。

以上Host缺口可建设，不是永久判定无法接入。逐格blocker ID、责任方及替代方案见JSON；新增格式/功能须扩展清单。

## 给提供方的明确接口需求

保留独立ZiFile，输出独立`com.zicode.zifile.archive`包。无需改现有Worker v3，但需提供适配层；以下命名仍是draft，不得在`requiredProfiles`宣称Host已支持。

| 能力 | 请求与结果要求 |
| --- | --- |
| archive.formats | 返回18格式及逐操作能力、创建来源、等级范围、加密/格式版本；以包版本冻结 |
| archive.probe | 受授权资源引用，按签名识别；结果不泄露主机路径 |
| archive.list | resourceRef+内容版本、查询、页大小及不可伪造游标；返回条目ID、原始显示名、类型/大小/可用元数据和nextCursor |
| archive.test | 资源引用、可选passwordRef；有界进度及完整终态，密码错误区分于损坏，不能仅以进程退出0当完整成功 |
| archive.create | 授权源文件/目录、格式/等级/加密意图；prepare列出目标与冲突，commit使用一次性确认令牌 |
| archive.extract | 归档资源、条目ID集合或明确all、目标目录授权、冲突策略；路径穿越/链接/展开预算由Host与提供方双检 |
| archive.update / archive.remove | 原包资源+版本、添加资源/移除条目ID；prepare显示影响，commit原子替换，保留可恢复旧包直到终态 |
| archive.rename | 原包版本、条目ID到新归档相对名映射；冲突预览，禁止绝对路径/父目录逃逸；失败不留半完成原包 |

所有调用携带Host生成的callId、协议版本、插件/项目/场景身份、deadline及预算；页面只持有资源引用，不持有暂存绝对路径。适配层在受约束Worker内解析私有暂存输入，原生路径只在Host/Worker边界使用。不得从manifest、用户文本或归档文件指定任意可执行文件或shell。

Worker事件须回传callId、单调sequence、明确类型（started、entry/page、progress、result、error、cancelled、ended）。单事件/总字节/总条目/频率均有限额；先校验后转发页面。未知版本、串调用、重复或越序、终态后事件、截断、无终态、超预算均报协议错误，保留调用未知/失败状态，禁止自动重试写入。取消需确认Worker及所属子进程退出，原包/暂存的一致性单独证明。

2026-10-14 已给出[事件适配层 draft1 与可执行向量校验](zifile-adapter-events-draft1.md)。校验器覆盖有界单页、身份/顺序、终态和字段形状，但尚未接入 Host 的真实 native Worker，不能把协议夹具算入 108 格接受数。提供方应基于其 Worker v3 交付适配层事件及正反例；Studio 随后做资源版本、游标、防路径泄露与逐平台运行验收。

密码采用短期passwordRef，按调用解析，绝不进入清单、结果、日志、调用恢复记录或凭据导出。不能接受提供方回显原始Error.message作为页面错误，必须转换为有界错误码和本地化提示。

签名清单须包含每平台入口、完整依赖文件摘要、架构、协议/OS约束要求；包大小按实际签名文件清单评估。当前Studio包单文件10MiB、总量50MiB、Worker入口1–2MiB等现有不同门槛不适用于原生Worker，不能任意放大全局限制。后续单独版本化native profile并明确安装预览、预算和兼容性；未完成时必须明确拒绝。

## 桌面功能如何保留

| 独立产品功能 | Studio目标与当前缺口 |
| --- | --- |
| 搜索、排序、分页、批量选中、归档元数据 | 归档应用视图；稳定条目ID/分页和受控native runtime尚缺 |
| 最近文件、拖放、快捷键、主题/语言、可访问性 | Studio自己的项目作用域数据与交互，不读取ZiFile配置；需实际UI验收 |
| Explorer快速创建/浏览/解压 | Studio已有统一的文件、文件夹、目录背景、盘符传统菜单入口；文件内容需再次确认，尚无 ZiFile 实包、快速创建/解压命令或现代一级菜单验收 |
| 密码/等级/格式、覆盖/跳过/改名/报错策略 | 从格式目录驱动界面并进入预览，不隐式覆盖；接口尚缺 |
| CLI、独立桌面、Shell DLL、MSIX及更新器 | 保留ZiFile独立产品交付；Studio接入其算法能力，不嵌入另一桌面或接管安装身份 |

## 重新开放与验收门槛

Host原生运行时、资源/写入协议与提供方签名适配包完成后，按矩阵逐项：发现→按需加载→读取授权→执行→展示→接力/确认写入；再验证取消/超时、撤权、升级、损坏/加密包、冲突、路径攻击、恢复和支持OS。每格记录包版本、源/EXE摘要、输入向量、结果与截图；通过局部解析或签名校验不能改accepted为true。当前矩阵全部accepted=false，未来不支持的格式操作继续列明原因。

2026-10-11 运行时前置进展：源码Worker传输已增加Windows暂停启动→Job归属→恢复、取消/超时/输出超限/主进程成功结束后清理所属树，确认Job为空再关闭管道。真实Windows合成子/孙进程五种场景及能力子域24回归通过；另行运行的2项实际WASI专项也通过（当前测试程序提供外层传输，保留debug EXE作为WASI子运行时）；Unix仅进程组终止实现，未完成此轮OS运行验收，也不约束主动脱离进程组。不是文件/网络沙箱，native运行声明仍拒绝、ZiFile矩阵accepted仍全false；保留debug EXE未重新构建此源码改动。

2026-10-11 文件交接前置进展：[本地项目文件快照候选](local-file-resource-candidate.md)接入可信桌面Host接口，预览只核对元数据，明确确认后一次性读取并生成现有资源引用；绑定接收工具/实时身份，拒绝替换、项目切换和权限重授后的旧凭据。Windows真实HTTP→确认快照→实际WASI返回及对应Worker回收专项通过，资源子域51回归通过；测试Host为当前源码，子Worker复用保留debug EXE。没有UI接线，不支持目录、多文件、大于32MiB输入、读取中的取消或归档写入；不改变native拒绝及ZiFile接受0，也不代表提供方算法验收。

2026-10-13 多来源资源血缘前置进展：Store现可给派生资源绑定最多4个同一能力所属、各不相同的来源；发布前逐个复查，任一来源撤销或过期时连带清除派生资源，祖先授权检查遍历完整来源图。现有单输入调用和`derivedFrom`字段保持兼容，多来源描述增加`derivedFromAll`。这一提交仅完成内部资源存储基础；调用准入、Worker调用和前端多选当时仍只有单输入路径，因此**不能**据此宣称ZiFile多文件创建或任何矩阵单元已接入。

2026-10-13 后续Host接线：一次性 `prepare-call`/`invoke-call` 已加入可选 `additionalAccesses`，指纹绑定完整有序资源组，Host将每个来源的授权快照送入现有最多4资源的WASI帧，并在运行中及输出发布前复查每个来源。旧 `invoke-view` 仍维持单输入。界面多选、目录授权、ZiFile签名包及原生算法执行未完成，矩阵接受数仍为0。

2026-10-13 可信目录多文件接线：仅显式声明 `resourceInputMax` 2–4 且采用 `resource.wasi.input.draft2` 的 WASI 能力出现多文件确认界面；缺省能力保持单文件。目录网关传有序附加资源授权，前端核对多来源输出血缘，Host再次核对声明上限。见[多资源输入界面候选](resource-multi-input-ui-candidate.md)。这是有界普通文件计算入口，尚无ZiFile签名插件、原生归档Worker/目录授权/写入事务，108格接受数仍为0。提供方如需多文件WASI适配，请在新包中逐能力声明实际数量、输入类型与结果类型并提供正反例。

2026-10-13 交付边界复核：只读检查 ZiFile 0.1.15 工作树，矩阵所列四份源码 SHA-256 仍匹配；没有 Studio 插件清单或 `.zicode-plugin` 包，ZiFile 未被修改。提供方下一交付应先给出独立 `com.zicode.zifile.archive` 的版本化清单、四平台/架构入口或明确支持矩阵、每个能力的格式与资源类型、签名文件清单、许可证/SBOM、协议正反例。若提供 WASI 只读子集，须标明仅能处理有界普通文件和受支持格式；完整目录创建、解压和原包更新仍须原生受约束运行时及写入协议，不能由子集补齐接受格。Studio 在收到包前保持所有 108 格 `accepted=false`。

2026-10-13 Studio 后续前置：[单层目录元数据候选](local-directory-metadata-candidate.md)已有 Host 一次性确认、目录选择命令、受限快照和可信工具中心界面；它不读取文件字节、递归目录或写入目标。隔离测试之后，独立 Windows Studio debug EXE 已用自制 WASI 插件完成发现、授予权限、按需加载、原生目录选择、确认两个条目、真实 Worker 执行和结果展示；实机截图与日志在技术博客 `iterations/local-directory-native-2026-10-13/`。这不等于实际 ZiFile 插件或其他系统通过验收，因此不作为 `archive.create` 或任何矩阵格的完成证据。ZiFile 如使用该候选，请提供独立包中的 WASI 能力：清单同时声明 `resource.read` 与 `resource.directory.read`、`resource.wasi.input.draft2`，解析 `resource.local-directory.draft1` 的 UTF-8 JSON 单层 `{name,kind}`，给出空目录、4096项边界、撤权与错误正反例；只能将其用作小目录结构预览。完整归档仍需另立有界目录内容与写入协议。

2026-10-13 Studio 目录发现补充：工具中心新增与文件输入互斥的“仅显示项目目录工具”。Host 只把已启用、WASI draft2、同时声明且获授上述两项读取权限的能力列入目录结果；搜索、分类、收藏和最近仍可组合使用，目录详情按需加载。该入口不替代提供方适配包；它没有对 ZiFile 108 个格式操作单元做算法验收。

## 2026-10-11 文件输入发现提示
Studio新增[file.input.hints.v1 预览契约](file-input-hints.md)，按能力声明真实后缀或明确anyFile，协商1.0.0-preview.1；声明缺失保持未知可见。应交付新包/摘要/正反例，不修改冻结包；发现匹配不代替读取授权、内容验证或实际算法接受。新自有夹具真实目录3/4切换、确认执行及旧夹具兼容通过，提供方实包/完整工具仍待。

## 2026-10-14 提供方边界复核

只读复核本机 `E:\zifile`：HEAD 仍为 `327a993706f4423c23ad4f6b79646e29a178b5b1`，矩阵登记的 core、archive、worker-protocol、worker 四份源码 SHA-256 均匹配；工作树有 ZiFile 其他会话的未提交修改，Studio 没有更改它。仓库中仍未发现 Studio 插件清单或 `.zicode-plugin` 交付包。故 108 格全部维持 `accepted=false`，不能把本轮 Explorer 单实例交接或自制 WASI 夹具计入 ZiFile 算法接受。

新增一个必须由 ZiFile 明确解决的范围冲突：其 `AGENTS.md` 写明 RAR 创建不在范围内、RAR 读取需要许可证和安全审查；当前 README 和 core 源码却声明 RAR 5 创建及读操作。矩阵保留源码声明的 `providerDeclared=true`，对 RAR 的创建、列出、解压、校验另加 `PROVIDER_SCOPE_CONFLICT` 阻塞。提供方应统一产品规则、许可证/SBOM、安全审查与互操作向量，再交付版本化签名包；Studio 在冲突消除前不把这些操作展示为已接入。Studio 侧原生受约束 Worker、私有资源暂存、归档事件与原子写入事务仍需独立实现和逐平台验证。

2026-10-14 Studio 内部[归档进程传输候选](zifile-archive-transport.md)已组合现有进程树控制和完整事件流校验。它只接收 Host 自行构建的命令，没有开放 native 包安装、文件或网络隔离及归档资源/写入授权；提供方仍须交付独立签名包和适配向量，108 格接受数不变。

2026-10-14 补充 Host 内部一次性归档分页句柄：将已验证 `list` 输出的提供方 `nextCursor` 留在 Host，页面仅获得绑定插件包版本、资源内容版本、运行会话、查询与页大小的随机句柄。当前尚无真实 Host 路由或 ZiFile 提供方分页向量，不能证明稳定排序、撤权后的下一页请求或完整归档浏览；`HOST_ARCHIVE_EVENTS` 仍保持阻塞。
