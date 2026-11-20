# Studio 本机交付与数据保留验收

2026-10-26：已构建并运行新版，本次托盘修复完成当前 Windows 实际验收。

## 使用入口与固定位置

- 继续使用 `D:\work\start-zicode-studio.cmd`。
- 当前运行程序：`D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe`。
- 版本仍为 0.5.3，本机修改通过构建日期和 SHA-256 标识；未发布正式安装包。
- 最终 EXE SHA-256：`9BAEFC292FAB549AC194B575D506E35F3EAE26419592FF29F5F59C5162B5BBDD`。
- 固定资料库：`D:\work\local-state\zicode-studio-desktop`。
- 本机目录选择：`C:\Users\ax2\AppData\Local\zicode\desktop-profile.json`。
- 原普通工作区：`C:\Users\ax2\.zicode`，其笔记仍在 `.zicode\notes` 子目录；已沿用原 ID 接回工作区列表，未搬走或覆盖原文件。
- 当前默认工作区笔记：`D:\work\local-state\zicode-studio-desktop\system\.zicode\notes`。
- 升级前备份：`D:\work\local-state\zicode-studio-desktop\retained-backups\before-tray-persistence-2026-10-26`。

资料位置独立于 EXE、安装目录和版本编号。新版不带参数启动与原启动脚本均沿用同一资料库；目录不可用时明确失败，不创建空替代资料库。显式隔离参数仍可用于独立测试。已经发布且不认识新目录选择文件的旧程序，须通过带相同目录参数的入口启动。源码的测试构建与正式构建共用路径逻辑；本次没有生成或验证正式安装包。

## 实际通过

| 项目 | 实际证据 |
| --- | --- |
| 托盘注册 | Windows `Shell_NotifyIconGetRect` 返回成功及有效图标矩形；最终正常启动仍有注册图标 |
| 中英文切换 | 真实前端语言事件同步至原生托盘；实际 Windows 菜单七项文字分别检查，中英文均通过 |
| 关闭后从启动入口恢复 | 连续三次关闭隐藏、恢复同一主进程与窗口；转发子进程在 30–169ms 内退出 |
| 关闭后从托盘恢复 | 连续三次通过实际托盘回调窗口发送点击消息恢复；不是物理鼠标操作声明 |
| 页面和输入保留 | 六次关闭恢复过程中，同一 WebView 标记、页面地址及实际输入框草稿均保留 |
| 最小化恢复 | 从启动入口恢复最小化窗口，通过 |
| 退出清理 | 正常事件循环退出后，原注册图标不再存在 |
| 原有笔记 | 真实 Host 读取成功，并在新版 React 笔记界面确认原笔记可见；12 个原文件 SHA-256 全部不变 |
| 修复后的笔记持久化 | 明确标记的自动化样本保存后逐字读取一致；重启后内容及版本校验值一致，包含中文、emoji 和末尾换行 |
| 日常启动 | 最终普通启动响应正常，临时调试端口 9227 关闭，12 个 DevTools 插件仍启用 |
| 定时任务 | 本会话唯一任务 `zidevtools-studio` 已删除；复查无本会话残留任务，其他会话任务未改动 |

主要证据文件同目录：`studio-local-delivery.json`、`studio-tray-normal-startup.json`、`studio-tray-menu-en.json`、`studio-tray-menu-zh.json`、`studio-window-launcher-final.json`、`studio-window-tray-final.json`、两份草稿保留报告、`studio-tray-exit.json`、`studio-original-note-ui.json`、`studio-previous-notes-after.json`、`studio-note-restart-final.json`、`studio-tray-final-console.json`。

## 修复内容与保留的失败

