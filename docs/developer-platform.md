# 开发者个人平台推进计划

2026-10-11：[工具结果保存后打开精确产物](plugins/saved-artifact-navigation.md)。
共用保存控制器增加明确导航，修复产物目录与详情读取竞态；Windows真实工具执行、
取消/确认保存、详情读取和桌面/窄屏展示已验证。跨平台及全工具验收继续推进。

2026-10-08 接入目标更新：[通过插件体系覆盖ZiDevTools全部工具](plugins/devtools-all-tools.md)。
当前154条目已形成版本化逐项矩阵与阻塞说明，首批五能力仅是阶段证据。
未接入项逐一记录原因、责任方和重开条件；整体接入目标尚未完成。

2026-10-07 新增：[ZiDevTools 独立插件交付规范](plugins/devtools-interoperability.md)。
两个产品独立构建，以插件包交付；先推进五项纯计算工具，系统工具等待版本化 Host 接口。
同时执行[磁盘预算规则](agents/disk-budget.md)，避免重复构建目录与无界临时产物。

更新时间：2026-10-02。状态：持续开发，整体目标尚未完成。

项目存储页现对比最近两次成功扫描的逻辑大小与文件数，完整扫描才计算变化；失败不替换基准，部分、链接、不可读与未观察到的目录保留未知状态。项目与子项目切换会重置比较；比较仅在页面内存中保留。十项新增回归及项目前端 147 项用例通过，桌面/窄屏明暗主题组件已检查。逻辑大小减少不证明物理空间回收，真实 WebView 和其他平台仍待验收。

项目提交历史现按固定 HEAD 分页，每页最多 50 条，可前后浏览、刷新回到当前 HEAD；游标贯通 React、只读网关和 Rust Host，旧 Host 保留最近历史显示。真实本机 Git 的 56 条临时历史及 HEAD 变化检查通过；桌面/手机尺寸组件翻页已检查。真实 WebView 与 macOS/Linux 运行仍待验收。原生检查通过；本轮格式化也规范了若干既有 Rust 文件的格式。

Git 审查草稿现绑定源场景、工作区与目录，交接期间源上下文变化会拒绝写入，保留调用方有效性检查与已有草稿；真实交接函数的七项回归及项目前端 128 项用例通过，见[上下文归属日志](iterations/2026-10-02-git-review-context.md)。真实 WebView、模型与跨系统运行仍待验收。

Windows 真实 Pi→打包插件→Rust Host→笔记搜索的完整调用通过，并修复 Host 停止遗漏 Pi 与运行时终止后未等待退出两处缺口；退出/管理/鉴权回归及原生静态检查通过，回收 4.7 GiB 构建产物，见[真实 Pi/Host 集成日志](iterations/2026-10-02-real-pi-host-plugin.md)。模型调度、WebView 和其他平台仍待验收。

真实 Rust Host HTTP 路由现有插件调用回归：合法笔记搜索、身份/会话校验、当前授权、停止与过期边界通过；原生全目标编译和 Clippy 通过，回收本轮 4.7 GiB 构建产物，见[Host 插件接口日志](iterations/2026-10-02-host-plugin-http.md)。Pi 使用内存替身，完整 Pi→Host 和其他系统仍待验收。

打包插件桥接现由真实 Pi 调用 execute，完成本机模拟服务的请求身份/参数/结果往返，并验证 403 与缺失结果失败；Inbox/金融场景均正常退出，见[插件 HTTP 日志](iterations/2026-10-02-plugin-http-roundtrip.md)。Rust Host 的实际鉴权与执行仍待集成验收。

本机真实 Pi 已加载 Inbox 与插件 Broker 资源，确认六项 Inbox 命令、插件工具元数据和正常退出，开发场景无金融命令；金融场景也通过相同插件注册检查，见[Inbox/插件注册日志](iterations/2026-10-02-inbox-plugin-runtime.md)。真实消息收发、插件调用与跨平台界面仍待独立验收。

内置扩展构建现拒绝缺失入口；本机三个 ESM 扩展构建成功，真实 Pi 加载 bridge 并注册配置/金融命令、正常退出。发布流程已接入该检查，见[内置桥接日志](iterations/2026-10-02-bundled-bridge-smoke.md)。插件 Broker、Inbox 运行与 Host/WebView 桥接仍待独立验收。

本机真实内嵌 Pi 0.84.2 的六项隔离 RPC 检查通过，确认版本、明确扩展/技能、响应与正常退出；四个平台发布流程已接入，见[Pi 通信日志](iterations/2026-10-02-isolated-pi-rpc.md)。Host/WebView 桥接、真实推理和其他平台运行仍待验收。

发布流程现检查内嵌 Pi/Bun 与构建主程序的可执行文件头部架构，本机 Pi/Bun 确认为 Windows x64；相关 17 条策略用例通过，见[二进制架构日志](iterations/2026-10-02-executable-architecture.md)。macOS/Linux 真实产物、安装及启动仍待验收。

发布上传与最终清单补齐 Windows/Linux 架构文件名约束，要求每个平台完整且无重复的安装类型，并修复缺失产物报错；相关 11 条规则用例通过，见[发布产物检查日志](iterations/2026-10-02-release-artifact-architecture.md)。二进制内部架构、安装与真实流水线仍待验收。

帮助页连续跳转与语言切换现校验请求归属，迟到正文、目录或错误不会覆盖当前页面；失败清空旧正文和页内目录，重载恢复。存储、组件与资源共 16 条用例通过，见[帮助读取顺序日志](iterations/2026-10-02-help-request-ordering.md)。实机视觉验收仍待补。

帮助页现只接管已注册的本地 Markdown 链接，修复外部 Termux 文档被拦截及同名外链误跳本地的问题；组件与资源 11 条用例通过，见[帮助导航修复日志](iterations/2026-10-02-help-link-navigation.md)。实际 WebView 外链打开仍待验收。

中英文快速开始现覆盖项目环境、命令、知识与后台自动化流程，补齐英文模板导航；两种语言各 25 个帮助页面的资源与内部链接检查及组件用例通过，见[入门指南更新日志](iterations/2026-10-02-developer-quick-start.md)。真实界面与三平台运行验收仍待完成。

跨平台统一入口现覆盖完整前端测试目录，并将 Tauri 权限规则作为必需步骤纳入报告；本机相关 717 条用例通过，云端四个运行器仍待实际执行，见[跨平台检查范围日志](iterations/2026-10-02-platform-gate-coverage.md)。

完整 JavaScript 入口本机已通过 199 个文件、1,443 条用例，权限/Windows 子进程/词典规则及原生静态检查通过；补齐了后台自动化与空间统计九项原生命令权限，修复跨平台检查脚本读取配置的兼容问题。编译产物已回收，真实三平台运行仍待验收，见[完整入口日志](iterations/2026-10-02-full-javascript-gate.md)。

项目与笔记完整前端目录的 269 条用例现通过：修复旧夹具与当前目录/启动/回收站/批量恢复协议的偏差，并修复项目概览三个面板的重复组件标识。实机和文件存储验收仍独立待补，见[项目与笔记回归日志](iterations/2026-10-02-project-notes-contracts.md)。

页面读取交错与运行记录导出新增 10 条回归证据；任务、自动化、导出、Inbox 与原生派发联合 127 条用例通过。真实 WebView 与三平台安装/worker 验收仍待补，见[读取与导出回归日志](iterations/2026-10-02-read-and-export-regressions.md)。

命令历史摘要导出补齐时间单位、快照来源和输出完整性元数据，导出前校验工作区及记录结构；历史摘要未知的截断信息明确为 null，详见[运行记录导出日志](iterations/2026-10-02-run-history-evidence-export.md)。实际下载与跨系统消费待验收。

任务与自动化页面销毁时现使旧读取失效，取消运行时就绪重试；恢复读取后清除待执行重试，重新打开与旧刷新交叠时衔接新读取。类型、静态检查和分发构建通过，运行交错场景待验收，见[页面读取生命周期日志](iterations/2026-10-02-page-read-lifecycle.md)。

跨平台检查与发布流程的 Rust 缓存现映射到 Cargo 实际使用的根级 `target/`，减少目录配置错位造成的重复构建；云端命中与耗时效果待运行确认，见[构建缓存日志](iterations/2026-10-02-platform-build-cache.md)。

ZiCode Studio Desktop 定位为全方位、跨平台的开发者个人平台应用。以个人项目为中心，
贯通代码开发、AI 协作、知识积累、任务自动化和成果交付，采用本地优先的数据所有权。
Windows、macOS、Linux 是桌面交付目标；移动端承担伴随访问，独立记录验收。

全工作区自动化现由桌面 Host 负责到期入队、免审批任务派发、运行结果与预算回写、失败重试及丢失子进程识别；独立 worker 提供关闭桌面窗口后的代码路径，并可由用户选择登录后启动。实际持续执行、通知、并发与三平台实机验收仍待完成。见[全工作区自动化工作日志](iterations/2026-09-30-global-automation-scheduler-design.md)与[登录启动日志](iterations/2026-10-01-automation-login-start.md)。
五个自动化后台循环现收束为一个 Host 生命周期任务；见[后台生命周期日志](iterations/2026-10-01-automation-lifecycle-owner.md)。
自动化文件扫描与回写的阻塞闭包现计入 Host 退出屏障，为安全交接跨进程执行权补齐等待边界；Pi 子进程与三平台退出时序仍待验收，见[阻塞任务退出日志](iterations/2026-10-01-automation-blocking-drain.md)。
自动化循环现由用户级 OS 文件锁选出单一执行者，其他进程等待接管；见[单执行者日志](iterations/2026-10-01-automation-single-executor.md)。
持锁执行者现从共享 SQLite 注册表首次同步项目后启动自动化循环，并每十五秒刷新一次，使其他桌面进程新增或移除的项目进入扫描范围；见[项目同步日志](iterations/2026-10-01-automation-workspace-sync.md)。真实双进程及三平台行为仍待验收。
程序现提供显式无窗口自动化入口，启动受限本机插件 Broker 并复用执行锁；可从桌面主动启动，也可选择下次系统登录后启动。默认不注册登录项，三平台真实运行仍待完成，见[无窗口入口日志](iterations/2026-10-01-automation-windowless-worker.md)与[登录启动日志](iterations/2026-10-01-automation-login-start.md)。
登录项读写现核对执行命令归属：同名非本应用条目不会在启用时被覆盖，也不会在关闭开关时被删除；见[登录项归属日志](iterations/2026-10-01-automation-login-entry-ownership.md)。
无窗口进程现有单实例 OS 锁、显式停止命令和有界本机日志，避免 Windows 无控制台时只能强制结束；见[进程控制日志](iterations/2026-10-01-automation-worker-control.md)。三平台真实停止验收仍待完成。
Linux AppImage 中手动启动或更新后恢复 worker 时，若当前程序运行于 AppImage 挂载目录，启动器现调用稳定的原始 AppImage 文件并让子进程自行解析资源，避免把父进程临时挂载路径传给长期运行的 worker；见[AppImage worker 日志](iterations/2026-10-01-appimage-worker-launch.md)。真实 AppImage 进程生命周期仍待验收。
自动化中心现提供原生桌面进程状态、主动启动与停止，以及登录后启动开关；状态只报告 worker 是否存在，登录开关从下次登录生效，见[桌面控制日志](iterations/2026-10-01-automation-desktop-control.md)与[登录启动日志](iterations/2026-10-01-automation-login-start.md)。三平台窗口关闭后运行与登录启动仍待实机验收。

