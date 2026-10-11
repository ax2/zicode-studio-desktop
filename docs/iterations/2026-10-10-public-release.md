# 公开仓库与首次加载发布门槛

## 来源说明

README 纠正为最初参考 Picot 的 Pi 桌面封装架构，没有直接 fork Picot、未持续跟进。
当前 GitHub 仓库为公开独立仓库。保留的 Tau 历史提交与旧标签不删除，MIT 版权继续保留。
Picot 原公开地址返回 404，历史 fork 背景来自维护者说明；Tau 当前标记 retired。

## 发布前验证

- 前端全套 262 文件、1797 测试通过；六个类型检查入口通过。
- 修正两处 Promise 测试替身类型；修正命令面板旧宽度断言。
- GitHub Linux 暴露四处地区/时区依赖断言，改为当地计划时刻和当前 Intl 格式。
  UTC/英文定向 81 项及 GitHub Tests 已通过。
- Rust 主程序完整重跑 468 通过、29 条件跳过；其他二进制此前 5/19 项通过。
  严格 Clippy 通过，已有格式漂移仍为脚本 advisory。
- 工具路径探测前两轮整套失败、定向通过、最终整套通过。原因未确定，未放宽产品超时。
- 2265 个冻结提供方文件在 Git 暂存 blob 与原始内容间逐字节一致。

## 首次加载问题与修复

v0.4.0 的四平台 Release 门槛全部在 Inbox 注册检查失败，保持草稿，未公开发布。
本机已有缓存的检查通过，但复制到新路径后首次加载失败，因此已有缓存不能证明首次可用。

隔离诊断定位到 Pi 1.1.0 编译运行时的 Jiti 加载上下文：
`follow-redirects` 1.16.0 构造原型继承的错误对象时，
`Error.captureStackTrace(this, this.constructor)` 报 `First argument must be an Error object`。
调用链经 Axios 1.19.0 / 飞书 SDK。延长超时、压缩及 CJS 格式均不能修复这一问题。

Studio 的构建插件只转换该依赖的一处堆栈捕获：先捕获到真正的 Error，
再将 stack 放回库的错误对象。错误类、code、cause、message 和继承关系保持。
依赖代码签名不匹配时构建报错，要求重新审查；不编辑 node_modules、Pi 或 DevTools。
三个回归用例重现约束、验证错误语义并拒绝依赖漂移。
首次全新路径实际 Pi 命令注册、插件 HTTP 成功/拒绝/缺结果处理及退出通过，startup 10613ms。
因此验证脚本的整体期限由 10 秒改为有界 60 秒；所有功能断言保留，产品调用超时未变。

修复使用新的 v0.4.1 标签发布，不覆盖 v0.4.0。各平台构建与最终发布以对应 Actions 结果为准。
本机详细失败与通过证据持续保存在技术博客档案
`zicode-studio-desktop/iterations/public-release-2026-10-10/`。

## 仍待验收

DevTools 全目录 154 项完整验收仍为 0；候选基本操作验证不能代替完整工具接受。
其他系统完整人工体验、实际外部机器人登录/收发和所有提供方算法等价性未作为本轮通过。
资源响应丢失/写入确认后的不确定状态恢复等已知边界继续记录在插件文档。

## 2026-10-10 晚间：四平台第二轮阻塞
v0.4.1 Release 38020531435 的 Inbox 注册检查在四个平台通过；后续 Windows 布局断言依赖 LF，macOS 重复 generate_context! 导致 _EMBED_INFO_PLIST 重复，Linux notify-rust 4.11.4 不兼容锁定的 zbus 5.18.0，Release 仍为草稿且无产物，未公开发布。
主分支 Developer platform 38020522158 的已下载报告另发现 Rust 1.99 新 Clippy 告警，以及 Windows PTY 的 PowerShell 从 canonical verbatim EXE 路径推导出错误 UNC 模块路径。保留原失败报告，不降低门槛。
修复：读取 Rust 测试源码时统一换行；提取 application_context.rs 单一宏展开；最小升级 notify-rust 4.11.5（上游该补丁直接使用 futures-lite，不再依赖 zbus 的移除导出）；等价改写排序/遍历/除法、平台限定 OCR 常量；在 PTY 启动边界使用既有 Win32 路径转换器，保留此前 canonical 身份校验。大型 Rust 文件只改报错处，避免无关重构。
本机布局 68 项及 lint/design 通过；第一轮静态 Rust 通过，追加 Clippy/终端修复后的完整 Rust 检查进行中。先在 main 上检查四平台，成功后才生成新修订标签，不覆盖 v0.4.0/v0.4.1。
此前本机 0.4.0 编译在 makensis 阶段后进程已结束，无安装包；仅有旧版本 EXE，不算可交付。最终版本须重新完整构建并检查实际截图。
上游修复源码：https://github.com/hoodie/notify-rust/blob/v4.11.5/src/xdg/zbus_rs.rs