1. 保留并构建 tray-icon 0.23.1 的四处 `NOTIFYICONDATAW.cbSize` 回补，依赖版本保持不变，来源与许可证记录在 vendor 目录。
2. 首次新版仍报拒绝访问。实际令牌和文件 ACL 证明：构建目录给 EXE 继承了 Low 标签，进程因此以 Low 完整性运行，无法正常操作桌面托盘及原用户资料锁。交付 EXE 复制到固定运行目录后，仅将该 EXE 标签改为 Medium，实测进程为 8192（普通 Medium），并非管理员应用。源码和数据目录标签未改动。依据：[Windows 进程完整性规则](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)、[icacls 文档](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)。首次普通修改标签被 Windows 拒绝，之后单文件系统授权修复成功。
3. 新增可选、稳定的用户目录选择；未配置用户保持原规则。原工作区注册信息经备份后接回，未复制账号凭据。
4. 实例清理改为只清理完全空的目录树，任何文件或链接均保留，避免把没有聊天记录的其他资料当空目录。
5. 实际笔记验证发现既有序列化会把内容末尾换行当作格式分隔符去掉。修复为始终单独追加格式换行。新建、保存和重读保持正文换行；旧文件不自动改写。旧样本首次读取少一个换行的失败保留，只用其已知原文修复了明确标记的自动化样本，再完成保存/重启验证，不能把这说成旧序列化从未有问题。
6. 本地免安装构建不再下载仅供 NSIS 使用的 WebView2 安装器；正式安装包流程保持原要求。必需的 Bun 1.3.14 下载及校验通过。首次安装器无进度下载记录保留。
7. 首次窗口测试在转发子进程正常退出前立即计数，误报重复实例；确认最终仅一主进程后，将测试改为最多等待五秒的有界退出检查，实测只需 30–169ms。保留首轮失败记录，不以过滤掉进程来声称通过。

## 检查范围

- 最终本地构建成功；笔记相关测试 22 通过、1 原有忽略；最终 Rust 全目标检查及严格 Clippy 通过。
- 代码检查通过；既有 147 warnings、10 infos 和一项样式提醒仍记录在日志。
- 本轮完整 Rust 测试：合计 688 通过、10 失败、54 忽略。失败分别为五项备份目录权限、一项通知包身份、一项注册表权限、一项 Git 临时目录环境、两项符号链接特权。未宣称全仓测试全绿，也未用这些环境结果替代本次真实桌面验收。
- 签名、其他平台、付费模型和完整工具目录不在本次托盘交付声明中。
- 本机运行版为 debug 构建，使用当前源码工作区的前端与运行资源；不是独立可分发安装包。后续交付继续替换固定运行目录中的程序，保留资料库及目录选择文件，复制新 EXE 后确认其为普通 Medium 标签。

用户保存的数据不作为构建缓存清理。此约定防止版本切换造成资料分叉或清空，不等同于对磁盘硬件故障的永久保证。


## 2026-10-26 10:32 最新交付：十项失败清零及笔记逐字输入布局修复

覆盖上文旧的“10项测试失败”状态；本会话无定时任务，不恢复自动化。

- 全部编译后的 Rust 测试实际通过：700 passed / 0 failed / 54 原有 ignored，普通 Windows Medium 8192，两个测试线程。证据 ten-failures-full-rust/result.json。备份测试以独立子进程 profile 运行原断言，不再触碰用户备份目录；Git 负例屏蔽祖先仓库发现；无符号链接权限时以真实 junction 验证 reparse 拒绝。通知和 Explorer 注册在普通 Medium 环境原断言通过。新增 scripts/test-rust-windows.ps1 提供可复跑入口，无新增忽略或放宽限制。
- 实际构建并交付新版 0.5.3；EXE SHA256 B8C8A8A4E134E6398383751C6F4A96E64CB0F2A24FFD13E10BBC3FD26BEF8E3E。入口 D:\work\start-zicode-studio.cmd，实际程序 D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe。只替换现有程序，没有新建完整运行目录或 ZIP，没有强杀用户进程。
- 笔记原问题在真实 WebView 复现：编辑框最大上下跳动约78px，源于恢复面板的插入/移除及 pending 提示改变高度，未重建输入框。恢复行保持挂载，短暂写入信息收于展开区；错误继续外显；自动保存前后的关联提示预留稳定布局；工具栏防止文字被挤成竖排，保存状态预留宽度；补回图标丢失的共享尺寸类。
- 最终普通1441×901、窄640×800、长笔记末尾输入，每项约522帧：位置和高度各只有一个值、原编辑框节点不变、焦点和末尾光标保留、真实 Host 自动保存逐字一致、0界面异常、图标16×16且无水平溢出；长笔记继续输入时滚动位置恒定，Markdown预览正确。
- 四项新增回归加149项原笔记测试共153通过；check/typecheck通过，保留147 warning/10 info既有提示及终端bundle内联样式提示。Rust 静态严格检查此前通过，既有fmt advisory未批量修复；本次后续布局改动仅前端，不重复全仓Rust测试。
- 保护最新编辑：原先最后比对有3个笔记相关文件变化，发生在用户实际编辑期间；未回滚。这三份新文件另存 retained-backups/before-note-layout-2026-10-26，重新记录最新基线，最终26/26原有数据文件一致、SQLite integrity=ok、两工作区登记及固定选择文件一致。两个原工作区各1篇笔记实际可读；原笔记仍在 C:\Users\ax2\.zicode 原位置，固定配置仍 D:\work\local-state\zicode-studio-desktop。
- 最终普通启动 PID 40020，只保留一个实际程序，9227关闭、12个DevTools插件全部启用。再次真实关闭隐藏、启动脚本恢复、最小化恢复、托盘注册通过。此前真实中英文原生托盘菜单、六次窗口恢复、草稿保持和退出清理证据仍保留。