## 能力与验收路线

| 能力 | 当前代码基础 | 后续验收要求 |
| --- | --- | --- |
| 项目与开发 | 项目目录、上下文、文件浏览、Git 状态/差异、环境诊断、JS/Rust/Go/Python/Ruby/PHP 版本要求匹配、Ruby Bundler、PHP Composer 与 CMake/Java/.NET/Deno 固定命令、工具目录配置、脚本运行器、交互终端、会话 | 跨平台实机验收、终端完善；项目内 `.venv`/`.conda` 自动选择、用户级 Conda 两处来源和用户主动查询的 Poetry 列表已接入，其他安装位置、自动工具链管理仍待补；按项目隔离且切换无串数据 |
| AI 协作 | Pi RPC、多会话、模型渠道、预算 | 项目上下文连续性、失败恢复、工具权限和成本可追踪 |
| 知识与创作 | Notes、引用、Artifacts、发布接口 | 代码到决策到文档可追溯；导入、导出和恢复有真实数据验证 |
| 个人效率 | 任务中心、Automation、内置工具 | 项目关联、后台生命周期、审批、取消、失败重试与历史闭环 |
| 平台与生态 | Rust Host、插件注册、凭据 Broker | 独立于特定公司运行环境；第三方插件权限、更新回滚和数据迁移 |
| 跨平台交付 | Tauri、多平台 release workflow | 各系统实际启动、路径、Git/Shell、凭据、安装升级与卸载证据 |

跨系统自动检查入口与 PR 矩阵见[跨平台验证说明](platform-verification.md)。
普通 Vitest 默认 forks 入口现兼容 Node 25+ 的原生 Web Storage，本机 Node 26 下 51 个任务存储、派发与面板用例通过，见[本地入口日志](iterations/2026-10-02-local-vitest-storage.md)。完整测试集与其他平台仍需另行验证。
项目到任务与工作流的 71 个定向用例现按版本校验和固定目标协议通过；完整自动化测试夹具、页面与 Host 双调度职责仍待核对，见[关联协议日志](iterations/2026-10-02-project-work-contract-tests.md)。
工作流页面现只轮询读取状态，自动到期入队、重试与终态回写交给 Host；保留用户手动运行，自动化目录 23 个用例通过，见[页面观察者日志](iterations/2026-10-02-automation-page-observer.md)。任务中心和 Agent Inbox 定时器仍需另行核对。
Agent Inbox 自动轮询现只观察任务，免审批自动派发交给持执行锁的 Host；35 个定向用例通过，见[Inbox 派发日志](iterations/2026-10-02-inbox-host-dispatch.md)。任务中心 interval/daily 模板仍由页面生成实例，需先补 Host 模板入队能力再收束页面调度。
Host 现已接入 interval/daily 任务模板扫描，稳定实例与下一次时间在一次版本校验写入中提交；任务中心页面改为只读刷新。三条 Rust 用例与117 条前端定向用例通过，见[模板调度日志](iterations/2026-10-02-host-task-templates.md)。Windows/macOS/Linux 真实 worker 到期执行、休眠恢复和多进程验收仍待完成。
三个外部数据客户端现有独立严格 TypeScript 门槛，并进入 PR 与跨系统检查流程；41 个 Pi 扩展源码文件也纳入严格类型门槛，见[客户端类型门槛日志](iterations/2026-10-01-external-client-typecheck.md)和[扩展源码类型日志](iterations/2026-10-01-extension-source-typecheck.md)。根配置仍包含测试类型等错误，不能据此称全部扩展类型检查通过。
通用兼容模型渠道的目录读取现要求流式响应，避免无流响应先经 `text()` 无界分配内存；仍保留 2 MB 逐块上限，见[目录流式边界日志](iterations/2026-10-01-openai-catalog-stream-bound.md)。真实服务和其他渠道需另行验收。
通用渠道的模型连接测试现对 Pi 短提示设置 30 秒截止时间并请求中止，超时原因可在设置页显示；提供方实际停止、费用和三平台行为仍待验收，见[健康检查超时日志](iterations/2026-10-01-model-health-timeout.md)。
模型健康检查现于结果写入前复核渠道修订号与启用状态，迟到结果显示为需刷新且不覆盖旧健康状态；渠道配置与健康偏好的跨文件并发仍待处理，见[健康结果作用域日志](iterations/2026-10-01-model-health-channel-scope.md)。
应用内更换或移除模型密钥现轮换非敏感凭据版本并清除旧健康状态；在偏好文件锁内拒绝旧密钥检查结果写入，见[凭据作用域日志](iterations/2026-10-01-model-health-credential-scope.md)。外部直接修改凭据与跨文件原子性仍待处理。
金融确定性核心的回测、市场快照、行情归一化、模拟交易和筛选模块现有独立严格 TypeScript 门槛；缺失报价的持仓明确返回 `stale: null`，避免把未报价误当作新鲜或过期，见[金融核心类型门槛日志](iterations/2026-10-01-finance-core-typecheck.md)。
可选聊天收件箱扩展已把旧 Pi 包名改为当前内嵌 Pi 文档使用的包名，并修复内部类型入口路径；见[聊天扩展兼容日志](iterations/2026-10-01-chat-inbox-pi-imports.md)。内嵌 Pi 包未提供根配置所指向的声明文件，完整扩展类型检查仍未通过。
聊天收件箱的配置、日志、运行时、消息渲染和飞书/企微连接等 18 个不依赖 Pi UI SDK 的模块现有独立严格 TypeScript 门槛，并进入 PR 与三平台检查；见[聊天核心类型门槛日志](iterations/2026-10-01-chat-inbox-core-typecheck.md)。
自动化规则与草稿、任务存储、会话检索、模型渠道与健康响应、成本汇总等七个 Pi 独立平台模块也纳入严格 TypeScript 检查；成本空数据结构现显式声明数组行类型，见[平台核心类型门槛日志](iterations/2026-10-01-platform-core-typecheck.md)。
平台验证报告现记录 GitHub Actions 运行身份，并要求触发 SHA 与检出 HEAD 一致、工作区干净，否则 CI 证据整体失败；本地改动尚未获得远端三平台运行证据，见[证据归属日志](iterations/2026-10-01-platform-evidence-attribution.md)。
CI 来源现还要求仓库身份与固定发布目标一致；不符时在耗时检查前失败，见[仓库身份门槛日志](iterations/2026-10-01-platform-repository-gate.md)。
三平台验证现将矩阵声明的系统/架构与 Node 运行时实值核对，错误 runner 不能产出通过报告，见[runner 目标门槛日志](iterations/2026-10-01-platform-runner-target.md)。真实 Actions 运行待验收。
平台验证还核对 `rustc -vV` 的主机目标及显式 Cargo 构建目标，避免跨目标编译结果误标为本机验证；四个系统/架构矩阵行的真实运行仍待验收，见[Intel Mac 交付日志](iterations/2026-10-01-macos-intel-delivery.md)。
项目页现加入桌面端只读存储占用视图，按注册工作区及当前选中子项目扫描常见生成目录并标明不完整结果；Host 限制并发扫描，前端对超时与目录失效给出提示。视图另显示所选目录所在卷的可用空间，读取失败单独标明；目录数字仍为逻辑大小，不代表可回收空间，见[项目存储日志](iterations/2026-10-01-project-storage-insight.md)。三平台真实目录与界面仍待验收。
开发环境页现可主动下载路径精简的 JSON 诊断快照，便于跨设备比较平台、工具版本和静态要求；明文声明仍需分享前检查，见[环境报告导出日志](iterations/2026-10-01-environment-report-export.md)。
开发环境页现可导入该快照并比较工具状态、版本、来源与静态清单声明；项目身份和清单文件名未保留，目录范围与快照时间需用户确认，见[环境快照比较日志](iterations/2026-10-01-environment-snapshot-compare.md)。
存储视图现按工作区与子目录重新建立临时状态，切换项目时不会继续展示旧项目的扫描数据或打开错误，见[存储视图隔离日志](iterations/2026-10-01-project-storage-scope.md)。
存储扫描现标出链接数大于 1 的文件路径数与逻辑大小，提醒用户目录大小可能高于实际可释放空间；旧 Host 响应仍可显示，见[硬链接提示日志](iterations/2026-10-01-project-storage-hardlinks.md)。三平台真实文件系统行为仍待验收。
候选目录现补充 Python 检查缓存、覆盖率报告、SvelteKit/Nuxt 产物和 .NET `obj`，继续只读显示；见[存储候选目录日志](iterations/2026-10-01-project-storage-candidates.md)。
开发环境页现依据已识别的清单和版本声明优先展示当前项目相关工具，其余探测结果保留在可展开区域；没有可识别关联时仍显示完整工具列表，见[环境工具分组日志](iterations/2026-10-01-environment-tool-groups.md)。
Ruby、PHP、Java 和 Python 的主要工具分组现进一步按具体清单区分，避免只有版本文件时误突出 Bundler/Composer，或 Java 项目同时突出未使用的构建工具；实际任务能力和探测结果不受影响。
存储结果现按已观察到的逻辑大小排序，并可用工作区受限的目录专用 Host 操作打开生成目录供人工核对；点击时重新校验目标为普通目录，链接和非目录候选不提供该动作。页面还按 Rust 构建、JS 依赖、Python 环境、缓存及通用产物给出清理前核对提示，不根据目录名直接判定可释放空间，也不删除文件，见同一[项目存储日志](iterations/2026-10-01-project-storage-insight.md)。
日常 Rust 修改现可运行 `bun run check:rust:static`，执行 check、Clippy 和格式检查；`bun run check:rust` 及 Release 工作流仍包含测试，见[Rust 静态检查日志](iterations/2026-09-30-rust-static-check-mode.md)。
项目文件侧栏现对目录枚举错误、无法表示的文件名和超大目录明确报错，不把不完整列表显示成空目录；Unix 相对路径保留文件名中的反斜杠。见[文件浏览边界日志](iterations/2026-09-29-file-browser-completeness.md)。真实三平台界面验收仍待推进。
项目文件侧栏现按每页 200 项继续加载，后续页会核对目录清单摘要，变化时要求刷新；旧客户端仍使用原列表响应。见[文件分页日志](iterations/2026-09-29-file-browser-pagination.md)。超过 100000 个扫描条目的目录与三平台真实界面仍待处理。
文件页现在拒绝缺失条目数组或偏移不连续的响应，避免把协议异常显示成空目录或重复追加错误页面；见[文件页响应日志](iterations/2026-09-29-file-page-response-integrity.md)。
文件侧栏的默认应用打开动作现由 Host 按工作区 ID 和相对路径解析，支持文件与子目录，同时拒绝链接逃逸；见[工作区条目打开日志](iterations/2026-09-29-workspace-entry-open.md)。
当前远程矩阵尚未运行；它是验证流程基础，不是 macOS/Linux 已通过的证据。
2026-10-01 按 ZiCode 仓库显式查询，远端默认分支仍没有开发者平台矩阵工作流，最近可见 Release 运行失败且没有 Job 清单；本地 `gh` 已修正默认仓库，工作流与交付证据仍需推进，见[仓库上下文记录](iterations/2026-10-01-github-repo-context.md)。
Release 草稿与 Pi 更新 PR 的工作流命令现显式指定 GitHub 目标仓库，Pi 更新流程也复用仓库身份门槛；远端真实执行待验收，见[工作流目标仓库日志](iterations/2026-10-01-workflow-repository-target.md)。
Pi 更新流程现约束进入后续 Shell 的上游版本格式，并以同一 Job 的临时文件拼接 Release notes，避免固定 Actions 输出分隔符承载上游文本；远端旧工作流仍因缺失标签失败，本地修改尚未发布，见[上游输入边界日志](iterations/2026-10-01-pi-update-release-input.md)。
Windows 打包资源的下载路径已加入十分钟超时、大小上限和临时文件原子提交，保留锁定 SHA-256 校验；见[下载可靠性日志](iterations/2026-09-28-locked-asset-downloads.md)。此代码改动不代表安装包已经实机验收。
Pi 下载缓存现于当前目标版本确认可用后清理同一架构且已满 7 天的旧版完整压缩包及 `.part` 残留，保留当前版本完整包和其他架构；本机锁定包校验后重新安装运行时，已清理约 142.8 MiB 缓存，见[Pi 缓存日志](iterations/2026-09-30-pi-cache-retention.md)。
WebView2 安装器现以流式哈希校验，缓存与资源位于同卷且允许硬链接时复用文件数据；不支持硬链接时仍复制并校验。已安装资源可用 `--dedupe-only` 在双重摘要验证后与缓存去重，本机两份 203778256 字节安装器已验证为同一文件；见[WebView2 空间日志](iterations/2026-09-29-webview-resource-space.md)。
内嵌 Bun 下载现复用同一受限下载器，避免把整个响应一次性读入内存；缓存与目标文件仍按锁定 SHA-256 核对，见[Bun 下载日志](iterations/2026-09-28-bun-download-bounds.md)。
内嵌 Bun 更新现先暂存完整可执行文件与版本标记，再切换资源目录；提交失败尝试恢复旧目录，见[Bun 暂存日志](iterations/2026-09-29-bun-runtime-staging.md)。真实更新和三平台构建仍待验收。
Windows PortableGit 也改为解压到暂存目录并验证 Git/Bash 后切换，复用同一目录回退逻辑，见[PortableGit 暂存日志](iterations/2026-09-29-portable-git-staging.md)。真实自解压及打包仍待验收。
Pi、Bun 和 PortableGit 若在目录切换窗口中断，下一次构建会在目标缺失且只存在一份旧备份时先恢复旧目录；遗留暂存和多份候选只报告或停止，见[中断恢复日志](iterations/2026-09-29-runtime-interrupted-recovery.md)。真实中断恢复待验收。
非 Windows 构建现在会清空上一次 Windows 构建留下的 Portable Git 与 WebView2 资源，避免静态资源映射把安装包带入 macOS/Linux 产物；见[资源隔离日志](iterations/2026-09-28-platform-resource-isolation.md)。
Release workflow 已修复签名条件引用并使更新产物上传错误阻止发布；更新产物目前关闭，跨平台清单合并仍待设计与验收，见[发布工作流日志](iterations/2026-09-28-release-signing-gate.md)。
Release 三平台构建现从准备阶段记录的同一提交 SHA 检出；公开草稿前重新读取 tag 并核对其仍指向该提交，见[发布源码固定日志](iterations/2026-10-01-release-source-pinning.md)。工作流仍待远端运行验收。
Release 三平台打包前现分别执行前端与平台模块 TypeScript 检查、静态与设计规则；内嵌运行时各自下载为独立步骤，Windows 版本探测逐一核对退出码，见[发布静态门槛日志](iterations/2026-10-01-release-static-gates.md)。远端结果仍待验收。
发布矩阵现于下载运行时前核对 runner 与 Rust 工具链架构是否匹配内置 Pi/Bun 目标，见[目标架构日志](iterations/2026-09-28-release-target-architecture.md)。此门槛仍待远程 runner 验证。
该门槛也会拒绝与内置运行时目标不符的显式 `CARGO_BUILD_TARGET`，避免 runner 架构正确但实际 Tauri 产物交叉构建到另一目标；见[Cargo 目标日志](iterations/2026-09-29-release-cargo-target.md)。
模型目录请求函数已移除公司网关默认地址，要求调用方传入当前场景显式配置的渠道 URL；设置页目录刷新仍由用户主动触发，见[模型目录地址日志](iterations/2026-09-29-explicit-model-catalog-url.md)。[产品需求基线](requirements.md)现以三平台和用户自选渠道为准，见[需求对齐日志](iterations/2026-09-29-product-requirements-alignment.md)。Rust 本地代理及金融服务适配仍有专用地址，不能据此认定所有在线入口已独立化。
QVeris 模型目录响应现按实际读取字节限制为 2 MB，并拒绝带查询参数或片段的网关基础地址，见[模型目录响应边界日志](iterations/2026-10-01-model-catalog-response-bound.md)。