第二轮本机完整 Rust 检查通过：主程序468通过/29条件跳过，其他二进制5/19通过；严格Clippy通过，fmt仍为既有advisory。测试并发RUST_TEST_THREADS=2；新终端路径改写的真实PTY用例通过。各平台结果仍以新main运行报告为准。


终端夹具补充：project_environment PTY 测试此前只等待标记文件，没有像真实终端和其他PTY测试一样回复 ESC[6n 光标位置查询。补上读取及 ESC[1;1R 应答（可处理跨块查询）；保持12秒期限、原始PATH不变和文件标记断言。定向真实PTY 1项通过6.08秒，修改后的Rust静态检查/严格Clippy通过。此改动只涉及测试客户端，不改变产品超时或加载逻辑。main 9c152ed1 的四平台检查继续，不因这项测试补充取消已在运行的验证。

Linux 第二轮报告 38048690334：notify-rust/zbus 编译兼容阻塞已消失，继续暴露 automation_login_start.rs 的 AppImage 路径 OsString / current_exe PathBuf 分支类型不一致。将 AppImage 分支显式转 PathBuf，保持绝对路径/文件存在/UTF-8检查及安装程序路径而非挂载路径策略。Windows 静态检查通过仅证明当前系统分支，Linux最终确认仍依赖下一轮CI。
Developer platform 与 Release 的 Rust cache 设置 cache-on-failure:true；保留原缓存key和target，便于失败后的依赖复用，不改变发布门槛。上游输入说明：https://github.com/Swatinem/rust-cache#example-usage 。11项相关脚本检查通过，修改后Rust静态/严格Clippy通过。暂不推送，保留尚运行的Intel Mac/Windows报告。

Windows第二轮 38048690334 报告：全部脚本、Rust check、严格Clippy和真实Pi/多语言环境检查通过；仅环境PTY测试467通过1失败29跳过。失败输出已有普通C:\Program Files路径及正常PS提示符，无先前UNC搜索；原测试在Shell初始化前发送命令，未执行。修订测试先泵送终端查询、等首次PS提示符再发送一次工具命令，初始化和执行同在原12秒总期限内，保留PATH隔离及文件标记断言。本机定向1通过2.91秒，静态/严格Clippy通过。不能声称仅DSR修补已在CI通过，下一轮需核对。
为避免推送修复取消长时间main编译，Developer platform main/manual保留正在运行的检查；PR仍cancel-in-progress，使用默认单个最新pending，不排无界队列。官方说明 https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency 。11项相关脚本检查通过。

发布缓存复用：核对 rust-cache 源码（src/config.ts）后，Release 的 shared-key 对齐既有 Developer platform 的 inputKey + GITHUB_JOB，即 developer-platform-${{ matrix.os }}-platform；不修改现有main缓存键。下载重试配置从全局env移到四个实际Cargo/打包步骤，避免仅网络配置不同造成缓存环境hash分叉，实际下载仍使用原10次重试。新增2项缓存契约测试，总13项相关脚本检查及lint/design通过。GitHub缓存API实际确认旧main已有macOS arm64/x64各约1.24GB依赖缓存，前缀与预期一致；Release实际命中尚待新标签构建日志验证。
旧main 38048690334最终两种macOS成功；Intel耗时主要为rust-check669530ms、rust-tests933746ms及真实运行，非卡住。旧Windows只PTY失败，旧Linux仅AppImage类型编译错误，详细报告已归档。新main 38050399234已于20:22前后开始。当前新缓存契约/Release工作流修改仅本地提交，待最新main平台报告通过后随正式发布推送，避免重复触发四平台检查。

## 2026-10-11：第三轮报告及发布前修复

核对 main 45b239fc 的 Developer platform 38050399234 原始报告：ARM Mac 全通过；Intel Mac 仅聊天渲染专项未等待 React 提交而失败；Linux 实际通知用例缺少 org.freedesktop.Notifications 服务，另有三个 Unix 分支 Clippy needless_return；Windows 环境 PTY 已通过，但另一项终端关闭测试超过 30 分钟。Tests/Documentation 均通过。以上失败保留，未发布新版本。

修复范围：
- 终端停止后仍泵送内部光标查询应答，直至输出 EOF；拒绝新用户输入和 resize。此前 stop 时提前退出输入线程，可能使带 INHERIT_CURSOR 的 ConPTY 在 ClosePseudoConsole 中一直等待。新增确定性回归验证停止时拒绝用户命令、保留内部应答以及 EOF 后释放。
- Linux CI 使用 Xvfb + 独立 D-Bus 会话 + 真正的 Dunst 通知服务，有界等待服务就绪并在退出时收尾。保留真实通知断言，不跳过或替换为模拟后端；Linux 最终结果仍待 Actions。
- 聊天测试用 async act 等待真实 React root 初次挂载和后续更新，并逐个 unmount；只记录真实 createRoot 返回值，不替换渲染实现。chat.test.tsx 原本已超过 500 行，本轮仅补约 30 行生命周期支持及替换构造调用，避免无关重构。
- Linux 三处分支改为等价尾表达式；shell 文件强制 LF。新增 CI 通知环境契约测试。

目前本机定向聊天/缓存测试26通过，frontend TypeScript、lint/design 和 shell 语法通过；完整前端和 Rust 检查进行中，未将待运行结果记录为通过。继续复用既有 target，未另建缓存树、未复制运行目录。来源说明已完成但最新正式 Release 仍待四平台门槛及产物检查。
参考：Microsoft Creating a pseudoconsole session 的关闭/光标应答警告；React act 官方文档；Dunst 官方手册。具体链接与原始报告见技术博客档案。

第三轮修复本机最终验证：265个前端文件/1804测试通过；frontend typecheck通过；lint/design退出0（既有warnings保留）。完整Rust主程序469通过/29条件跳过、其他5/19通过，cargo check与严格Clippy通过，fmt既有advisory。新shutdown回归与原先CI超时的真实PTY关闭用例均通过；Windows本机通过不能替代新的Windows CI，更不能证明Linux/Mac分支。Linux通知环境wrapper语法通过，2项CI环境契约随全前端通过，实际daemon/通知测试等待Linux Actions。未改测试超时或产品预算。

终端关闭专项连续10次真实PTY检查全部通过，每次1.52–1.95秒，receipt terminal-close-repeat.json。进一步检查发现关闭ConPTY时仍持有master互斥锁，会阻塞已排队resize后的内部应答，已将take和drop分开，保证阻塞关闭前先释放锁；这项追加修改的检查另存最终static/定向日志，不把此前10次作为追加修改后的证据。
来源：https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session#ending-the-pseudoconsole-session ； https://react.dev/reference/react/act ； https://dunst-project.org/documentation/dunst/ 。
修复已先推送6eae881b，四平台新运行38099350812已开始。新Release仍未公开。

追加锁修复98233905的最终8项终端专项全部通过9.13秒；最终Rust static/严格Clippy退出0。最新真实Pi→Host插件broker独立条件测试1通过3.72秒（497 filtered；不代表其余条件测试全部通过）。原生截图/完整正式构建仍待。
6eae881b新CI 38099350812 的ARM Mac已完成全部检查，报告revision/clean/source/runner/target均核对匹配，6个TS入口、全JS、聊天专项、Rust及真实runtime通过，仅fmt advisory。其余平台尚未完成。发布说明补充终端退出与Linux AppImage修复；本次文档随最终源代码一并验证，不发布未经完成门槛的版本。

## 2026-10-11：Windows完整测试负载与报告透明性
最终main 2b9b173d / 38099853912：Linux、ARM Mac、Intel Mac均全通过（21步骤，fmt advisory）。Intel聊天24项已通过；Windows终端关闭不再超时，Rust 468通过1失败29跳过，唯一失败为project_environment PTY在12秒内未出现PowerShell提示符/工具标记，输出只有两个窗口标题；其余步骤含真实Pi→Host均通过。原报告已全量保存ci-38099853912。
当前只能确认失败发生在提示符之前，尚未从该输出证明是Roslyn/PSReadLine的哪一步。启动脚本确有每次Add-Type冷编译；整套并行测试含WASI冷编译，资源争用是推断，不写成已证实原因。
本机既有完整验证使用RUST_TEST_THREADS=2，主程序469通过；因此Windows CI/Release同样采用两线程harness，尊重平台检查的显式既有设置，并在JSON/summary记录实际值。其他系统不改，单项内部并发/12秒总期限/标记文件和PATH不变断言保留；最终代码20次并发终端关闭仍全通过。不是通过延长期限、减少单项负载或删除断言消除失败，默认并发的原失败证据继续保留。
补充9项脚本契约测试通过，lint/design退出0；新CI仍待实际结果。此轮没有Rust源码修改、没有新版本标签、没有正式构建或发布。

## 2026-10-11：Windows前台子进程退出确认
38101283106的Windows报告实际记录rustTestThreads=2，环境PTY用例这次通过；但前台子进程清理用例失败（WaitForSingleObject(...,0)=WAIT_TIMEOUT），主程序468通过1失败29跳过。不能把降低harness并发说成完整修复。Linux/ARM本轮已通过，Intel仍在运行；报告均保留ci-38101283106。
Windows TerminateJobObject仅发出终止；按官方文档等同向各进程调用异步TerminateProcess。原监控只等待Shell父进程退出，可能在后代进程仍收尾时完成TaskTracker。新增Windows专属Job accounting确认：关闭PTY后有界等待ActiveProcesses为0，先释放父进程句柄；3秒内不能确认则状态failed并记录静态错误，不报告closed。保留原8秒终端worker测试期限、原12秒工具启动期限，未改插件Worker预算。
process_drain.rs单独负责有界等待，覆盖计数逐步清空、查询失败及期限后仍存活三种情况。现有真实前台子进程测试加强为关闭前持有原进程句柄、关闭后必须WAIT_OBJECT_0且终端closed，避免PID复用/WAIT_FAILED误判；没有将原零等待断言改为额外等待。完整Rust检查进行中，待加强后的专项与静态检查后才提交。
大型mod.rs仅接入退出证明与失败状态，行为集中于process.rs/新模块，未进行无关重构。参考：https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject 、 https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess 、 https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information 。

追加退出确认本机结果：主程序472通过/29条件跳过、其他5/19通过，严格Clippy通过；加强句柄身份后的11项终端专项全部通过5.67秒，最终check:rust:static退出0（fmt既有advisory）。ActiveProcesses确认在测试保持子进程句柄时仍能正确结束并标记closed；原WAIT_OBJECT_0零等待断言通过。
额外4进程并行前台子进程压力验证与编译检查同时运行：实际执行8次，5通过3失败（5/6/7），失败均在12秒内未收到DESCENDANT-READY，尚未进入退出确认阶段；输出显示PowerShell逐字重绘长命令后尚无子进程标记。未将该结果写成退出清理失败，也未删失败、改期限或缩短原命令/负载。原始log/stderr及foreground-drain-attempt1-summary.json保留，后续12次未执行；不能宣称20次通过。高负载终端启动延迟已写入发布已知边界。
本轮用新模块实现退出确认，未改插件接口、Pi版本、应用版本或构建profile。当前改动待新四平台CI，不将本机通过代替Windows Server/Linux/Mac最终结果。

## 2026-10-11：正式版本与发布基础设施修复

0768357d的最终四平台38102941804全部成功，详细JSON已下载核对（各21步骤0失败，唯一rust-format advisory，Windows rustTestThreads=2），源码/runner/toolchain/clean身份均一致。官方发布脚本266文件1805测试与类型/lint/design/权限等门槛通过，创建v0.4.2及版本提交9c867b68ba79dd7611c5daa3c4a322aa411f5dd3，未移动旧标签。

本机完整Windows构建退出0，主程序编译30m01s，EXE0.4.2/52,701,184B，SHA256 166ffadd34b67331d76fd402c5e8c606c9ae5d0c994d9af60a300f986255be72；NSIS350,810,666B，SHA256 3bfd1d0fad61584a2529fa5362564ba29a29902695eeac5399f393a2aa1a3c90，9项必需资源全部存在，构建前后HEAD均9c867b68且dirty=[]。沿用target/release完整目录，没有应用ZIP或日期运行副本。

首次原生截图在NSIS打包完成前采集，EXE当时摘要735e00c0，不能算最终二进制验收，保留过程记录。打包完成后的166ffadd与全新独立profile的最终QA进程摘要一致，1440x900 CSS/DPR1.25的4张实际原生截图已实看：启动、16工具目录、搜索后按需详情、应用回退至空白剪贴板收件箱。页面异常和采集控制台error/warning均0。此内置工具明确提示通用表单不能执行，可打开应用；没有将导航/详情/空数据展示算作Worker调用通过，也没有模型请求、系统剪贴板读取、用户内容写入或154项全量验收。

首轮Release38104116572产品检查通过，Linux AppImage/DEB和ARM DMG实际生成上传，但草稿资产校验误用了仅查询published release的REST tag接口而404。另有GitHub将上传文件名ASCII空格转点的实际规范化。修复为认证的gh release view草稿查询；只接受原名/已观测的空格转点，拒绝歧义，保留架构/版本/大小/本地SHA256和五资产完整门槛。

工作流先从github.workflow_sha保留4个固定版本校验模块到runner临时目录，再切换原始release_sha构建应用，支持以新版发布基础设施重新验收同一不可变v0.4.2，而不重打标签/改应用版本。新增10项工具与来源契约测试、合计22项相关回归通过；真实草稿查询只读probe已通过，但原失败仍保留，修复后完整发布仍待实际执行。

参考：[GitHub Release tag API](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)及[工作流SHA定义](https://docs.github.com/zh/actions/reference/workflows-and-actions/contexts)。原始报告、构建收据、截图、临时探测代理失败与修复记录均见技术博客档案public-release-2026-10-10。仍待：其他OS人工UI、安装升级/卸载、模型服务、提供方算法和154项完整工具验收；欢迎页灰色辅助文案对比度有优化空间。

首轮Intel Mac额外失败：Rust正式编译26m56s成功，codesign主程序时发现同一.app的Contents/MacOS/zicode-relay未签名。ARM/Linux/Windows均已上传，草稿仅4资产，不能发布。38106544109在仅修复草稿查询后刚启动，读取完整首轮日志后发现此独立签名问题，已主动取消并确认cancelled；不将该轮算通过或让相同失败重复编译。

仅调整发布基础设施：从固定workflow SHA保存macos-bundle-signing.mjs，macOS CLI使用临时配置添加官方beforeBundleCommand钩子；检查relay目标架构后先ad-hoc签名并严格验证，再由Tauri签名完整应用。应用标签、Rust/前端源码与版本保持不变，显式记录该包装配置覆盖。上传后新增完整.app deep/strict签名验证及包内Pi/Bun启动门槛。共5个基础设施模块和1个临时macOS配置，未另建本机target或复制应用。

新增7项本机回归覆盖架构/系统拒绝、失败停止、路径引号、仅增加打包钩子和深度签名门槛；加上既有发布相关共29项通过，最终bun run check退出0、既有141warnings保持。第一轮断言误写预期错误词architecture而实际为Executable target mismatch，失败记录保留；最终断言准确检查原目标/实际目标。真实macOS签名仍待新发布流程，本机mock测试不能代替。
参考：[Tauri beforeBundleCommand](https://v2.tauri.app/reference/config/#beforebundlecommand)。

## 2026-10-11：最终 DMG 补验

第三轮 ARM Mac 已完成架构检查、relay 预签名、完整应用签名和 DMG 上传，随后 Tauri 清理临时 `.app`，旧后置检查因此报路径不存在；原失败保留，未改记为成功。改为只读挂载最终 DMG，校验应用版本、main/relay/Pi/Bun 架构、deep/strict 签名以及内置 Pi/Bun 的真实启动，并在成功或失败时卸载卷。
新增独立的 Verify existing release DMGs 工作流，只下载并验证既有草稿，不构建、不发布。可以复用同一不可变应用源码已通过的产品检查与打包，补齐最终磁盘映像验证，避免因为校验路径错误重复完整编译。最终发布前仍需核对原运行四平台全部产品门槛及打包成功、失败仅限已确认的临时路径检查，Linux/Windows上传摘要以及两份最终DMG收据，再核对五资产未变化。
本机相关35项测试通过；首次模拟路径分隔符失败与142 warnings记录保留，修正后check退出0恢复既有141 warnings，无新增诊断。真实DMG检查仍等待Mac runner；这些单元测试未作为实际签名验收。
文档入口、架构及历史评估中的旧Picot基线表述同步纠正，保留历史评估并说明来源修订。Windows未签名/macOS未公证和自动更新未启用明确展示。本机Python未安装mkdocs，未另装依赖，文档构建以GitHub Documentation结果补录。

## 2026-10-11：Intel第二辅助程序签名与定向重建

第三轮38106847988最终Windows/Linux全通过，ARM完成DMG上传后临时.app路径检查失败；Intel在完成产品门槛和正式编译后，主应用签名发现第二个未签名辅助程序e2ee_key，仍无Intel DMG。原失败v042-release-third-intel.log保留，不能将Intel误记为只有后置路径检查失败。
改为通过cargo metadata --no-deps --locked --offline枚举Studio包所有bin目标，排除主程序，先校验全部辅助程序架构再逐一签名/严格验证。本机实际元数据返回e2ee_key与zicode-relay，新增未来helper/缺目标/非法路径/两helper签名回归。
发布工作流增加显式all或macos-intel构建范围，默认四平台不变；定向构建仍执行该平台全部原检查和最终DMG/上传摘要验证，禁止自动发布。避免重建已经验过的Windows/Linux/ARM产物；最终公开仍须组合原产品/产物证据和新增Intel/最终DMG证据，五资产与应用标签保持一致。
42项相关测试通过，check退出0，既有141 warnings保持。应用标签未移动，没有本机重复编译或版本变更。新Intel定向构建仍待真实结果。
精确应用标签9c867b68的独立四平台38104114231报告已下载核对：每平台21步骤，合计84步骤0失败，仅格式advisory，source/runner/toolchain匹配且dirty=false。报告身份不再仅依赖版本字段修改前0768357d。

## 2026-10-11：主分支ARM测试生命周期补验

主分支59cc6f13的Developer platform38109574719：Windows/Linux/Intel成功，ARM的project-ui-gateways中131文件1002测试本身通过，但Notes测试环境销毁后残留自动保存计时器触发React，产生window is not defined未处理错误。原results与日志ci-38109574719-arm保留；没有将它算为全通过，也不改变已独立核对的标签9c867b68四平台证据。
仅修改notes.test.tsx的测试生命周期：追踪真实createNotesStore返回对象，afterEach先RTL cleanup再使用现有destroy取消计时器/订阅与操作scope；新增销毁后不再调用自动保存的回归。现有3900行文件仅局部增加29行，避免无关重构。没有修改应用/Host/Pi逻辑或任何期限。
本机149测试通过，类型检查与check退出0、既有141 warnings；主分支真实ARM重验仍待CI，不冒称已通过。正式应用标签与本机EXE保持9c867b68/0.4.2，Intel打包流程38109406813继续使用固定26ea9eae控制源码。

## 最终公开交付
发布时间：2026-10-11 04:24:44 +08:00。

[GitHub Release v0.4.2](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.4.2) 已公开，draft=false、prerelease=false，并设为 latest。

发布前组合证据检查通过：精确应用源码四平台报告、原 Windows/Linux 全门槛与上传摘要、
ARM 最终 DMG 收据、Intel 完整定向重建与最终 DMG/上传摘要全部一致；应用标签未移动。
保留原失败运行的真实状态，只补齐缺失验证与 Intel 产物，没有重建其他已完成平台。

公开后使用无认证 HTTP 客户端检查 Release 元数据和全部五个附件：均 HTTP 200、
下载响应大小与资产元数据一致。各 producer/DMG 的本地摘要与 GitHub SHA-256 对齐；
匿名检查只检查响应及大小，没有再次下载全部大型安装包。
| 公开附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| ZiCode.Studio.Desktop_0.4.2_aarch64.dmg | 76083685 | fafa22288f5f131ec8f57d3b5553fa1599c9768aa0c94f3ecf9e80e440d913e5 |
| ZiCode.Studio.Desktop_0.4.2_amd64.AppImage | 174631416 | 12920245a6438cfd5ce3cd5be5b3a552cd80d83a323e8cdf3e3e3ce491a065a4 |
| ZiCode.Studio.Desktop_0.4.2_amd64.deb | 105007506 | 8ba45e39056400bb6ae66e5ee8bb0f4ca24d875886a7c53363de817245dd2cad |
| ZiCode.Studio.Desktop_0.4.2_x64-setup.exe | 350392303 | c6e0357ae249935f3f370d1cf88b73c32a526de262b209d732d5274c84bc615b |
| ZiCode.Studio.Desktop_0.4.2_x64.dmg | 83107111 | 94f04c665a44d2cd4a907ccad1dd596ece95da261be96b3b8807ce1145619f52 |