QA检查：页面标题/路由正确、非空、无框架错误层、console无异常、实际截图人工检查、逐字输入→草稿写入→自动保存交互通过。Browser插件不可用，沿用本任务已授权的真实WebView CDP自动化；不声明操作物理输入法或其他平台。

最终证据：notes-layout-delivery.json、notes-layout-after.json、notes-layout-after-narrow.json、notes-layout-after-long.json及同名PNG，notes-layout-data-final.json、notes-layout-normal-startup.json、notes-layout-normal-tray.json、notes-layout-normal-window.json、notes-layout-budget-after.json。构建日志 work/notes-layout-build-delivery.log，回归 work/notes-layout-tests-delivery.log。

保留首轮修复后高度仍变21px的真实失败 notes-layout-after-first-attempt.json/.png，以及更早 before 原始抖动；第二处修复消除该问题，没有删掉失败证据。NotesApp.tsx原大文件仅补一行图标class；其余逻辑在现有小组件和新专用测试中，未扩张大型编排文件。一次性修改脚本 notes-layout-fix.py、notes-relationship-layout-fix.py、notes-toolbar-icon-fix.py 和数据基线脚本不得重跑；需要重现时用新的独立测试profile和新的fixture ID。用户数据、凭据、冻结包及缓存保留。


## 2026-10-26 最新交付：七项界面简化（覆盖旧界面说明）

已构建并交付当前 Windows Studio 0.5.3，普通启动 PID 35452，EXE SHA256 25B90CE70A7D626DF9BA7A2819ED26C2E7A00AAB224AD36BB97CC7B47E9A0B5D。入口 D:\work\start-zicode-studio.cmd；仍用固定资料库 D:\work\local-state\zicode-studio-desktop，无新定时任务、发布或版本号变化。

1. 首页仅保留四个应用入口、快捷工具和输入区。八个快捷工具满配时，真实Windows WebView以1441×901、1000×600、640×800、640×600四个客户区尺寸验证均在输入区上方完整显示；通过CDP改变视口，未宣称四种原生OS窗口外框尺寸。矮窗口收起装饰说明并用四列，保留主要入口。
2. 收藏工具直接投射到首页、顶部快捷菜单、原生托盘右键子菜单，最多8个；点击重新向Host核对当前目录和权限，只打开具体工具，不自动执行。持久数据复用已有Host收藏，不复制配置或保存输入/凭据。原收藏为空，验收8个临时收藏已去除，当前默认工作区预置JSON格式化、Base64编码、二维码PNG、URL编码4项；时间戳当前无独立目录入口，未伪造该能力。收藏按既有工作区范围保存。
3. 主界面、首页、常规/模型设置移除场景选择与说明。内部原有隔离身份、配置和凭据边界保留，以兼容历史记录；未删除、合并或迁移旧scene目录。
4. 工具统一为可横向滚动的标签，标签右侧内置×关闭，超过3项不再切换为下拉框。实际测试两个工具切换仍保留草稿，取消关闭不丢输入，确认只关闭所选工具；运行中禁关闭的保护及原关闭确认保留。
5. 工具目录成为主入口；更多应用和问题排查放在底部默认收起，主界面不再区分“具体工具/完整应用”；残留中文搜索/打开文案也已修正。调用记录未删除，保留在问题排查区。
6. 桌面侧栏收起改为真实0宽并隐藏，避免旧负边距方式将工作区露在左侧图标栏下方。实际测得width=0/visibility=hidden；移动抽屉保持原行为，相关9项回归包含在228项内。
7. 移除问一问/做一做/想一想选择器及默认循环快捷键，只保留单一输入流程；历史偏好原值和其他配置保留，不再通过不可见选择器改变行为。