模型渠道的保存与连接校验现统一拒绝带查询参数或片段的 `baseUrl`，避免配置保存成功后目录发现才失败；通用兼容渠道仍使用用户地址，见[渠道地址一致性日志](iterations/2026-09-30-model-channel-base-url.md)。
通用 OpenAI 兼容模型渠道现有显式目录发现与编辑预览，保存前不改模型配置；锁定 Pi 运行时提供按渠道读取凭据的接口，见[接口调研](iterations/2026-09-29-generic-model-catalog-research.md)与[发现实现日志](iterations/2026-09-29-generic-model-discovery.md)。真实服务和跨平台验收待补。
设置页现可从已有渠道复制标准配置与模型元数据到新 ID；源配置变更和目标 ID 冲突均拒绝保存，凭据需重新输入，见[渠道复制日志](iterations/2026-09-29-model-channel-copy.md)。渠道禁用和跨平台实机验收仍待完成。
设置页现可按渠道手动测试连接：已有模型执行一次模型健康请求，空模型的 OpenAI 兼容及 QVeris 渠道只读取目录；结果不含上游错误正文，见[连接检查日志](iterations/2026-09-29-model-channel-connection.md)。渠道禁用已覆盖内置 Pi 桥接与 Rust 模型工具，第三方扩展及真实取消时序仍待验收。
模型渠道现支持独立于稳定 ID 的可选显示名称，渠道行和模型列表读取同一场景配置；名称编辑与复制不改变模型 ID 或凭据引用，见[渠道名称日志](iterations/2026-09-29-model-channel-display-name.md)。
普通渠道编辑现携带列表版本到保存接口，旧版本或缺少版本时不再直接覆盖配置；见[渠道编辑版本日志](iterations/2026-09-29-model-channel-edit-revision.md)。
模型配置的渠道保存、删除、目录同步与高级 JSON 写入现共用文件锁和临时文件提交；高级 JSON 也要求读取版本，删除操作先核对渠道版本再清理凭据。异常终止后的锁恢复和跨存储事务仍待处理，见[模型配置写入日志](iterations/2026-09-30-model-config-writes.md)。
聊天额度不足提示现使用服务商中立的标题与建议，并识别常见兼容渠道额度错误；见[通用额度提示日志](iterations/2026-09-29-neutral-model-quota.md)。真实服务商响应仍待验收。
Rust 模型工具现排除 `enabled: false` 的渠道，翻译、摘要及插件能力无法再通过该层调用显式禁用的渠道；设置页现提供带版本校验的启用与禁用操作，Pi 聊天取消的真实时序仍待验证，见[禁用边界日志](iterations/2026-09-29-model-channel-disable-boundary.md)与[渠道开关日志](iterations/2026-09-30-model-channel-toggle.md)。
模型目录现在也排除禁用渠道，Pi 桥接扩展在新输入进入 Agent 前拦截当前已禁用渠道；排队、进行中及扩展直接模型调用仍待封闭，见[新输入边界日志](iterations/2026-09-30-disabled-model-input-boundary.md)。
成功保存禁用配置后，Pi 桥接扩展现会对当前所选渠道的活跃运行发出取消；排队消息和扩展直接模型调用仍未统一封闭，见[当前请求日志](iterations/2026-09-30-disabled-model-active-request.md)。
Pi 桥接扩展又在排队消息进入 Agent、每轮响应开始与提供商请求前复核禁用状态并请求取消；真实取消时序及扩展直接调用仍未验证，见[排队输入边界日志](iterations/2026-09-30-disabled-model-queued-boundary.md)。
设置中的模型健康检查、连接测试和目录发现现直接拒绝显式禁用渠道，见[设置直连请求日志](iterations/2026-09-30-disabled-model-direct-requests.md)；已发出的请求和第三方扩展仍未被统一控制。
渠道列表现显示高级 JSON 中的禁用状态，并停用会被拒绝的连接测试与目录发现操作；见[禁用状态可见性日志](iterations/2026-09-30-disabled-model-visibility.md)。
通用渠道表单现支持按模型 ID 编辑名称、上下文窗口、最大输出与每百万 Token 价格；保存时校验数值并保留既有的其他模型元数据，见[模型详情日志](iterations/2026-09-29-model-channel-metadata.md)。渠道开关已接入普通设置页；第三方扩展及实机验收仍待完成。
模型渠道保存现明确移除免鉴权配置中的密钥引用；设置页切换场景会清除旧视图和编辑内容，并阻止旧异步结果回写新场景。凭据与配置的双步骤操作现固定原始目标，部分完成时提示核对，见[场景隔离日志](iterations/2026-09-29-model-channel-scene-isolation.md)。跨进程事务仍待设计。
Pi、Bun 和 Windows PortableGit 的本地资源复用标记现包含目标架构与锁文件校验值，避免同版本跨目标构建复用旧二进制；见[运行时标记日志](iterations/2026-09-28-runtime-target-markers.md)。
内嵌 Pi 的解包和权限处理现于暂存目录完成，再与 Bun、PortableGit 一样切换资源目录；Windows PowerShell 解包后备路径不再拼接项目路径，见[Pi 暂存日志](iterations/2026-09-29-pi-runtime-staging.md)。真实三平台构建仍待验收。
Pi 归档的 Fetch 后备路径现复用受限流式下载器，curl/成功的 BITS 下载也检查大小，SHA-256 改为增量读取；见[Pi 下载上限日志](iterations/2026-09-29-pi-download-bounds.md)。网络路径尚未实测。
Pi 构建现仅接受六种锁定目标，并要求目标归档有有效 SHA-256；缺失摘要时不再安装未校验运行时，见[Pi 锁定日志](iterations/2026-09-29-pi-lock-required.md)。
Pi 资源复用和新解包提交现检查主程序、包清单、RPC 文档、主题、资产与依赖目录的基本结构，避免目录不完整时仍打入安装包；见[Pi 资源树日志](iterations/2026-09-29-pi-resource-tree.md)。三平台运行仍待验收。
WebView2 离线安装器更新现先暂存、校验再提交，并清理旧文件名留下的资源副本，避免安装包携带多余文件；见[WebView2 资源日志](iterations/2026-09-28-webview-resource-pruning.md)。
Release 矩阵现于公开草稿前逐平台核对本地安装包与已上传资产的格式、大小及 SHA-256；API 缺少 digest 时会下载资产核对，见[发布资产门槛日志](iterations/2026-09-28-release-asset-gate.md)。真实 CI 上传仍待验收。
公开发布前现要求草稿资产清单恰好是 Windows EXE、macOS ARM64 与 x64 DMG、Linux AppImage 和 Debian 包，防止复用旧草稿时夹带过时文件；见[发布清单门槛日志](iterations/2026-09-29-release-inventory-gate.md)与[Intel Mac 交付日志](iterations/2026-10-01-macos-intel-delivery.md)。远端执行仍待验收。
自动更新产物仍关闭；设置页手动更新按钮现直达 GitHub Releases 列表，见[手动更新入口日志](iterations/2026-09-29-manual-update-entry.md)。公开 tag 与资产元数据已可查询，安装包独立校验及三平台实际升级仍待验收。
更新安装入口现先请求无窗口自动化 worker 退出，再取得跨进程独占安装锁；超时则取消安装，安装和应用重启期间阻止其他实例重新运行 worker。Beta Rust 入口和常规 Tauri updater 入口均接入，见[更新交接日志](iterations/2026-10-01-automation-update-handoff.md)。三平台实际升级与启动竞争仍待验收。
更新安装失败时现释放独占锁，并尝试恢复更新前已运行的 worker；无窗口 Host 不再参与一次性会话迁移，见[更新失败恢复日志](iterations/2026-10-01-automation-update-recovery.md)。三平台真实运行仍待验收。
成功更新或更新中断时，若更新前 worker 正在运行，本地一次性标记使新版桌面在初始化后尝试恢复；显式停止会清除标记，不默认开机常驻，见[更新后恢复日志](iterations/2026-10-01-automation-update-resume.md)。三平台真实安装与进程交接仍待验收。
旧版 `v0.1.0` 的四种公开资产、远端 tag 提交及当前 HEAD 工作流失败状态已有只读记录，见[远端 Release 证据](iterations/2026-09-29-remote-release-evidence.md)。资产元数据不证明当前工作树或实机安装通过。
本地发版脚本和 Release workflow 现使用同一预期仓库配置核对 `origin` / `GITHUB_REPOSITORY`，避免把 tag 或草稿 Release 发到 upstream；见[仓库身份日志](iterations/2026-09-28-release-repository-guard.md)。
本地发版入口现将未跟踪项目文件也纳入干净工作树门槛，避免 tag 漏带新模块，见[未跟踪文件门槛日志](iterations/2026-09-29-release-untracked-guard.md)。真实发版链路仍待验收。
macOS 检查和发布覆盖 `macos-15` ARM64 与 `macos-15-intel` x64；两种架构使用各自锁定的 Pi/Bun 资源与原生 Rust 目标，见[runner 迁移日志](iterations/2026-09-28-macos-runner.md)与[Intel Mac 交付日志](iterations/2026-10-01-macos-intel-delivery.md)。实际 CI 与安装结果仍待记录。
本地开发与正式构建入口现共用跨系统 Cargo 路径配置；Tauri 开发前置步骤编译 React 页面，避免源码与已生成页面不同步。各系统真实启动和构建仍待验收，见[开发入口日志](iterations/2026-09-28-cross-platform-dev-entry.md)。
手动 macOS DMG 脚本现复用项目构建入口，避免依赖全局 Tauri CLI，并只报告本次构建产生的 DMG，见[macOS DMG 入口日志](iterations/2026-09-29-macos-dmg-entry.md)。仍待 macOS 实机验收。
Release 产物核验现按 Cargo 目标目录与显式构建目标查找仓库根或 `src-tauri` 下的 bundle，并要求每种平台产物恰好一份，见[Release 产物目录日志](iterations/2026-10-01-release-bundle-paths.md)。远端构建仍待验收。
设置页备份列表现按工作区隔离异步读取与操作反馈，切换项目时清空旧列表并按可见状态重新读取；删除、恢复确认后会复核目标，见[备份隔离日志](iterations/2026-09-29-backup-workspace-isolation.md)。真实桌面与跨平台恢复仍待验收。
工作区恢复现暂缓回退快照的保留期裁剪，避免恢复最旧备份时提前删除来源；完成后保留来源和回退快照，见[恢复保留顺序日志](iterations/2026-09-29-backup-restore-retention.md)。整组原子恢复与跨平台实机验收仍待推进。
工作区快照现先复制到隐藏临时目录，完成后再发布；复制错误会失败，列表排除未完成及归属不符的目录，见[快照完整性日志](iterations/2026-09-29-backup-snapshot-integrity.md)。并发写入和跨平台实机备份仍待验收。
工作区恢复现先完整暂存来源再交换应用目录，交换失败会尝试逆序回滚；崩溃中的跨应用原子性仍未实现，见[恢复暂存日志](iterations/2026-09-29-backup-restore-staging.md)。
恢复入口现与创建备份一致，先拒绝不存在或符号链接形式的 `.zicode` 数据目录，再创建暂存内容，避免沿链接写到工作区外；见[恢复目录边界日志](iterations/2026-09-29-backup-restore-root-boundary.md)。
备份列表现要求元数据 ID 与目录名一致；恢复前核对声明的应用目录，并在暂存复制后对比实际字节数与快照记录，异常时停止替换当前数据。见[快照元数据一致性日志](iterations/2026-09-29-backup-metadata-consistency.md)。
新工作区快照现记录文件树 SHA-256，恢复时在替换当前数据前复核暂存副本；旧快照保持兼容并在列表中标出没有内容摘要。见[快照内容摘要日志](iterations/2026-09-29-backup-content-digest.md)。真实恢复与跨平台迁移仍待验收。
快照格式现区分旧版与带摘要的新版；新版缺少摘要或格式版本未知时拒绝恢复，设置页仍允许删除该快照。见[快照格式边界日志](iterations/2026-09-29-backup-format-boundary.md)。
备份目录的元数据缺失、损坏、格式不支持或摘要无效时，列表显示该条目并禁用恢复；自动备份的“最近一次”判断与保留期裁剪排除这些条目，见[损坏快照可见性日志](iterations/2026-09-29-damaged-backup-visibility.md)。
备份时间无法解析、应用目录清单无效或实际子目录不匹配时，列表同样保留可见的损坏条目，恢复入口独立拒绝；见同一日志。
设置页也会核对备份列表、创建和恢复命令的返回结构，异常响应不再显示为空列表或成功操作；见同一日志。
该脚本已兼容与宿主架构一致的 `CARGO_BUILD_TARGET` 产物目录，并核对可选的 Pi 目标设置，防止误报缺失 DMG 或打入错误架构的运行时；见同一日志。
正式构建的资源与前端准备统一由 Tauri `beforeBuildCommand` 执行；已移除 `package.json` 中重复的 `prebuild`，避免同次构建两次运行准备流程。调用链仅做静态核对，见同一[macOS DMG 入口日志](iterations/2026-09-29-macos-dmg-entry.md)。
读取远端 Actions 后确认，Pi 自动更新在同一提交上连续失败于创建 PR：仓库不存在 `dependencies` 标签。工作流现不再要求该标签，并更新 checkout action；修复仍待提交后的远端运行验证，见[Pi 更新工作流日志](iterations/2026-09-28-pi-update-pr.md)。

旧 M0–M6 文档保留历史验收记录，不能据此认定新的平台目标已完成。存在代码或 CI 配置
只证明具备实现基础；未做本轮实际验证的平台、流程必须保留为待验收。

## 本轮：项目 Git 状态

目标：在项目总览读取真实 Git 分支和改动，提供开发者开始工作前的状态检查。

- Host 只接受已注册 workspace ID，不接受前端传入任意目录或 Git 命令。
- 使用 porcelain v2 的 NUL 分隔输出，正确处理空格、换行、重命名与冲突。
- 读取设置超时、输出大小和展示数量上限；不调用远程网络，不刷新索引写入。
- 项目切换、刷新并发时丢弃过期结果；失败不伪装为干净工作树。
- Windows 使用应用启动时配置的内置 Git；macOS/Linux 沿用系统 Git，缺失时提示不可用。
- UI 提供中英文、键盘可操作刷新以及窄屏可换行路径。

进展与验证记录见 [本轮工作日志](iterations/2026-09-26-developer-platform.md)。

项目 Git 差异已接续实现：可查看工作树对暂存区、暂存区对 HEAD 的文本差异。
项目 Git 工作区现支持对状态列表中的单个合格文件显式确认暂存。Host 在执行前重新读取状态、限制到已注册工作区，并在执行后返回新状态；远程 Host 请求禁止此操作。未跟踪目录聚合条目和无法无损表示的路径不提供暂存按钮。暂存可能运行仓库配置的 clean filter；超时或返回状态不明时需刷新确认。
同一工作区现可对已暂存文件显式确认取消暂存，保留工作树内容；未提交过的仓库走仅移除索引条目的路径。部分暂存的文件取消暂存时会移除该文件全部索引改动。两种索引操作后均关闭旧差异预览。
输出与显示均有上限，外部 diff/textconv 禁用，未跟踪内容与子模块内部改动明确排除。
验收记录见 [Git 差异工作日志](iterations/2026-09-26-project-git-diff.md)。

项目总览已接入按需读取最近 50 次提交、固定 HEAD 快照、作者时间与有界提交说明，见[Git 历史日志](iterations/2026-09-26-project-git-history.md)。真实仓库与跨平台验收待补。

历史条目已接入提交差异，明确根提交、合并第一父提交和浅克隆缺失对象的行为，见[提交差异日志](iterations/2026-09-26-commit-diff.md)。

已显示提交差异可显式加入同项目会话的聊天草稿，保留旧文字并携带比较范围及截断信息；用户确认后发送，见[审查交接日志](iterations/2026-09-27-git-review-handoff.md)。