实际验收：首页打开具体工具、顶部打开另一个、两标签来回切换、草稿保留、取消/确认关闭均通过；打开流程0自动invoke，0界面异常。真实托盘从HMENU读取菜单项ID并通过所属窗口WM_COMMAND执行，核对精确JSON对比工具页已被选中；不是只检查标签，也不是直接在浏览器伪造菜单事件。英文Quick tools/Choose quick tools及中文切换通过。另从首页显式运行Base64编码，合成中文文本得到预期WmlDb2RlIOW/q+aNt+WFpeWPow==，真实Host/Worker结果可见。

验证：28个相关测试文件228项通过，新增Rust快捷菜单边界测试1项通过；cargo check全目标及严格Clippy通过，既有fmt漂移保留advisory。前端check/typecheck通过，i18n缺失0，全部50个原生命令权限接线通过。末次标点、名称省略和中文文案仅重新构建前端资源；debug程序按既有方式从仓库public读取，真实交付UI已验证，无需再做无关Rust构建。未把此前700项旧Rust结果冒充本轮全仓复测。

普通启动最终确认：9227关闭、单进程响应、真实关闭隐藏/脚本恢复/最小化恢复通过，12个DevTools包仍启用；新进程原生菜单中4项快捷工具存在，证明由鉴权WebView读取Host持久收藏后重新填充，无原生标签缓存文件。两个原工作区各1篇笔记可读；26个原有文件SHA逐一一致、工作区登记未变、SQLite完整性ok、固定选择文件未变。备份before-studio-simple-2026-10-26保留，未复制凭据；用户旧ZiDevTools进程未动。

实现位置：新CompactWelcome/QuickToolLinks/OpenToolTabs及quick-tools.js、studio-simple.css、desktop_tool_shortcuts.rs；大型入口app.js/main.rs只增加必要模块接线，ChatMessageList和SettingsPanelApp删除旧大块界面，保留其他并行改动。工具实现和兄弟仓库未改动。

证据在本会话outputs：studio-simple-delivery.json、studio-simple-home-live.json及四个PNG、studio-simple-delivered-home.png、studio-simple-delivered-quick-menu.png、studio-simple-tool-tabs.png、studio-simple-ui-live.json、studio-simple-tray-live.json、studio-simple-tray-en.json、studio-simple-defaults.json、studio-simple-execute-live.json、studio-simple-normal-startup.json、studio-simple-normal-tray.json、studio-simple-normal-window.json、studio-simple-data-final.json及预算扫描。预算UnknownEntries=0，缓存保留。

保留失败：640×600最初满配溢出截图已存first-attempt；旧界面断言随需求更新，未通过忽略掩盖。首次以Bun直接执行Vitest脚本的两个模拟加载差异，经仓库标准bun run vitest入口验证通过，旧失败日志保留。原生键盘消息初次误选最近目录，记录navigation-first-attempt已明确标为未验证；最终改用真实菜单ID，并核对具体工具页面。无调试token的普通脚本读取目录曾按预期被desktop_only拒绝，未放宽鉴权，改用新进程实际托盘投射证明持久化。

不得重跑一次性修改/数据备份脚本；临时8收藏fixture仅供本批证据，当前已替换为4项正式默认入口。后续继续用户新需求，不能按旧自动化/截止时间重建定时任务。

## 2026-10-26 继续打磨：快捷菜单键盘与故障恢复