已暂存/未暂存差异也已接入同一审查交接流程，携带前端接收时间并区分可变工作树与提交对象，见[提交前审查日志](iterations/2026-09-27-worktree-review.md)。

项目知识的上下文包与比较动作已使用同一草稿交接入口，校验知识快照与引用归属，等待聊天激活并保留旧草稿，见[知识交接日志](iterations/2026-09-27-knowledge-chat-handoff.md)。

命令运行支持固定选择历史记录、查看保留输出并准备分析草稿，明确运行中状态、截断及历史摘要缺失日志，见[命令分析日志](iterations/2026-09-27-run-analysis-handoff.md)。

命令运行器已提取按 API/工作区隔离的轮询与操作控制器，加入启动回复校验和结果未确认时的显式刷新要求，见[运行器恢复日志](iterations/2026-09-27-runner-recovery.md)。

共享目录发现已接入根 JS/Cargo/pnpm 声明，支持相对路径、`*`、`?`、字符组、`**` 与 pnpm 排除项；仍不解析完整包成员身份、brace/extglob、依赖图或继承配置。见[仓库声明日志](iterations/2026-09-27-workspace-declarations.md)与[pnpm 接续日志](iterations/2026-09-27-pnpm-workspaces.md)。
根目录 `go.work` 的常见字面 `use` 声明现可补充模块目录发现，并给各模块提供独立的 `go -C` 检查、构建和测试命令；复杂语法与外部路径保留不完整提示，见[Go 工作区日志](iterations/2026-09-27-go-work-modules.md)。
未加引号、无空格的 Unicode 字母数字模块目录现可进入同一有界发现流程；见[Go Unicode 目录日志](iterations/2026-09-29-go-work-unicode-modules.md)。
无转义的普通双引号 `go.work` 模块路径也可进入该流程，包括含空格目录；见[Go 普通引号目录日志](iterations/2026-09-29-go-work-plain-quoted-modules.md)。
`go.work` 行尾 `//` 注释仅在引号外识别，保留引号内的完整声明供路径校验；见[Go 注释边界日志](iterations/2026-09-29-go-work-quoted-comment-boundary.md)。

项目开发环境页已加入根目录清单识别、JavaScript 运行时要求展示和宿主工具版本诊断。
已接续实现 JavaScript engines 与 packageManager 的版本要求比较；项目虚拟环境和完整依赖仍未验证。
设计与验收见 [开发环境工作日志](iterations/2026-09-26-project-environment.md)。

已支持显式选择现有 Conda prefix，用于 Python 命令、环境诊断和新终端；不执行激活脚本，见[Conda 环境工作日志](iterations/2026-09-27-conda-prefix.md)。

自动 Python 选择已接入当前子项目目录的 `.venv` 与 `.conda`（前者优先），并从该目录向上查找到工作区根目录；只读诊断不执行解释器，见[项目内 Conda 日志](iterations/2026-09-27-local-conda-discovery.md)与[Monorepo 环境继承日志](iterations/2026-09-29-python-ancestor-environment.md)。其他安装位置及跨平台实机验收仍待推进。
开发环境页现可只读列出本机 `~/.conda/environments.txt` 与 `~/.conda/envs` 中仍有效的 Conda prefix，选中后填入显式环境草稿，保存再校验并应用；其他安装位置的环境和跨平台实机验收仍待推进。见[Conda 环境发现日志](iterations/2026-09-30-conda-registry-discovery.md)。
发现入口现额外读取 Host 的 `CONDA_PREFIX` 与 `CONDA_ENVS_PATH`，覆盖部分非标准安装位置，仍需用户选择并保存；见[Conda 配置目录日志](iterations/2026-10-01-conda-configured-discovery.md)。未设置这些变量的其他位置仍需手动输入。
Poetry 项目已按有效 `pyproject.toml` 中的明确声明提供固定检查、测试和构建命令，环境页诊断 Poetry CLI；Poetry 自行选择环境，外部环境列表可由用户手动运行固定任务查询，见[Poetry 命令日志](iterations/2026-09-27-poetry-project-tasks.md)与[Poetry 列表交接日志](iterations/2026-09-30-poetry-environment-list.md)。
Poetry 固定命令现不再继承项目显式 Python 环境的激活变量和路径，项目工具目录仍可指定 Poetry CLI；见[Poetry 环境隔离日志](iterations/2026-09-29-poetry-environment-isolation.md)。真实三平台运行仍待验收。
Poetry 项目任务现提供手动执行的 `poetry env info --path`，在已有任务输出与历史中查看 Poetry 选择的环境；环境页仅提示入口，不自动执行项目内 Poetry 命令。见[Poetry 环境查询日志](iterations/2026-09-29-poetry-environment-query.md)。
`uv.lock`、`[tool.uv]` 或根目录 `[tool.uv.workspace]` 明确成员关系标识的 Python 项目现提供固定锁定、同步、测试与构建命令，并在环境页诊断 uv CLI；uv 自行管理项目环境，不继承另选的 Python venv/Conda，见[uv 项目日志](iterations/2026-09-30-uv-project-tasks.md)与[uv 工作区日志](iterations/2026-09-30-uv-workspace-members.md)。真实依赖解析和三平台执行待验收。
开发环境页现可从当前 Host 会话、当前子目录最近一次成功的 `poetry env info --path` 结果填入 Python 环境草稿；最近查询失败或当前任务清单指纹变化时不回退旧路径。需要用户保存，Host 随后验证路径。运行摘要不保留输出，重启 Host 后需重新执行查询。见[Poetry 环境导入日志](iterations/2026-09-30-poetry-environment-handoff.md)。
用户主动运行 `poetry env list --full-path` 后，开发环境页可读取同目录最近一次成功且完整的列表并选择路径填入草稿；同样要求当前任务指纹一致，保存时由 Host 校验，见[Poetry 列表交接日志](iterations/2026-09-30-poetry-environment-list.md)。

环境诊断已读取当前目录 `.nvmrc` 和 `.node-version` 的静态 Node 版本声明；声明冲突与动态别名保留为待人工确认状态，见[Node 版本文件日志](iterations/2026-09-27-node-version-files.md)。
Ruby 项目现识别 `Gemfile` 和 `.ruby-version`，诊断当前 `ruby --version`，并对精确 `X.Y.Z` 声明进行只读比较；子项目继承工作区内最近的版本文件，见[Ruby 环境日志](iterations/2026-10-01-ruby-environment.md)。
`Gemfile` 项目现提供用户主动启动的 `bundle check`、`bundle install`；同目录有 `Rakefile` 时再提供 `bundle exec rake` 默认任务，并在环境页诊断 Bundler CLI，见[Ruby 命令日志](iterations/2026-10-01-ruby-bundler-tasks.md)。
Bundler 固定命令显式使用当前子项目的 `Gemfile`，清除宿主继承的 `BUNDLE_APP_CONFIG`；只读工具版本诊断清除可注入 Ruby 加载选项的环境变量，见[Ruby 命令日志](iterations/2026-10-01-ruby-bundler-tasks.md)。
`Gemfile.lock` 的 `BUNDLED WITH` 现进入环境页，精确版与当前 Bundler CLI 作保守比较；锁文件缺失版本段或非精确声明不推断兼容，见[Bundler 锁版本日志](iterations/2026-10-01-bundler-lock-version.md)。
PHP 项目现识别 `composer.json` 和 `.php-version`，诊断 PHP/Composer，比较版本管理器中的精确 PHP 版本；有效 `composer.json` 提供手动验证和安装命令，见[PHP 项目日志](iterations/2026-10-01-php-composer.md)。
Composer 的明确脚本也可在同一命令目录中手动运行；复杂脚本声明保持由 Composer 自身处理，见[PHP 脚本日志](iterations/2026-10-01-php-composer-scripts.md)。
PHP/Composer 只读版本诊断现清除宿主继承的 `COMPOSER`、`PHPRC` 和 `PHP_INI_SCAN_DIR`，避免把其他项目的清单或 PHP 配置带入探测；见[PHP 诊断隔离日志](iterations/2026-10-01-php-diagnostic-isolation.md)。
`composer.json` 的 `require.php` 现展示并对精确版、常见主版本 caret 和最低版本写法与检测到的 PHP CLI 作保守比较；其他 Composer 约束显示待人工核对，见[Composer PHP 要求日志](iterations/2026-10-01-composer-php-requirement.md)。

CMake 项目目录现在提供固定配置、构建与 CTest 命令，输出限定在项目内 `build/zicode-studio`；环境页探测 CMake/CTest，见[CMake 项目命令日志](iterations/2026-09-27-cmake-project-tasks.md)。

根目录 CMake 预设的配置、构建与测试任务也已接入；其输出位置由预设决定，包含文件和条件由 CMake 在执行时解析，见[CMake 预设日志](iterations/2026-09-27-cmake-presets.md)。

Java 项目已提供 Maven/Gradle 固定任务与项目 wrapper 优先选择，并在环境页显示 Java、Maven、Gradle 工具诊断；见[Java 项目任务日志](iterations/2026-09-27-java-project-tasks.md)。
含 `deno.json` 或 `deno.jsonc` 的目录现进入子项目发现，并提供 Deno 格式检查、lint 和 test 固定命令及 CLI 诊断；配置中的自定义任务与直接依赖可审阅后主动运行，见[Deno 项目任务日志](iterations/2026-10-01-deno-project-tasks.md)、[自定义任务日志](iterations/2026-10-01-deno-custom-tasks.md)与[依赖任务日志](iterations/2026-10-01-deno-task-dependencies.md)。
根 Deno 配置的 `workspace` 数组也纳入有界成员目录发现；深层成员仍需受支持的清单文件，见[Deno 工作区目录日志](iterations/2026-10-01-deno-workspace-discovery.md)。
环境页现只读核对当前 Java 清单和可用的项目 wrapper；宿主 CLI 缺失时仍显示真实探测状态，但有 wrapper 的项目不再误提示安装，见[wrapper 环境日志](iterations/2026-10-01-java-wrapper-environment.md)。三平台实际启动仍待验收。

.NET 解决方案与项目文件已作为独立命令目标接入，提供固定还原、构建、测试及项目发布任务，并探测 dotnet CLI；见[.NET 项目任务日志](iterations/2026-09-27-dotnet-project-tasks.md)。

.NET 任务已将工作区内最近的 `global.json` 纳入指纹；环境页显示其 SDK 声明，并在所选项目目录单独探测实际 SDK 选择，不模拟版本前滚策略；见[.NET SDK 选择日志](iterations/2026-09-27-dotnet-sdk-selection.md)。

混合项目的命令列表现按来源清单分组，可筛选名称、命令、来源和工具；界面筛选不改变 Host 任务标识和指纹，见[命令列表日志](iterations/2026-09-27-project-command-discovery-ui.md)。
常用命令现可按工作区与子项目目录在本机置顶，组和组内置顶项提前，并可只看置顶；只保存任务 ID，不改 Host 目录指纹或运行参数，见[命令置顶日志](iterations/2026-09-28-project-command-favorites.md)。
置顶命令现可按当前子项目目录主动下载和校验后导入，确认时与目标目录原有置顶合并，不触发执行；见[置顶迁移日志](iterations/2026-09-29-command-favorites-transfer.md)。
项目总览现读取该项目最近三条命令运行摘要，显示状态、子目录和快照时间，并可进入命令页查看详细记录；历史不可用时明确提示，见[总览命令日志](iterations/2026-09-28-project-recent-runs.md)。
命令页现可主动下载当前项目的运行摘要 JSON，保留快照来源状态及运行元数据，排除命令正文和输出；它不写回另一设备的运行历史，见[摘要导出日志](iterations/2026-09-28-project-run-history-export.md)。
项目内 `.zicode/project.json` 的上下文读取现会显式报告损坏文件，并阻止界面用空配置覆盖；写入改为同目录临时文件提交，见[上下文可靠性日志](iterations/2026-09-28-project-profile-integrity.md)。
项目上下文现使用文件哈希修订号和独占写入锁；多窗口保存冲突保留草稿，并可展开查看已保存版本，见[上下文并发日志](iterations/2026-09-28-project-profile-concurrency.md)。
上下文页现可单独刷新已保存版本且保留草稿；过时的异步读取结果不会覆盖新修订号，见同一日志的接续记录。
保存请求期间的后续输入现在会保留为未保存草稿，旧项目迟到的保存结果不会写回当前状态；见同一日志的保存期间编辑记录。
同一窗口切换最近项目时会保留各自未保存的上下文草稿；本机加密恢复副本现可在关闭窗口后按项目查看、恢复和丢弃，写入未完成会提示，见[窗口内草稿日志](iterations/2026-09-28-project-context-window-drafts.md)与[加密恢复日志](iterations/2026-09-28-project-context-recovery.md)。跨平台实机恢复仍待验收。
恢复副本现支持主动下载 JSON，并在目标项目中校验、确认后导入为独立加密副本；导入本身不覆盖编辑器或项目配置，见同一加密恢复日志。
即使没有未保存草稿，已保存的项目上下文也可单独下载；导入时以目标项目当前已保存值为合并基准，先进入恢复列表再由用户审阅，见[保存配置迁移日志](iterations/2026-09-29-saved-context-transfer.md)。
会话 JSON 备份现支持经用户确认后把来源项目会话头重绑定到当前工作区，且严格校验来源、会话 ID 与独占写入；导入请求体上限也与内容上限一致。跨设备真实恢复尚待验收，见[会话迁移日志](iterations/2026-09-29-session-backup-relocation.md)。
多窗口刷新现逐字段合并项目上下文：未改字段采用最新已保存值，双方修改同一字段时要求逐项选择；见[字段合并日志](iterations/2026-09-28-project-profile-field-merge.md)。
总览还展示项目关联任务和已启用或待审批自动化的少量条目，复用现有项目范围与条目跳转，读取不全时保留过期提示，见[项目工作概览日志](iterations/2026-09-28-project-work-summary.md)。

Windows `.cmd` 工具包装器现拒绝非字面值任务参数，避免项目预设名被批处理解释器重新解析；CMake 预设文件也已列入环境清单，见同一日志的接续记录。

Windows 项目终端已优先使用标准安装位置的 PowerShell 7，其次查找绝对 PATH 目录中的 `pwsh.exe`，均不可用时回退系统 Windows PowerShell；实际启动验收仍待完成，见[终端 Shell 日志](iterations/2026-09-27-terminal-pwsh.md)与[PATH 查找接续日志](iterations/2026-10-01-terminal-pwsh-path.md)。
Unix 项目终端现检查宿主 `SHELL` 的可执行权限，不可用时回退 `/bin/sh`；作为登录 Shell 的 PowerShell 7 使用专属无 Profile 参数，见[Unix Shell 选择日志](iterations/2026-09-29-unix-terminal-shell.md)。macOS/Linux 真实 PTY 启动仍待验收。
未识别的 Unix Shell 现在不再被强制传入 `-i`，由终端 PTY 启动后自行决定交互行为；见[Unix Shell 参数日志](iterations/2026-09-29-unix-shell-arguments.md)。真实不同 Shell 的行为仍待实机验证。

工作区外部应用目标现按 Windows/Linux PATH 中实际存在的命令列出，并在打开前转换 Windows verbatim 路径；见[外部应用目标日志](iterations/2026-09-29-external-app-targets.md)。各平台真实编辑器和文件管理器启动仍待验收。
Linux 文件管理器与外链打开现共用 `xdg-open`、`gio open` 的优先选择；两者均不可用时不展示文件管理器目标，见[Linux 打开器日志](iterations/2026-09-29-linux-openers.md)。真实桌面会话仍待验收。

Host 操作现对远程客户端默认拒绝；桌面外部应用请求还须匹配已登记工作区与当前发现的目标，Windows 外链交给系统 Shell API，见[外部打开边界日志](iterations/2026-09-29-external-open-boundary.md)。真实远程协议与三平台启动仍待验收。

WebSocket Router 和扩展 UI 所有权现使用每条连接独立的服务端 ID，断开时清理，避免客户端自报 ID 的冲突或重连覆盖；见[客户端身份日志](iterations/2026-09-29-websocket-client-identity.md)。双连接与远程重连仍待实机验收。
本机回环 WebSocket 对远程页面来源现要求设备令牌，避免仅凭回环连接自称桌面客户端；见[来源与身份边界日志](iterations/2026-09-29-websocket-origin-role.md)。实际浏览器与远程配对仍待验收。
回环 HTTP 入口现检查浏览器 `Origin` 与 `Sec-Fetch-Site`：跨来源请求须有设备令牌，且不能借回环地址调用桌面专属的配对二维码或模型网关；见[HTTP 来源边界日志](iterations/2026-09-29-loopback-http-origin.md)。真实浏览器与移动端访问仍待验收。
原生桌面窗口现由 Host 注入随机会话凭据，WebSocket 桌面握手必须提交该值；普通浏览器打开回环地址不会再自动获得桌面身份，见[桌面窗口凭据日志](iterations/2026-09-29-desktop-window-credential.md)。跨系统原生窗口与浏览器验收仍待完成。
配对二维码 HTTP 入口现同样要求原生窗口令牌，回环浏览器无令牌时不显示入口、也无法签发配对链接；见[二维码凭据日志](iterations/2026-09-29-pairing-credential.md)。真实窗口和手机配对仍待验收。
远程设备切换项目时的路径解析现仅查询桌面已登记的工作区，不会将请求给出的任意目录登记为新项目；见[远程工作区范围日志](iterations/2026-09-29-remote-workspace-scope.md)。多项目真实切换仍待验收。
插件启停、授权、重载、卸载、Worker 命令与非内置能力的 HTTP 调用现要求原生桌面窗口令牌；已配对设备仍可读取插件目录与调用内置能力。远程插件管理页已禁用桌面操作并显示提示，见[插件 HTTP 权限日志](iterations/2026-09-29-plugin-http-boundary.md)。实机行为仍待验收。
开发者插件视图的源码端点现也要求原生桌面窗口令牌；远程端显示不可用说明，不加载无法调用 Worker 的视图，见[插件视图范围日志](iterations/2026-09-29-plugin-view-remote-scope.md)。桌面和远程实际页面仍待验收。
签名插件视图现与开发者插件共用桌面沙箱加载和未保存离开确认，修复已有注册表允许签名视图而前端显示空白的偏差；见[签名视图日志](iterations/2026-09-29-signed-plugin-views.md)。真实签名包仍待验收。
远程端现从活动栏、移动菜单、数字快捷键和命令面板排除开发者与签名插件；外部插件深链回退聊天并说明桌面可用，见[远程导航日志](iterations/2026-09-29-remote-plugin-navigation.md)。远程真实导航仍待验收。

新项目终端在自动模式下已按启动子项目目录选用本地 `.venv`/`.conda`，显式环境仍优先；见[终端 Python 环境日志](iterations/2026-09-27-terminal-python-environment.md)。

金融场景的默认引导已改为本地研究和手工来源数据优先，QVeris 保留为可选外部数据来源；演示数值使用虚构标的，见[金融来源解耦日志](iterations/2026-09-27-finance-optional-data.md)。
可选金融数据客户端的默认地址现固定，不再由继承的 `QVERIS_CAPABILITY_BASE_URL` 改写场景凭据去向；显式构造参数仍可用于明确的集成，见[凭据目标边界日志](iterations/2026-10-01-finance-endpoint-boundary.md)。

金融外部连接现只读取显式的场景运行时凭据或场景 `auth.json`，不再从继承的 `QVERIS_API_KEY` 和当前工作目录隐式取密钥；模型渠道原有的场景注入机制保留，见[金融凭据边界日志](iterations/2026-09-30-finance-scene-credentials.md)。

Pi 子进程现先清除继承的 `QVERIS_API_KEY`，再按场景注入凭据，避免未配置场景从宿主环境获得内置 QVeris 模型渠道的密钥；见[子进程凭据日志](iterations/2026-09-30-pi-scene-env-credentials.md)。

这一边界已扩展至通用模型渠道使用的全部 `*_API_KEY` 引用：Pi 子进程清除宿主继承值后只恢复当前场景凭据，见[通用渠道环境隔离日志](iterations/2026-09-30-pi-provider-env-isolation.md)。

模型网关代理日志已去除 Authorization 内容片段、长度及上游响应正文预览，只保留请求与状态元数据，见[网关日志隐私日志](iterations/2026-09-27-model-gateway-log-privacy.md)。
本地模型网关代理现把上游响应体按字节流转给 Pi，针对较大上下文使用有界的 16 MiB 请求体，并转发 SSE 缓存控制与限流等待头；见[网关流式日志](iterations/2026-09-29-model-gateway-streaming.md)。真实首字时间和断线行为待验收。

可选 QVeris 目录同步与金融能力客户端已停止向界面透传上游错误正文和网络异常文本，只暴露 HTTP 状态及固定错误类别，见[外部错误隐私日志](iterations/2026-09-27-provider-error-privacy.md)。
金融能力客户端现按传输字节逐块限制成功响应大小，超限取消流并维持固定错误类别，见[响应边界日志](iterations/2026-10-01-finance-response-bound.md)。
模型健康检查也已停止持久化上游错误正文，只保留状态与有界结构化分类；旧健康记录读取时安全归一并尝试原子清理落盘原文，见[健康错误隐私日志](iterations/2026-09-28-model-health-error-privacy.md)。
扩展设置页现先读取本机已安装包，支持手动输入 npm、Git 或本机绝对路径来源，也可用原生选择器选取本机文件夹或扩展文件；社区目录只在用户点击“浏览在线目录”时请求，见[扩展目录离线入口日志](iterations/2026-09-28-package-catalog-opt-in.md)。
对外 README 和 npm/Cargo 包描述已与本地优先的跨平台开发者平台定位同步，并移除 README 中过时的默认 QVeris 自动同步承诺；见[产品说明核对日志](iterations/2026-09-28-product-metadata.md)。
`bun.lock` 的根包名已同步为当前产品名，根依赖声明与 `package.json` 一致，并通过 Bun 1.3.14 的 frozen dry run；见[锁文件身份日志](iterations/2026-09-28-bun-lock-identity.md)。