已交付到当前 Windows Studio。复用上一轮可执行文件（0.5.3，SHA256 25B90CE70A7D626DF9BA7A2819ED26C2E7A00AAB224AD36BB97CC7B47E9A0B5D），本轮仅修改并构建前端资源，没有重复 Rust/完整应用构建。普通启动 PID 60180，入口仍为 D:\work\start-zicode-studio.cmd；9227 调试接口已关闭，单进程响应正常。

- 顶部快捷菜单补齐方向键循环选择、Home/End、Esc 关闭回到按钮、点击外部和 Tab 离开自动关闭。输入法组合键不被菜单接管；外部点击/焦点移动不抢回焦点；Esc 在菜单内部消费，避免误传到全局中止操作。工作区切换关闭菜单。专用 hook 维护监听器生命周期，未扩张大型入口。
- 读取收藏或点击时重新校验目录失败，首页/顶部显示明确重试提示，真实原生托盘也清除旧工具项，只留管理入口。重试重新读取 Host 原收藏，不改收藏或权限。切换工作区立即移除上一范围的入口，等待新目录；普通焦点刷新不清空有效内容，避免闪动。
- 异步请求以范围与序号校验，最后一次选择生效，销毁后不导航；原生菜单写入串行，旧写入不能覆盖恢复结果；管理入口异常被捕获。工具打开仍只展示，不自动执行。

验证：先保留真实 Windows 失败截图/回归，再修复。26 文件177项相关回归通过；后续补齐点击时校验失败分支，最终两个专项文件16项通过。前端 check 退出0（既有149 warnings/10 infos及生成终端样式 advisory 未新增处理），类型检查通过，中英文缺失0，React/CSS构建成功。未把旧 Rust 全仓结果计为本轮复测。

真实 Windows WebView：方向键、Home/End、Esc、外部鼠标、Tab 均通过；回车打开精确 Base64 工具，打开期间0次自动执行，随后显式执行合成文本“快捷工具键盘验证”，真实 Host/Worker 返回预期 5b+r5o235bel5YW36ZSu55uY6aqM6K+B。无运行时异常。另只用 CDP 阻断收藏目录请求，分别实测刷新失败和点击校验失败，真实 HMENU 从4工具+管理缩为仅管理；点击重试后四项原收藏与原生菜单全部恢复。仅请求故障为模拟，目录/Host/菜单及恢复路径是真实程序，不修改数据、不绕过鉴权。

普通启动新进程：原生托盘四项收藏重建，12个 DevTools 包启用，两原工作区各1篇笔记可读；26个原有数据文件 SHA 全部一致，工作区登记、固定资料库选择文件未变，SQLite integrity=ok。数据固定在 D:\work\local-state\zicode-studio-desktop，原笔记目录 C:\Users\ax2\.zicode 原位置保留，既有备份保留。无定时任务、发布、版本号调整、模型调用或兄弟仓库修改。

证据：本会话 outputs/quick-tools-followup-before.json/.png、after.json/.png、recovery.json、recovery-open.json、tray-failed.json、tray-recovered.json、enter.json/.png、normal-startup.json、normal-tray.json、data-final.json、budget-before.json、budget-after.json。检查、红绿回归和构建日志在 work/quick-tools-followup-*。存储扫描 UnknownEntries=0，预算正常，缓存保留。

保留验证脚本的首轮问题：Windows PowerShell 中文 UTF8 无BOM导致菜单标签匹配失败，已修正脚本编码；CDP回车缺少字符事件导致未触发默认按钮，补齐后实测通过；普通启动核对脚本继承HTTP代理而得到空503，实际本机服务健康，使用 NoProxy 直接核对已通过，normal-first-attempt.json 明确改为未通过的验证结果。没有为这些验证问题修改产品鉴权或网络安全设置。已有一次性安装/改写脚本与 normal.ps1 不得重跑；实时只读验收需要按当前进程和状态执行。

这是一批已验证的日常使用改进，持续优化目标仍在进行，不代表全部工具集成或整个产品已完成验收。


## 2026-10-26 交付：窄窗口遮罩与工具表单可用性

用户明确要求继续修复窄窗口遮罩，当前 Windows 已实际验证并交付。本轮为前端修改：构建 React 与 CSS 资源，复用已构建的 0.5.3 EXE；没有无关 Rust/完整原生重建、发布或版本号调整。普通启动最终 PID 50848，9227 调试接口关闭，入口仍 D:\work\start-zicode-studio.cmd，固定资料库仍 D:\work\local-state\zicode-studio-desktop。

真实问题与修复：
- 640×600 客户区从首页快捷工具打开 Base64，实际鼠标点输入框被 sidebar-overlay 拦截；侧栏 CSS 已为工具页隐藏，但打开工具又请求展开功能区，造成只有遮罩、没有侧栏。修复位于 public/ui/sidebar-toggle.js：依据侧栏实际 display 判断可用性；无侧栏时拒绝展开，切换页面立即清除旧遮罩并丢弃本层抽屉历史，不调用 Back；隐藏并禁用无用切换按钮。恢复其他页面会重新启用按钮；桌面已有侧栏展开偏好不被改写。旧 public/native/header.css 大文件只补一条 #sidebar-toggle[hidden] 隐藏规则，最小改动，未增加业务逻辑。
- 实际鼠标验证首页快捷工具、底部工具入口、笔记侧栏已展开后切换到工具三个入口，均无遮罩，输入区 elementFromPoint 命中且鼠标可聚焦；笔记侧栏仍正常展开。不是只看 DOM 属性或模拟 click 后宣称原生验证。
- 窄矮窗口的长文本默认输入区改为96px（沿用 control-height token）；640×600 常用单输入工具执行按钮从被底部导航覆盖的位置移到约498.7px底边，真实命中检测可点击。可继续手动拉伸和滚动，未截断输入。并非宣称所有复杂多字段工具一屏显示。
- 顺带完成此前同批精简：工具信息、说明、权限与备用工具界面入口收入默认折叠区；需要专用界面才能运行的工具仍直接显示唯一主操作，不藏起唯一可用入口。必填提示与标签同一行；运行提醒仅在执行中显示。“查看最近执行结果”移到执行按钮旁边，去除每次成功插在输入前造成的44px跳动。结果/返回输入为显式操作，不自动抢焦点，原输入保留。

验证范围：
- 170项工具相关回归通过，补充专用界面入口后 ManualToolDetail 9项复测通过；侧栏、插件导航、移动返回历史3文件53项回归通过。已有Open application调用测试随明确文案Open tool interface更新，覆盖旧目录版本/工作区失效与失败恢复，没有跳过测试。
- 前端 check退出0，类型检查通过，中英文覆盖缺失0。既有模板字符串、终端生成样式等advisory保留。无 Rust 修改，不冒充全仓 Rust 复测。
- 当前 Windows Studio 真实 WebView：1000×600 输入与执行按钮首屏可用，执行后输入位置308.714px保持不变；640×600最终输入与执行按钮均可命中、执行前后位置320.714px保持不变。通过CDP设置客户区视口，不宣称调整物理OS窗口外框或使用手机实机。
- 真实输入“工具布局验证”并显式调用 Base64，Host/Worker 返回预期5bel5YW35biD5bGA6aqM6K+B；查看结果、返回输入保留原文字，无运行时异常。另真实鼠标三条入口证据为tool-overlay-after.json/.png。工具页重建没有调用模型。
- 最终普通进程响应正常、单实例、12个DevTools启用、原生托盘4项收藏仍在。按真实API snapshot.notes读取并核对两原笔记ID存在；修正旧验收脚本错误读取顶层notes的路径（不能把@($null).Count=1当作证据），最终两个工作区各1篇且ID吻合。26个原有数据文件SHA逐一相同，工作区登记与固定目录选择文件未变，SQLite integrity=ok。原笔记目录及既有备份保持原位，未迁移、删除或复制凭据。未创建任何定时任务。

证据在本会话outputs：tool-overlay-before.json/.png、tool-overlay-after.json/.png、tool-usability-before.json、tool-usability-after.json、tool-usability-after-narrow.json及同名inputs/result截图；tool-overlay-normal-startup.json、normal-tray.json、data-final.json，tool-usability-budget-before/after.json。预算扫描UnknownEntries=0，现有缓存保留。