## 后续顺序

子包已支持从注册工作区内最近的明确 JS/pnpm 成员声明继承包管理器选择，并在命令和环境页显示依据与配置目录；本地显式声明优先，冲突报错，见[包管理器继承日志](iterations/2026-09-27-package-manager-inheritance.md)。此功能尚未覆盖 engines、依赖或全部工具配置继承。

1. 补齐 Git/环境诊断/命令运行器视觉与 macOS/Linux 生命周期验收，推进项目工具链、其他环境安装位置与 monorepo 声明解析；标准 Python venv 已支持显式选择，Poetry 多环境列表可由用户主动查询。JS、Rust、Go 和 Python 已加入宿主默认版本比较，Python 使用静态 PEP 621 声明。

Go 工作区根目录的 `go.work` 现能在环境页展示 `go` 和 `toolchain` 版本要求，与 `go.mod` 使用同一有界解析；未对任意子目录推断继承，见[Go 工作区声明日志](iterations/2026-09-30-go-work-requirements.md)。

选中 `go.work` 明确列出的模块根目录时，环境页还会读取注册工作区内最近的祖先工作区版本声明；不完整或未声明的成员不推断继承，见同一日志。

Rust 成员包显式写入 `rust-version.workspace = true` 时，环境页现可在注册工作区内根据明确的 `members` / `exclude` 和 `[workspace.package] rust-version` 解析最低版本；隐式成员仍保留未解析，见[Rust 工作区版本日志](iterations/2026-09-30-rust-workspace-version.md)。

成员通过 `package.workspace` 显式指向注册工作区内的祖先目录时，也可使用该工作区声明的最低 Rust 版本；越界、非祖先或被排除的目标仍保持未解析，见同一日志。

项目环境页现会显示注册工作区内最近的祖先 `rust-toolchain` 声明，保留本地优先、双文件冲突和不可读状态；这仍是声明报告，不代表 rustup 实际选择，见[祖先工具链日志](iterations/2026-09-30-rust-toolchain-ancestor.md)。

Node 的 `.nvmrc` 与 `.node-version` 也可从注册工作区内最近的祖先目录显示；本地声明优先，同层差异保留冲突，见[Node 祖先声明日志](iterations/2026-09-30-node-version-ancestor.md)。

环境页现显示本地或注册工作区内最近的祖先 `.tool-versions`，保留多个工具和候选版本的原始声明；不推断 asdf/mise 实际选择，见[版本管理器声明日志](iterations/2026-09-30-tool-versions-report.md)。

环境页只读识别根目录及 `mise/`、`.mise/`、`.config/mise/` 中的固定 mise TOML 配置路径，显示选中目录及注册工作区内最多 32 层祖先中的声明。仅提取 `[tools]` 中的版本字符串、字符串数组及仅含 `version` 的表；其他声明显示为复杂配置，不执行任务、插件或环境脚本，也不推断 mise 的配置合并及优先级，见[2026-10-01 mise 声明日志](iterations/2026-10-01-mise-tool-declarations.md)。

子项目目录发现现把仅含 `.tool-versions` 或受支持 mise 配置的目录列入环境、终端和存储视图的选择器；固定任务命令仍按语言清单独立判定，见[版本配置目录日志](iterations/2026-10-01-version-config-directory-discovery.md)。
共用子项目选择器现可手动输入工作区内相对目录，解决发现深度或数量上限导致的遗漏；只读 Host 确认目录后才切换，后续操作继续按各自边界复核，见[手动目录日志](iterations/2026-10-01-manual-subproject-directory.md)。

其中单一完整数字版本现可与本次探测到的 Node、Bun、Deno、npm、pnpm、Yarn、Python、Rust 和 Go 版本精确比较；动态或多候选声明仍需用户核对版本管理器的实际选择，见[固定版本比较日志](iterations/2026-09-30-tool-versions-exact-comparison.md)与[Deno 版本诊断日志](iterations/2026-10-01-deno-version-diagnostics.md)。

Python 项目的 `.python-version` 现也能在本地或注册工作区最近的祖先目录显示；单一固定版本与本次选中的解释器比较，多候选和动态名称不推断实际选择，见[Python 版本文件日志](iterations/2026-09-30-python-version-file.md)。
`pyproject.toml` 的 Python 要求在界面中现明确说明比较对象是选中目录本次检测到的解释器，并在比较结果旁显示 Host 报告的选择来源；不再误称一律使用宿主 Python，见[来源提示日志](iterations/2026-10-01-python-assessment-source.md)。
2. 持续完善项目级任务、知识、产物与自动化关联；已支持明确归属聚合、项目上下文创建、任务文件并发保护及显式保存任务草稿，已接续自动化独立草稿保存与恢复，继续完善跨项目恢复、并发验收和异常遗留锁恢复。
项目工作页现可分批展开当前已加载的关联任务与自动化，不再停在前 20 项；见[项目工作列表日志](iterations/2026-10-01-project-work-load-more.md)。
Windows 项目工作关联现统一混用斜杠与重复分隔符的绝对路径键，避免同一目录的任务和自动化漏显；仅用于界面匹配，见[路径关联日志](iterations/2026-10-01-project-work-windows-paths.md)。
从项目页打开具体任务或自动化现等待对应中心实际激活完成并核对当前页面后再聚焦，任务入口移除固定 200 毫秒等待；同目标并发激活共享完成结果，不同目标请求按到达顺序完成，见[工作导航日志](iterations/2026-10-01-project-task-navigation.md)。真实桌面导航待验收。

自动化项目切换现立即清空旧项目工作流、焦点与待创建入口，并阻止切换前的迟到读取继续派发或回填当前项目；见[目标隔离日志](iterations/2026-09-30-automation-target-isolation.md)。已提交到 Host 的写入仍需在原项目核对，真实多窗口和三平台验收待补。
自动化审批结果现只在原作用域仍可见时刷新或报错；工作流读取还会在目标变化但同步通知未到达时主动同步作用域，见[审批反馈作用域日志](iterations/2026-10-01-automation-approval-scope.md)。
正式自动化规则现采用修订号、独占锁和原子替换；损坏文件不再回退为空列表，冲突不会静默覆盖其他窗口，见[规则并发日志](iterations/2026-09-30-automation-workspace-concurrency.md)。真实多窗口与跨平台文件系统验收仍待补。
自动化写入现能保守回收属于本机且持有进程已确认退出的新格式遗留锁；旧格式、共享盘身份不明和恢复目录遗留仍报忙，见[遗留锁恢复日志](iterations/2026-10-01-automation-stale-lock-recovery.md)。真实异常退出和多窗口验收仍待补。
旧页面调度器曾只轮询活动工作区。当前桌面 Host 已接管已注册工作区的到期扫描与派发，工作流的派发目标项目不改变规则存储归属；跨平台实际运行、退出后的持续执行和并发时序仍待验证。
全工作区调度的 Host 生命周期、规则/任务文件并发契约和执行边界见[调度设计调查](iterations/2026-09-30-global-automation-scheduler-design.md)。
桌面自动化中心通过 Host 的只读扫描显示所有已注册工作区的规则数、到期数和文件错误；实际到期入队及免审批派发由独立的 Host 生命周期任务处理。应用退出后的持续执行和真实跨平台运行仍待验收。
工作区清单的首次读取和手动刷新现只接收最后一次请求结果，视图卸载后不再采用旧响应；见[清单刷新日志](iterations/2026-10-01-automation-inventory-refresh.md)。
自动化中心可见时，工作区清单每分钟及从隐藏恢复时刷新；重叠请求合并成一次后续扫描，见[持续刷新日志](iterations/2026-10-01-automation-inventory-live.md)。
跨工作区清单现先校验原生 Host 响应再渲染；损坏响应显示扫描错误并保留上次有效结果，正常空清单有独立提示，见[响应边界日志](iterations/2026-10-01-automation-inventory-contract.md)。旧 Host 与三平台真实页面仍待验收。
派发任务的状态和费用写回现固定到发起工作区的 Pi 目标；同一窗口重载可从会话存储恢复仍存活的实例订阅，跨窗口、实例退出及应用重启后的完整恢复仍需 Host 持久索引，见[任务归属日志](iterations/2026-09-30-dispatched-task-origin.md)。
3. 清理平台对特定服务的默认绑定；翻译和摘要已支持显式选择兼容模型及本地免密服务，默认渠道注入与自动目录同步已移除，社区包目录也改为显式联网，继续处理金融适配与其他在线入口，并补齐离线验收。
静态联网入口复核只发现两处固定 QVeris 地址，位于专用金融客户端与显式模型代理；通用模型渠道读取不注入提供方，更新检查在当前关闭的自动更新模式下不启动。见[可选服务边界调查](iterations/2026-10-01-optional-service-boundary.md)。这仍需真实离线启动和项目任务验收。
4. 在 Windows、macOS、Linux 分别积累真实交付证据，再推进跨设备同步和生态分发。

Poetry 环境诊断现与固定命令使用同一套工具选择和环境隔离规则；即使 Host PATH 已包含用户选中的 venv/Conda，也会在 Poetry 后备查找和子进程 PATH 中跳过该环境，见[Poetry 诊断日志](iterations/2026-09-29-poetry-diagnostic-isolation.md)与[环境隔离接续记录](iterations/2026-09-29-poetry-environment-isolation.md)。真实 Poetry/Conda 组合及跨平台行为仍待验证。
项目终端与任务子进程现清理宿主继承的 Python/Conda 激活变量和相关 PATH 目录，再按显式选择或项目本地环境设置子进程；见[宿主 Python 环境隔离日志](iterations/2026-09-29-ambient-python-isolation.md)。真实 macOS/Linux 终端及多环境组合仍待验收。

无项目环境时的宿主 Python 回退现按 PATH 目录优先级查找，并跳过有效宿主激活环境目录；见[宿主 Python 回退顺序日志](iterations/2026-09-29-python-host-fallback-order.md)。多解释器组合仍待实机验收。

Node、Cargo、Go 等非包管理器环境诊断现从项目有效 PATH 选取工具，避免报告被宿主激活环境过滤掉的程序；见[环境诊断 PATH 日志](iterations/2026-09-29-environment-probe-effective-path.md)。

项目任务及包管理器诊断的后备工具查找也已统一到有效 PATH，Poetry 使用不含显式 Python 环境的工具 PATH；见[项目命令工具 PATH 日志](iterations/2026-09-29-task-manager-effective-path.md)。组合场景仍待三平台实机验收。