失败证据保留：首次窄窗几何断言虽为true，但截图发现遮罩，已在tool-usability-narrow-first-attempt.json明确否决；补实际鼠标和elementFromPoint检查。随后又发现底部导航覆盖执行按钮，保留tool-usability-narrow-bottom-nav-first-attempt.json，调整高度后完整验证通过。不得引用旧work/tool-usability-after-narrow.log的失败作为最后状态，最后运行结果以当前同名JSON及tool-overlay-after.json为准。一次性改写脚本不得重跑；正常启动验证脚本仅做只读检查。

本批修复已交付，持续优化项目的广泛目标保持进行中；不表示全部工具集成或所有平台验收完成。


## 2026-10-26 交付：二维码等内嵌PNG结果预览与下载

当前 Windows Studio 已更新结果界面：工具返回的有界内嵌PNG可直接显示图片、显示真实尺寸，并通过明确“下载PNG图片”链接导出原始PNG。原始编码默认折叠，仍可查看/选择字段/复制；原始响应、Studio保存完整结果和转交流程保留。只支持本轮已验证的内嵌静态PNG显示，未声称所有图片格式、URL图片或全部图片工具的新工作流已交付。

实现为独立inline-tool-image与ToolResultImage模块，ManualToolResultView仅接线；复用既有plugin-resource-image维度校验、静态图解码与4MP/4096边界，不复制解码逻辑、不访问远程地址或文件。识别文本上限1MiB，没有放宽Host的现有请求结果限额。拒绝MIME混淆、动画容器、非法Base64、尺寸不符和超限；失败只回退到可复制原文，不提供坏下载。预览解码为静态PNG，下载保持原图字节；新结果或关闭时释放对象URL，迟到解码不能覆盖新结果。没有自动下载。共享解析器新增类型声明后，SavedOutputs只移除一条已过期ts-expect-error；集中i18n字典仅补6条文案，无大型编排文件增长。

真实验证：原界面QR结果为含dataUrl的JSON，198×198、无img；当前Host/Worker实际生成“ZiCode 图像预览”的二维码，图片解码成功。用真实鼠标点击下载，到本会话专用验证目录得到12161字节PNG，逐字节与当前插件dataUrl解码值一致，SHA256 587316aafa1c0b1297dade8fbd5b931dce47847525354d93a6beff26dcb4d5e2。测试前自动下载0；通过Browser.setDownloadBehavior临时指定测试目录，结束恢复default，未改用户下载设置。1000×700与640×600真实WebView客户区验证图片完整、下载可命中、无侧栏遮罩、无运行时异常；未宣称物理OS外框调整或手机/其他平台验证。

检查：25个工具与图片相关文件168项通过；图片专项补齐原字节、加载错误和失败结果后6项通过；既有saved-outputs 7项通过。前端check退出0、类型检查通过、中英文缺失0、React/CSS构建成功。首次类型检查发现新增声明使旧ts-expect-error失效，已正确移除而未掩盖错误；首轮UI无图片的红色证据与失败测试日志保留。

交付：0.5.3复用现有本机构建EXE SHA256 25B90CE70A7D626DF9BA7A2819ED26C2E7A00AAB224AD36BB97CC7B47E9A0B5D，本轮只构建前端资源，没有无关Rust重建或安装包。普通启动PID43724，入口D:\work\start-zicode-studio.cmd，9227关闭、单进程响应、12个DevTools启用、4项托盘快捷工具存在。首次托盘观察未捕获菜单，核对同一PID仍响应后复查通过，没有以观察超时认定停止或重启进程。

两工作区实际snapshot.notes包含原笔记ID、各1篇；26个原有数据文件SHA全部一致，工作区登记和固定目录选择文件未变，SQLite integrity=ok。数据仍D:\work\local-state\zicode-studio-desktop，原目录与既有备份保持原位。无凭据复制、模型请求、定时任务、版本号调整、发布或兄弟仓库改动。资源文件选择、保存授权等边界保持原流程；下载仅由明确链接点击触发。

证据：本会话outputs/tool-image-result-before.json/.png、live.json、after.png、after-narrow.png、download/tool-result.png、normal-startup.json、normal-tray.json、data-final.json、budget-before/after.json。测试与检查日志在work/tool-image-result-*；存储扫描UnknownEntries=0，缓存保留。一次性修改脚本不得重跑。持续优化目标仍在进行，源工具覆盖统计未因展示改进上调。