项目命令运行器已接入 package.json 脚本、Cargo/Go/Python 标准命令、项目 .venv、显式启动、停止、会话输出与可跨重启保留的运行摘要。
存在 GNU Make 文件时，项目命令列表现提供默认 `make` 目标，不解析 Makefile 规则；来源文件进入任务指纹，运行仍由 Host 管理。Windows 需自行安装 Make，见[Make 默认目标日志](iterations/2026-10-01-make-default-task.md)。
开发环境页同时列出 Makefile 声明与 `make` CLI 探测结果，并将该工具归入当前项目工具；探测只运行 `make --version`，不会执行项目默认目标。见同一[工作日志](iterations/2026-10-01-make-default-task.md)。
它使用 Host 管理的独立进程，远程端只读；已加入有限深度的子项目发现与命令目录选择、项目 PTY 交互终端和本机项目工具目录顺序配置。已支持显式选择已有标准 Python venv 与 Conda prefix、自动选择当前命令目录中的 `.venv`/`.conda`、只读发现用户级 Conda 两处来源，以及由用户主动查询并选择 Poetry 环境列表；其他安装位置、终端实机验收和 monorepo 依赖图解析仍待推进。
设计与本轮实际检查结果见[项目命令工作日志](iterations/2026-09-26-project-runner.md)。

JavaScript 版本要求比较与包管理器诊断的进展见[环境要求工作日志](iterations/2026-09-26-environment-requirements.md)。

Rust/Go 命令与混合项目识别见[多语言命令工作日志](iterations/2026-09-26-multilanguage-tasks.md)。

Python 命令与项目虚拟环境见[Python 工作日志](iterations/2026-09-26-python-tasks.md)。

子项目发现、执行目录与工作区隔离见[子项目命令工作日志](iterations/2026-09-26-nested-project-tasks.md)。

项目任务与自动化关联、条目跳转及读取失败恢复见[项目工作日志](iterations/2026-09-26-project-work.md)。

项目上下文创建表单与失败重试见[项目创建工作日志](iterations/2026-09-26-project-work-creation.md)。

工作区任务文件的版本校验、进程间写入保护及失败后停止派发见[任务并发保存日志](iterations/2026-09-26-task-concurrency.md)。

任务草稿保存、恢复编辑及显式启用见[任务草稿日志](iterations/2026-09-26-task-drafts.md)。

翻译、摘要和本地模型服务选择见[模型渠道日志](iterations/2026-09-26-model-tool-providers.md)。

用户自主配置、删除渠道及显式目录同步见[自主配置渠道日志](iterations/2026-09-26-explicit-model-channels.md)。

Rust/Go 环境声明与版本比较见[多语言环境日志](iterations/2026-09-26-language-environment.md)。

Python PEP 440 比较、动态声明与虚拟环境边界见[Python 环境日志](iterations/2026-09-26-python-environment.md)。

Host 退出时连接取消、P2P 关闭与可等待回收见[Host 退出日志](iterations/2026-09-26-host-shutdown.md)。

项目命令摘要持久化、保留上限、按项目清理与退出写入屏障见[命令历史日志](iterations/2026-09-26-command-history.md)。
Unix 命令历史作用域现直接使用路径原始字节，避免不同非 UTF-8 目录经过有损转换后共用历史键；普通 UTF-8 路径键保持不变，见[命令历史路径日志](iterations/2026-10-01-run-history-path-scope.md)。

项目 PTY 终端、会话重连和退出回收见[项目终端日志](iterations/2026-09-26-project-terminal.md)。

项目工具目录、配置冲突、统一 PATH 与 Windows 工作目录兼容见[工具目录日志](iterations/2026-09-26-project-tool-paths.md)。

显式 Python venv 选择已接入源码，运行及迁移验收待补；见[环境选择日志](iterations/2026-09-26-python-environment-selection.md)。

自动化独立草稿、恢复为新工作流及静态检查边界见[自动化草稿日志](iterations/2026-09-26-automation-drafts.md)。

笔记导入导出时的编辑保留、工作区作用域与保存协调见[笔记传输日志](iterations/2026-09-26-notes-transfer.md)。全工作区导入已接续暂存、提交记录与恢复实现，跨平台恢复验收仍待推进。

笔记整批恢复、进程锁、提交标记及崩溃恢复设计见[批量恢复日志](iterations/2026-09-26-notes-import-transaction.md)。

笔记稳定引用、备份内引用迁移、标题歧义提示与编辑保留见[引用迁移日志](iterations/2026-09-26-notes-reference-migration.md)。

笔记反向链接的代码排除、标题歧义规则、扫描范围提示与关联读取状态见[笔记关联日志](iterations/2026-09-26-note-relationships.md)。

笔记筛选、新建、复制与移动/删除的保存检查、批量失败保留选择和聊天采集编辑保护见[编辑切换日志](iterations/2026-09-26-note-edit-transitions.md)。

笔记设备本地加密恢复、跨工作区保留、冲突时另存副本与待验收边界见[草稿恢复日志](iterations/2026-09-26-note-draft-recovery.md)。

笔记附件默认文件编码、固定目标上传与迟到链接恢复见[附件作用域日志](iterations/2026-09-26-note-attachment-scope.md)。

网页采集、预览与 AI 摘要的固定工作区、结果顺序检查和表单生命周期见[网页采集日志](iterations/2026-09-26-note-web-capture.md)。

最近与置顶笔记的工作区隔离、事务偏好存储及旧快捷入口恢复见[快捷入口日志](iterations/2026-09-26-note-shortcuts.md)。

回收站固定工作区、按确认快照清空和 Host 条目条件校验见[回收站日志](iterations/2026-09-26-note-trash.md)。

回收站独立删除时间、历史条目保守迁移与删除事件校验见[保留期日志](iterations/2026-09-26-note-trash-retention.md)。

笔记 Astro 构建接线、Vault 检查和聊天交接隔离见[知识工作流日志](iterations/2026-09-26-note-workflow-handoff.md)。

Python 根目录诊断与命令解释器的共享解析、来源显示和未检查状态见[解释器诊断日志](iterations/2026-09-26-python-diagnostic-source.md)。

开发环境已支持按发现的子项目目录检查清单及解释器选择，报告回传目录并拒绝旧 Host 的歧义结果；详见[子项目环境日志](iterations/2026-09-26-subproject-environment.md)。完整 monorepo 继承和依赖图仍待推进。

环境检查与命令运行器已共享按场景/工作区/路径隔离的窗口内子项目选择；清单目录确认和首次运行状态门槛见[目录上下文日志](iterations/2026-09-26-project-directory-context.md)。

新终端已接入共享子项目目录，使用独立协议并显示启动目录；会话仍按工作区归属和限额管理，见[子项目终端日志](iterations/2026-09-26-subproject-terminal.md)。

终端页已加入首次列表读取门槛、独立操作/读取错误与启动结果不明确时的显式刷新要求，按 API/工作区生命周期隔离异步回复；见[终端异常恢复日志](iterations/2026-09-26-terminal-session-recovery.md)。新 Host 可对当前控制器保留的启动意图返回同一会话，并在有限近期窗口内拒绝已淘汰意图；旧 Host 仍需人工核对。跨平台实机验收待补，见[终端启动意图日志](iterations/2026-09-30-terminal-open-intent.md)。
终端输出轮询现先校验会话信息、帧大小、游标边界及截断标记的一致性，再交给终端渲染；损坏响应沿用断开与重连入口，见[终端帧边界日志](iterations/2026-10-01-terminal-frame-contract.md)。真实旧 Host 与三平台 PTY 仍待验收。

Git 工作区进程边界已统一清除继承的 `GIT_*` 变量，状态读取使用 Windows 子进程可识别的普通路径；随包 Portable Git 的启动配置已确认。见[Git 工作区进程边界日志](iterations/2026-09-29-git-workspace-process-boundary.md)。跨平台安装包实机验收仍待完成。

项目命令运行结束后若 stdout/stderr 收尾读取超时或异常，现会将运行记录标记为输出不完整，见[命令输出完整性日志](iterations/2026-09-29-project-runner-output-integrity.md)。三平台大量输出与停止场景仍待实机验收。

桌面项目工具目录页现可用原生文件夹选择器填写现有 venv 或 Conda 前缀，保存前仍由 Host 验证；见[Python 环境文件夹选择日志](iterations/2026-09-29-python-environment-folder-picker.md)。用户级两处 Conda 来源可只读发现，Poetry 多环境列表可在用户主动运行固定命令后导入草稿；其他安装位置与三平台原生验收仍待推进。

同一页现可用原生文件夹选择器把工具目录加入草稿，复用最多八个目录与显式保存规则；见[项目工具目录选择日志](iterations/2026-09-29-project-tool-directory-picker.md)。

工具目录详情异常隔离已接入，独立故障不卸载其他工具；实际故障注入与截图证据、未覆盖故障模式见[异常隔离说明](plugins/tool-view-failure-isolation.md)。

## 2026-10-10 Pi1.1.0真实DevTools链路
当前debug EXE保持6c14d757，单target编译新版Pi锁定测试Host一次，Inspect7/Transforms23基本操作与各10权限阶段通过；150旧缓存拒绝、11独立对照、50Worker回收/管道关闭。三个原始包13/493/797文件逐SHA通过。矩阵current证据更新，旧记录保留历史；154项状态及完整接受0不变。没有模型/原生界面/其他OS/签名生命周期验收。清理本轮两夹具被自动审批拒绝（无具体原因），实际删除0，6812396B/1346文件保留并给手工清单；不重试。详见[复验记录](E:/zicode-studio-desktop/docs/plugins/pi-1.1-devtools-acceptance.md)及技术档案iterations/pi-1.1-devtools-2026-10-10。

2026-10-10：插件调用在带错误码的响应失败后保留执行锁，需有效Host终态证明才允许用户再次执行；取消/查询/退休凭据统一检查outcome。107项前端相关用例与生产工具中心模拟Host浏览器验证通过，真实Host/原生本轮未重验；见[终态证明](plugins/manual-call-terminal-proof.md)。


2026-10-10：工具目录的普通调用控制器独立于详情错误边界；渲染失败后保留状态、取消和关闭保护。110前端用例及Edge生产界面模拟Host故障注入通过，资源工具和原生专项待验；见[会话恢复](plugins/tool-session-recovery.md)。


2026-10-10后续Windows原生验证通过：错误界面控制真实生产Worker取消，真实成功响应丢失后同Host退休证明才解锁；详见[会话恢复原生补验](plugins/tool-session-recovery.md)。资源与其他OS不在本轮范围，完整154接受仍0。


2026-10-10：资源工具controller/DOM在详情故障后由会话保留，115项前端测试及真实HTTP/WASI专项通过；输入授权、实际输出预览、取消保存与撤销清屏验证通过。资源丢失响应恢复及原生专项仍待，见[资源会话恢复](plugins/resource-session-recovery.md)。

