# 实现状态

## 2026-08-21 任务管理帮助文档与文案同步

- 任务应用升级为自包含管理产品后，帮助文档与任务中心文案仍停留在旧的
  “后台工作从自动化/收件箱汇聚”表述，未体现可直接新建/编辑/定时任务。
- 改动：
  - 中英帮助页 `projects-tasks.md` 新增「在任务中心创建与管理任务」小节：
    新建任务表单字段、手动/定时触发、定时模板卡片（计划/下次运行/编辑/
    暂停/删除）、「定时任务」筛选；
  - 任务中心头部说明改为“在这里创建与定时任务；自动化与收件箱任务汇入
    同一列表”，首次引导三步改为创建/编辑/管理；
  - 新增 4 组 i18n 键（中英）。
- 验证：i18n 覆盖 + 任务测试 33/33、全量 158 文件 / 1151 用例全绿；
  移动端实况 `task-mobile-qa.cjs` 通过——390×844 下任务表单正常渲染、
  无横向溢出、字段标签齐全（标题/说明/目标项目/触发方式/最大重试次数）、
  零控制台报错。bundle 与帮助页已同步安装目录。

## 2026-08-21 任务定时调度首开修复（load 就绪等待 + 失败快速重试）

- 实况验证发现：任务应用首次打开时，调度器的立即 tick 会先于首次
  `read_super_agent_tasks` 完成前执行（store 为空），且首次读取若因运行时
  尚未就绪失败，下一次 tick 要等整个调度周期（60s）——到期的定时任务
  首开最多延迟 60 秒才生成实例。
- 修复（`frontend/src/features/tasks/store.ts`）：
  - `load()` 改为并发等待：进行中的加载由 `inFlightLoad` 共享，轮询与
    调度器启动并发调用时后者等待前者完成，而不是跳过；
  - 新增 `loadedOnce` 状态；`tick()` 在数据未加载时先 `await load()`，
    若加载失败（如 UnknownInstance）则安排 2s 重试再走调度，不再空跑；
  - `stopScheduler`/`destroy` 清理重试定时器。
- 验证：新增「首次加载失败后重试并生成实例」单测，任务测试 29/29、
  全量 158 文件 / 1151 用例全绿、typecheck 通过；实况
  `task-scheduler-qa.cjs` 通过——种入到期模板 → 打开任务应用约 3 秒内
  生成实例（scheduledFrom 指向模板、pending、autoDispatch 按审批设置）并
  推进 nextRunAt，文件监视确认写入与清理；`task-manage-qa.cjs` 复跑通过。
  期间发现的无头环境 28s 运行时就绪抖动为环境因素，非代码缺陷。

## 2026-08-21 任务应用升级为自包含的任务管理产品

- 用户反馈：任务与智能收件箱/对话耦合、不好用；所有任务管理都应放进
  任务应用，能新建任务并修改标题、说明、触发方式和时间；应用间可打通
  但用户视角应相对独立。
- 实现（任务中心自成闭环，无需进收件箱/自动化面板）：
  - 数据模型：`SuperAgentTask` 增加 `schedule`（manual/interval/daily）、
    `intervalMinutes`、`dailyTime`、`nextRunAt`、`enabled`、
    `requireApproval`、`scheduledFrom` 字段；`normalizeSuperAgentTask`
    展开保留，持久化安全。
  - Store：`createTask(draft)`（手动任务直接 pending+autoDispatch；定时
    任务建为模板，autoDispatch=false 等待首次触发）、
    `updateTaskMeta(id, patch)`（改标题/说明/目标/触发方式/时间/审批，
    自动重算 nextRunAt）、`tick()` 任务级调度器（到期为模板生成无 schedule
    的新实例，推进 nextRunAt，实例按 requireApproval 决定自动派发）。
  - UI：任务中心头部「新建任务」按钮 + 表单（标题/说明/目标项目/触发方式/
    间隔或时间/每次运行前审批/最大重试）；定时任务卡片显示「定时」徽标、
    计划与下次运行，支持编辑/暂停定时/删除；一次性任务卡片支持「编辑」。
    新增「定时任务」筛选；运行中/失败等计数排除模板。
  - 调度器随任务应用挂载启动（renderContent startScheduler，
    deactivate/destroy 停止），与自动化调度器互不干扰。
- 验证：任务单测 28/28（新增创建/编辑/调度 6 项）、全量 158 文件 /
  1150 用例全绿、typecheck 通过、i18n 覆盖全绿；实况
  `task-manage-qa.cjs` 通过——新建每日定时任务 → 卡片「定时」徽标 +
  下次运行 + 编辑 → 改标题保存 → 页面零报错 → 精确清理；tasks.json
  恢复 5 条无残留。bundle 与 CSS 已同步安装目录（57620 端口确认）。

## 2026-08-21 失败任务通知修正（不再误报“任务已完成”）

- 真实缺陷：派发任务完成时，桌面/应用内通知的标题只区分 needs_input 与
  「Task completed」，且 badge 恒为 success——零产出失败（上一项修复后
  标记 failed）的任务会弹“任务已完成”成功通知，与事实相反。
- 修复（`public/native/app.js`）：
  - 完成处理中捕获 `finalFailReason`；failed 时标题用「任务失败」、
    通知类型 error、badge tone danger，消息附失败原因；
  - needs_input 保持「任务需要输入」，正常完成保持「任务已完成」。
- 验证：i18n 键「Task failed」已有中文译文；全量 158 文件 / 1144 用例
  全绿、app.js Biome 干净；已同步安装目录（57620 端口返回新 bundle）。
- 全链路 live 回归（`run-all-live.cjs`）6/6 通过：task-center、task-loop
  （派发→完成→摘要）、ask-answer（提问→needs_input→回答→完成）、
  scheduler（到期建任务）、rerun（再次运行→新 pending）、util-apps
  （剪贴板/翻译）；QA 数据已清理（tasks 5 条无 qa- 前缀、workflows 2 个、
  剪贴板清 0）。

## 2026-08-21 每日博客定时任务真实运行验证（睡眠唤醒补触发 + 两轮结果）

- 时间驱动验证完成：08-21 09:00 的「每日技术博客文章生成」定时任务在
  09:54:06 被调度器创建、09:54:09 绑定子会话，无 `getSelectedSceneId`
  或任何 ReferenceError——派发修复在真实定时链路中彻底验证通过。
- 延迟根因排查：09:00 未准时触发并非调度器/定时器节流缺陷。Windows
  Kernel-Power 事件确认电脑自 08-20 21:38 进入睡眠，08-21 09:54:04 才
  唤醒。唤醒后 5 秒内调度器即完成补触发——`isDue` + nextRunAt 的追赶
  逻辑正确。09:54:05 的 relay DNS 告警是唤醒后网络恢复的瞬时现象。
- 第一轮（09:54 派发，自动）结果异常：唤醒后模型网关尚不可达，4 次
  调用全部 `502 model_gateway_unreachable`，子会话零产出却被标记为
  done（摘要为通用“项目代理已结束”），工作流历史记录成 completed。
- 第二轮（10:02 手动「再次运行」）**成功**：10:12 完成，产出 3 篇文章
  （20260821-aliexpress-webaudio-fingerprinting / rust-arrayref-supply-chain /
  github-aug17-outage），每篇含 index.html + images/cover.png，摘要完整、
  来源真实可核验（HN Algolia API + 原文抓取，ID 均已核实），无敏感信息。

## 2026-08-21 零产出运行误判为成功的修复

- 承接上一轮发现：子会话因模型网关不可达（网络未就绪）全报错结束时，
  完成判定没有错误感知——`message_end` 只捕获正常文本作摘要，零产出时
  落到通用文案并标 done，用户看到“成功”却没有文章，调度器也不会重试。
- 修复（`public/native/app.js`）：
  - 新增 `dispatchedErrors` 映射：`message_end` 时从 assistant 消息的
    `errorMessage` 字段按子实例记录运行错误；
  - `completeDispatchedTask` 在「无 completionMessage/summary 且有记录
    错误」时用 `markTaskFinished(status:"failed", failReason)` 标记失败，
    模型网关类错误映射为友好中文「模型服务不可用，本轮未产出内容，请
    重试。」，其余保留原始错误串；
  - 任务标记失败后，自动化 reconcileRuns 的自动重试（retryCount <
    maxRetries）可接管，用户侧也有「再次运行/重试并运行」入口。
- 验证：新增 markTaskFinished failed 状态单测；task-state/i18n 覆盖/
  本地化契约 26 项、全量 158 文件 / 1144 用例全绿、typecheck 通过；
  app.js + i18n.js 已同步安装目录（运行实例 57620 端口返回新 bundle）。

## 2026-08-21 自动化启用后的 QA 覆盖补齐

- Automation 恢复默认启用后，`qa-a11y` 与 `qa-locale` 的视图清单仍缺
  automation（console 清单已有）。两处各补
  `["automation", "?app=com.zicode.automation"]` 条目。
- 复核全绿：控制台扫描 15/15、无障碍 15/15（桌面）+ automation 移动
  视口 390×844 1/1、双语 locale 15/15（含 automation）、数据呈现 5/5
  （articles UI 456 = API 456、notes/artifacts/tasks/finance 一致）。

## 2026-08-20 Automation 恢复默认启用后的加载守卫补位

- 背景：上一项把 Automation 翻为默认启用后，文档此前标注的「Automation
  存在同类潜在竞态，启用前再补守卫」变为现实义务。复核 `store.ts`：
  其 `load()` 只有 loading 互斥，无序号守卫——早到的 403/unknown instance
  失败若晚返回会覆盖成功状态；且调度器在应用启动即 tick 加载，若运行时
  尚未就绪，首次打开自动化中心会显示错误横幅直到 60s 后的下一次 tick。
- 改动（`frontend/src/features/automation/store.ts`）：
  - `load()` 增加 `loadSeq` 序号守卫：过期请求的结果（成功或失败）一律
    丢弃，与习惯/网页监控/知识图谱/剪贴板/文章创作一致；
  - 失败且匹配运行时就绪类错误（unknown_instance / UnknownInstance /
    runtime unavailable / not ready / 403）时，按 1.2s→2s→3s→5s→8s→12s
    退避自动重试（与任务中心同款），首次打开自愈，不再等下一次 tick；
  - `destroy()` 清理重试定时器，防止切场景后残留触发。
- 验证：新增 2 项 store 单测（退避重试收敛、过期失败不覆盖新结果）；
  自动化测试 15/15、全量 158 文件 / 1143 用例全绿，typecheck 通过，
  改动文件 Biome 干净（全仓 109 条既有 warning 与此无关）；automation
  bundle 已重建并同步安装目录；无头 UI 复测自动化/文章创作渲染正常、
  零控制台报错。

## 2026-08-20 Tasks 与 Automation 恢复默认启用（使用闭环已完备）

- 背景：08-19 因「缺少后台 Host Runner」将 Tasks/Automation 默认禁用；08-20
  已把任务中心（派发/恢复/完成/通知）与自动化调度（到期建任务/审批/系统
  通知/再次运行）全部闭环并真实验收，但 Rust `builtin_manifests()` 与前端
  `plugin-registry.js` 的默认值仍是 false——全新场景/新安装会看不到这两个
  核心应用。同时发现运行实例 registry.json 里 Articles 也被改回 false
  （尽管 02:21 的 `27dc2e2b` 已恢复默认启用），文章创作入口被隐藏。
- 改动：
  - `src-tauri/src/plugin_registry.rs` 与 `public/native/plugins/plugin-registry.js`：
    Tasks、Automation `enabled_by_default` 均翻为 true（Projects 仍 false，
    无项目 CRUD）；同步更新 Rust 注册表测试与前端注册表测试断言。
  - 中英帮助页 `projects-tasks.md`：改为「任务与自动化已启用；仅项目需在
    管理插件中启用」。
  - 运行实例编程场景经 `/v2/plugins/enablement` 启用 Automation 与
    Articles（Tasks 本就启用），registry.json 已持久化。
- 验证：
  - 前端全量 158 文件 / 1141 用例全绿（含 plugin-registry 断言）；
    Rust `plugin_registry` 12/12 全绿。
  - 无头 UI 实测（`.qa-shots/plugin-enable-qa.cjs`）：活动栏出现
    「自动化/文章创作/任务」；Automation 主视图列出 2 个工作流（含每日
    博客）、Articles 主视图列出已有文章；页面零控制台报错。
- 部署：release 重建（`target/release/zicode-studio-desktop.exe`
  47,872,512 B，21:21:59），按「运行中 exe 改名 `.prev` + 复制新版」暂存，
  下次重启后新装场景/全新安装默认启用 Tasks/Automation；安装目录
  plugin-registry.js 与帮助页已同步（刷新即生效）。旧 `.prev`
  （08-20 02:20 残留）已移到 `%TEMP%`，重启确认稳定后删除 `.prev` 即可。

## 2026-08-20 晚间复核：任务派发修复在线 + 端到端回归通过

- 用户复测「每日技术博客文章生成」运行仍报 `getSelectedSceneId is not
  defined`，对修复状态做运行态复核。结论：修复已生效，无新失败。
  证据链：
  1. 安装目录与仓库的 `public/native/app.js`（19:28）一致，均含
     `getSelectedSceneId` 导入；运行实例（PID 69204，20:23 启动）在
     57620 端口提供的 `/native/app.js` 同样含导入，webview 内存为修复后
     bundle。
  2. 任务数据（agent-inbox tasks.json）：08-20 01:00 UTC 定时任务连败 3
     次（修复前）；06:10 UTC（14:10 +08）手动重跑成功，14:41 完成并出
     3 篇文章摘要，failReason 为空；此后无任何新失败事件。
  3. 端到端回归（`.qa-shots/dispatch-qa.cjs`）：先修正脚本——此前用固定
     旧会话打开任务中心无法渲染卡片导致误报，改为 `/v2/new-session` 创建
     全新会话并轮询卡片渲染。当前实例实测：注入临时 pending 任务 → 点击
     「批准并运行」→ 任务进入 running、绑定子会话（01a01f36）→ 页面零
     报错（无 ReferenceError）→ 子代理按指令回复 OK 正常结束。
- 清理：临时任务已移除，tasks.json 恢复 3 条 done；workflows.json 不变
  （2 个工作流，每日博客 enabled、daily 09:00、nextRunAt=08-21 01:00
  UTC）；剪贴板 QA 残留清 0。
- 遗留：明早 09:00 定时任务为最终时间驱动验证；若失败先查
  `%LOCALAPPDATA%\zicode\logs\` 与 agent-inbox tasks.json。

## 2026-08-20 收件箱面板「再次运行」与任务中心一致

- 一致性补齐：任务中心已完成/已取消/失败的自动化任务有「再次运行」；
  Agent Inbox 面板此前只有「查看会话/重试并运行」。现在面板的已完成
  （带 workflowId）与失败自动化任务也显示「再次运行」（失败任务在
  「重试并运行 + 忽略」下方另起一行），派发 `sa-rerun-workflow` 重新
  排队一轮全新任务；需要输入/阻塞任务仍以回复为主。
- 新增面板单测（done + failed 两类均显示并派发事件）；全量
  `bun run test`、typecheck、Biome 通过；组件已同步安装目录；桌面端已
  重启（PID 69204，`/health` ok）。

## 2026-08-20 任务中心「清空已完成」

- 批量操作补齐：收件箱面板有「Clear Done」，任务中心此前只能逐条「忽略」。
  现在任务中心头部在存在已完成任务时显示「清空已完成」按钮（带数量确认
  "清空 N 条已完成任务？"），一键移除全部 done 任务；运行中/其他状态
  任务不受影响。新增单测覆盖按钮出现、确认文案、只删 done。
- 全量 `bun run test`、typecheck、Biome 通过；tasks bundle 与 i18n 已同步
  安装目录；桌面端已重启（PID 80420，`/health` ok）。

## 2026-08-20 任务中心摘要卡可点击筛选

- 交互改进：顶部摘要卡（运行中/需要输入/失败/已完成）此前只是静态计数，
  现在点击即可切换对应筛选视图（按钮语义、aria-label、悬停/聚焦样式），
  减少"看到计数→再找筛选页"的往返。新增单测（点击失败卡只显示失败
  任务）。
- 全量 `bun run test`、typecheck、Biome 通过；tasks bundle 与
  task-center CSS（含 style.bundle.css）已同步安装目录；桌面端已重启
  （PID 22644，`/health` ok）。

## 2026-08-20 「再次运行」扩展到失败的自动化任务

- 恢复路径补充：失败且达到自动重试上限的自动化任务，除「重试并运行」
  （需确认、重派同一任务）外，现在也显示「再次运行」（按原工作流全新
  排队一轮），给用户一条无需受重试上限约束的恢复路径。单测覆盖
  done + failed 两类自动化任务均显示并派发事件。
- 全量 `bun run test`、typecheck、Biome 通过；tasks bundle 已同步安装
  目录；桌面端已重启（PID 68860，`/health` ok）。

## 2026-08-20 任务中心「再次运行」：已完成自动化任务一键重新排队

- 缺口：帮助文档承诺已完成任务可"再次运行"，但任务中心卡片只有
  「忽略」，没有重新运行入口——用户要重跑每日博客任务只能去禁用的自动化
  面板或等下一次定时。
- 实现：
  - `AutomationAppApi` 暴露 `runWorkflow`；app.js 新增
    `sa-rerun-workflow` 监听（按 workflowId 从工作流列表找到定义 →
    手动重新排队，生成一条全新任务而非复活旧任务）；
  - 任务中心对已完成/已取消且带 `automation.workflowId` 的任务显示
    「再次运行」按钮；`SuperAgentTask` 类型补充 `automation` 字段。
- 验证：新增单测（带 workflowId 的已完成任务显示并派发事件）；live
  回归 `rerun-live.cjs` 通过——种入临时工作流 + 已完成任务 → 点击「再次
  运行」→ 生成新 pending 任务（trigger=manual）→ 精确清理。
- 全量 `bun run test`（54/54）、typecheck、Biome 通过；tasks/automation
  bundle 与 app.js/i18n.js 已同步安装目录；桌面端已重启（PID 69280，
  `/health` ok）。

## 2026-08-20 帮助文档补齐遗漏的键盘效率快捷键

- 可发现性：快捷键文档此前缺 Ctrl+M（切换模型）、Ctrl+T（循环思考
  强度）、Ctrl+1~9（切换应用）、笔记编辑器的 Ctrl+E / Ctrl+Shift+D /
  Ctrl+Shift+C / Ctrl+D / Ctrl+Enter（带入对话）等高频快捷键。中英文
  快捷键页均已补齐并同步安装目录，帮助中心打开时即时生效（无需重启）。

## 2026-08-20 需要审批的自动化触发时也弹 Windows 系统通知

- 延伸：桌面系统通知此前只覆盖任务完成/需要输入；现在「每次运行前要求
  批准」的自动化到期时，除应用内 toast 外也会弹系统通知（标题 + 工作流
  名），用户不在应用前也能看到待审批项。
- 实现：automation store 增加 `notifySystem` 回调（tick 审批分支调用），
  app.js 传入 `notifyDesktop`；新增单测断言审批 tick 会调用系统通知。
- 全量 `bun run test`、typecheck、Biome 通过；automation bundle 与 app.js
  已同步安装目录；桌面端已重启（PID 64380，`/health` ok）。

## 2026-08-20 需要审批的定时工作流不再"只记历史不建任务"

- 真实缺口：调度器 tick 对 `requireApproval` 的到期工作流只调用
  `record_run`（写一条 approval_required 历史），从不创建任务——任务中心
  永远等不到可批准的审批任务，与帮助文档"到期后任务停在需要批准状态"
  不符。
- 修复：tick 对到期工作流统一走 `enqueue`（创建 pending 任务 +
  autoDispatch=false + 记录 queued 历史），需要审批时额外弹「自动化需要
  审批」通知。非审批路径行为不变（enqueue + autoDispatch=true，运行时
  面板自动派发）。
- 验证：新增单测（tick 对需审批到期工作流写入 autoDispatch=false 的
  pending 任务）；`.qa-shots/scheduler-live.cjs` 端到端通过——种入到期
  审批工作流 → 调度器 tick 生成任务（trigger=schedule、status=pending）→
  nextRunAt 推进、approvalPending=false → 精确清理。
- 全量 `bun run test`、typecheck、Biome 通过；automation bundle 已重建
  并同步安装目录；桌面端已重启（PID 58852，`/health` ok）。

## 2026-08-20 桌面系统通知（任务完成/需要输入时弹 Windows 通知）

- 场景：窗口最小化或切到其它应用时，派发任务完成/需要输入只有应用内
  toast，看不到。现在任务进入终态（完成）或需要输入时，额外调用
  `notify-rust` 弹 Windows 系统通知（标题 + 摘要），桌面端真实生效，
  非 Tauri 环境（远程浏览器）自动跳过。
- 实现：
  - Rust：新增 `send_desktop_notification` Tauri 命令（notify-rust，
    锁定 4.11.4 以兼容 rustc 1.88），在独立线程 best-effort 弹出，
    失败仅记日志；
  - 权限：`permissions/default.toml` 声明 `allow-send-desktop-notification`
    并加入 [default] 集合（tauri 权限检查 25 命令全绿）；
  - 前端：`completeDispatchedTask` 完成/需要输入通知后调用
    `notifyDesktop`（`__TAURI__.core.invoke` 守卫）。
- 验证：`cargo test` 247 通过（含桌面通知后端冒烟测试，本机 `show()`
  成功）；`cargo clippy`、`cargo build --release`、`bun run test`、
  typecheck、Biome 全绿；release EXE 已部署到安装目录并重启（PID 42964，
  `/health` ok）。

## 2026-08-20 收件箱面板重试上限确认守卫

- 一致性补齐：任务中心的「重试并运行」在达到自动重试上限时会先弹确认
  框；Agent Inbox 面板的新「重试并运行」此前没有该守卫，可能静默越过
  上限。现在面板同样在 `retryCount >= maxRetries` 时先确认再派发。
- 新增面板单测（取消确认时不写入、不派发）；全量 `bun run test`
  （52/52）、typecheck、Biome 通过；组件已同步安装目录；桌面端已重启
  （PID 43540，`/health` ok）。

## 2026-08-20 帮助中心补齐已启用应用文档（16 → 21 篇）

- 可发现性缺口：帮助中心此前只有 16 篇，证件照、图片工具、剪贴板收件箱、
  文档导入、翻译这 5 个已启用应用没有专属页面，新用户难以在帮助里找到
  用法。
- 新增「工具应用」分区与 5 篇页面（中英双语各一份，manifest 同步）：
  证件照（模板/混合排版/裁剪换底/打印输出）、图片工具（缩放/格式/旋转/
  拼接）、剪贴板收件箱（先收集后整理/发送到笔记）、文档导入（PDF/DOCX
  → Markdown/保存到笔记本）、翻译（自动检测/交换语言/复制下载）。
- 帮助中心每次打开都会重新拉取 manifest（无本地缓存），新页面即时生效；
  已同步安装目录并确认线上返回 21 篇（zh/en 一致），help 视图渲染
  「21 篇文章」无回归。

## 2026-08-20 智能收件箱面板失败任务一键「重试并运行」

- 一致性补齐：任务中心已有「重试并运行」，但 Agent Inbox 运行时面板对
  失败/阻塞任务只有普通「Retry」（直接重新派发，不重置重试计数与失败
  原因）。现在面板失败/阻塞且绑定目标项目的任务卡片显示「重试并运行」
  主按钮，走与任务中心相同的语义：重试计数 +1、清空失败原因、标记派发
  并发起 `sa-dispatch`；需要输入任务保留普通重试（回复框为主操作）。
- 新增面板单测覆盖一键重试派发（计数/状态/事件）；全量 `bun run test`
  （51/51）、typecheck、Biome 通过；组件已同步安装目录；桌面端已重启
  （PID 77020，`/health` ok）。

## 2026-08-20 智能收件箱「提问 → 回答」闭环打通（needs_input 全链路）

- 缺口：此前没有任何机制把派发任务推进到 needs_input——代理提示词要求
  "需要澄清时提问并等待"，但应用侧不检测、代理侧无标记工具，回复框
  永远等不到自然出现的 needs_input 任务。帮助文档承诺的"代理提问 → 你
  回答"闭环实际不可达。
- 修复（app.js + task-state）：
  - 新增 `looksLikeQuestion` 保守启发式（≤240 字符且以 ?/？ 结尾的最终
    回复视为提问），派发子运行时完成事件（agent_end/agent_settled）若
    最终回复是提问，则标记 needs_input 而非完成，回复框随即可用；
  - 任务中心 `answerTask` 发送 prompt 时补上 idempotencyKey（此前被
    RuntimeGateway 以 "Runtime mutation prompt requires idempotencyKey"
    拒绝，回复从未真正送达子代理）；
  - 完成处理加并发守卫：agent_end 与紧随的 agent_settled 是两个并发
    async 调用，若不做同步"认领"，尾随的 settled 会用过期摘要把回答后的
    任务错误改回 needs_input 或提前完成；
  - needs_input 时保留 dispatch 映射（仅终态删除），用户回答后的新一轮
    message_end 摘要捕获与最终完成才能正常工作。
- 验证：`.qa-shots/ask-answer-live.cjs` 端到端全绿——代理提问（任务变
  needs_input，回复框出现）→ 用户在任务中心输入并发送回答 → 代理继续 →
  任务完成，摘要为代理真实回复（如"已确认：输出目录使用 A…"），无页面
  报错、数据精确清理。`.qa-shots/task-loop-live.cjs` 同步复跑通过。
- 全量 `bun run test`（50/50）、typecheck、Biome 通过；app.js /
  task-state.js / i18n.js 已同步安装目录；桌面端已重启（PID 50340，
  `/health` ok）。

## 2026-08-20 任务闭环收尾：结果摘要捕获 + 首开重试退避

- 摘要丢失修复：`message_end` 处理里用量记账（`recordDispatchedTaskUsage`，
  内部有一次 config 读写）排在摘要捕获之前，该调用一旦瞬时失败
  （如 UnknownInstance）会抛错并跳过摘要捕获，导致任务完成卡片显示通用
  文案而非代理的真实回复。现在先捕获最终 assistant 文本作为摘要，用量
  记账移到其后并捕获异常（非致命）。
- 首开稳定性：任务中心 store 对 runtime 未就绪（unknown_instance /
  UnknownInstance / runtime unavailable）的自动重试从单次 1.2s 改为带
  退避的多重重试（1.2s→2s→3s→5s→8s→12s，成功后清零），慢启动/冷启动
  场景不再需要用户手动点「重试」。
- 验证：`.qa-shots/task-loop-live.cjs` 端到端全绿——批准并运行 → 真实
  派发 → 子代理回复 → `agent_end`/`agent_settled` 到达 → 任务自动完成，
  且完成摘要为子代理真实回复（"OK"），无 failReason、无页面报错、临时
  任务精确清理。新增多重退避单测；全量 `bun run test`、typecheck、Biome
  通过；app.js 与 tasks bundle 已同步安装目录；桌面端已重启（PID 32860，
  `/health` ok）。

## 2026-08-20 派发任务完成事件断流根因修复（session_bound 后重订阅）

- 端到端 live 复现（`.qa-shots/task-loop-live.cjs`）：任务中心「批准并
  运行」→ 真实派发 → 子代理回复 OK，但任务一直停留在 running。抓
  websocket 帧后发现：子运行时的 `message_end` 到了，而 `agent_end` /
  `agent_settled` 始终不到。
- 根因：host 只把运行时事件转发给 target 完全匹配的订阅。派发时订阅的
  是临时 sessionId（temporary-xxx）；子运行时会话绑定后 sessionId 升级
  为持久 id，后续事件（含 agent_end/agent_settled）与旧订阅不再匹配，
  被 host 过滤掉——任务因此永远卡在 running（桌面端每日博客任务同样是
  这个原因，之前 agent_settled 自愈也救不回来，因为事件根本没到）。
- 修复：`bindDispatchedChildSession` 在绑定持久 sessionId 后，用新
  sessionId 对同一 instance 重新 `adapter.subscribeTarget`（记录原始
  dispatch target 于 `dispatchedTargets`，完成后清理）。完成后事件恢复
  送达，任务自动标记 done 并弹通知。
- 验证：重跑 task-loop-live 全绿——帧中出现 `agent_end` / `agent_settled`
  （各 3 次），任务 pending → running → done（`completed:done`、无
  failReason、finishedAt 有值），临时任务精确清理、页面零报错。
- 全量 `bun run test`、typecheck、Biome 通过；app.js 已同步安装目录；
  桌面端已重启（PID 68848，`/health` ok）。

## 2026-08-20 任务中心首开自动重试 + 帮助文档补全 + live 验证解锁

- 问题：新建会话后首次打开任务中心，store 的初始加载偶发与 runtime 就绪
  竞争，直接报 `UnknownInstance`，界面显示「无法加载任务」直到用户手动
  点「重试」。
- 修复：任务中心 store 对 `unknown_instance / UnknownInstance /
  runtime unavailable` 类失败自动延迟 1.2s 重试一次（仅一次，避免抖动），
  新会话首开不再需要人工干预；新增单测覆盖。
- 帮助文档补全（public/help）：`projects-tasks.md` 增加「回答代理的
  问题」「一键重试并运行」章节并更新任务状态表；`inbox.md` 的日常使用
  增加「回答」与一键重试条目。已同步安装目录并确认线上服务返回新内容。
- QA 基础设施突破：此前无头 Chrome 对任务中心的验证一直被
  `UnknownInstance` 挡住（无头客户端无法访问桌面端持有的会话 runtime）。
  现在先调 `POST /v2/new-session` 给无头客户端分配专属临时 runtime，
  再导航到该会话，`__picotConfigCall` 即可正常读写任务。新增
  `.qa-shots/task-center-live.cjs` live 巡检并通过：
  - 需要输入任务渲染回复框 + 「发送回复」，且「重试」为次级样式；
  - 失败任务渲染「重试并运行」主按钮；
  - 首开错误状态自动恢复（无手动点击）；
  - 清理写入校验（`write.ok`）防止 QA 数据残留。
- 全量 `bun run test`（48/48）、typecheck、Biome 通过；tasks bundle 已
  重建并同步安装目录。

## 2026-08-20 任务闭环细节打磨

- 完成判定抽成纯函数 `shouldCompleteDispatchedRun(type, willRetry)` 并加
  单测：`agent_end` 仅在 `willRetry !== true` 时完成，`agent_settled`
  始终视为可完成信号（调用方再用任务状态守卫），防止自动重试场景提前
  完成。
- 需要输入（needs_input）任务卡片的按钮层级修正：「发送回复」是主操作，
  「重试」降为次级样式，避免用户误把重试当主路径（重试会丢弃待回答的
  问题重新派发）。
- 全量 `bun run test`（47/47）、typecheck、Biome 通过；tasks bundle 与
  app.js / task-state.js 已同步安装目录；桌面端已重启（PID 72824，
  `/health` ok）。

## 2026-08-20 派发任务完成态自愈（agent_settled + 持久化兜底）

- 真机验证暴露问题：「每日技术博客文章生成」子代理在 14:23 完成全部工作
  （3 篇文章 + 封面 + 完成汇报），但任务一直停留在 running——完成标记
  只依赖 `agent_end` 事件，一旦该事件未送达/内存映射丢失，任务就永久
  “运行中”。
- 修复：
  - `agent_end` 仅在 `willRetry !== true` 时视为最终完成（避免提前把
    自动重试中的任务标成完成）；
  - `agent_settled`（整轮运行彻底结束、无自动延续）同样触发完成标记，
    任务已为 needs_input/blocked 时跳过；
  - 完成与 `session_bound` 绑定都增加持久化兜底：从任务记录按
    `dispatch.childInstanceId` 反查归属任务（新增
    `findDispatchedTaskByInstanceId`，webview 中途重载也不丢）。
- 当前卡住的任务已按子会话真实结果手工对账为完成（summary 含 3 篇文章
  标题）；桌面端已重启加载修复（PID 70780，`/health` ok）。
- 新增单测覆盖按 childInstanceId 反查与失败兜底；全量 `bun run test`
  （46/46）、typecheck、Biome 通过；app.js / task-state.js 已同步安装
  目录。

## 2026-08-20 失败任务一键「重试并运行」

- 此前失败/阻塞任务要两步才能重新跑：先「重试」（回到待运行），再
  「批准并运行」（派发给项目代理）。对每天都会用到的定时任务（如
  「每日技术博客文章生成」）来说太绕。
- 现在失败/阻塞且绑定了目标项目的任务卡片只显示一个主按钮
  「重试并运行」：一次点击完成计数+1、清空失败原因、标记派发并发起
  `sa-dispatch`，直接进入 running。未绑定目标项目的任务保留原「重试」
  语义；达到自动重试上限时仍先弹确认框。
- 新增 store 动作 `retryAndRunTask`（与 `approveTask` 同一条派发路径）
  及中英文案；新增 2 个单测覆盖一键重试派发与无项目时保留普通重试。
- 全量 `bun run test`（45/45）、typecheck、Biome 通过；tasks bundle 与
  i18n 已同步安装目录（下次重载/重启桌面端生效）。

## 2026-08-20 任务派发修复运行态复核（getSelectedSceneId）

- 用户复测反馈「每日技术博客文章生成」运行仍报 `getSelectedSceneId is
  not defined`。复核结论：修复代码与安装目录在 13:46 已同步，但桌面实例
  是当天 4:24 启动的，webview 内存中仍是旧 bundle，点「运行」走的是
  旧 `sa-dispatch` 处理器，因此报错复现。
- 验证 1（静态）：`settings-import-contract.test.js` 契约测试通过，
  全量 `bun run test` 43/43、typecheck、Biome 均绿。
- 验证 2（服务端）：127.0.0.1:57620 返回的 `native/app.js` 已含
  `getSelectedSceneId` 导入及调用点。
- 验证 3（端到端）：新增 `.qa-shots/dispatch-qa.cjs` 回归脚本——向任务
  中心注入一条临时 pending 任务，模拟用户点击「批准并运行」，任务进入
  running、绑定子会话 id、failReason 为空、页面零报错；测试任务已精确
  清理（不触碰真实博客任务）。
- 处置：桌面实例已重启（新 PID，`/health` ok、pi 0.84.2），现在运行在
  修复后的 bundle 上。明早 09:00 定时任务与手动重试均走修复路径。
- 遗留：应用内回复 needs_input 任务的闭环（上一项工作）单测全绿、
  bundle 已同步；无头环境复核回复框时受会话 runtime 绑定限制
  （`Runtime request rejected: UnknownInstance`），属环境约束而非代码
  问题，待桌面端人工确认。

## 2026-08-20 运行态复核（提交 7488c46b）

- 实例稳定（内存约 299 MB）、`/health` ok、pi 0.84.2、main 与 origin
  同步。所有已交付改动均在运行实例生效。
- 待外部验证（时间驱动）：明早 09:00 每日定时任务真实端到端运行。

## 2026-08-20 任务卡片详情悬停显示全文

- 任务卡片的项目路径等长文本在窄屏按省略号截断，但截断后无法查看
  全文。详情项 `<dd>` 增加 `title`，悬停显示完整值（桌面）——移动端
  仍以截断为主避免换行混乱。
- tasks bundle 已同步安装目录；单测与全量门禁通过。

## 2026-08-20 手机访问二维码弹窗支持复制链接

- 「在手机上打开」弹窗此前只有「打开链接」，没有复制入口；手机浏览器
  访问时需要把地址发到手机。新增「复制链接」按钮（复制后短暂显示
  「已复制」），地址栏与按钮在同一处。
- 实测：弹窗打开后「复制链接」可见、地址正确（relay 公网 URL）；
  新增组件单测；全量 `bun run test`、typecheck、Biome 通过；
  lan-qr bundle 与 i18n 已同步安装目录。

## 2026-08-20 命令面板补上「文件」入口

- 键盘用户此前无法用命令直接打开文件浏览器（命令面板只有新建会话/
  切换工作区/压缩/工具/设置/帮助）。现在命令面板加入「📁 文件 打开
  文件浏览器」（执行后回到对话并展开文件面板）；顺带 `/files` 斜杠
  命令可用（走同一 `open_files` 动作）。
- 排查中发现命令面板用的是内联命令数组而非 loadCommands 目录，最初的
  修改加错了位置，已修正并实测：面板出现该命令、执行后文件面板打开。
- 全量 `bun run test`、typecheck、Biome 通过；app.js 已同步安装目录。

## 2026-08-20 任务完成通知直达工作区

- 派发任务完成通知此前只有「打开任务」动作。现在若任务有目标项目且
  该项目存在会话（派发子会话即在其中），按钮变为「打开工作区」：直接
  跳到目标项目最近会话，生成的产物一步可达；无会话时回退「打开任务」。
- 路径匹配做了规范化（去掉 `\\?\` 前缀、统一斜杠、忽略末尾分隔符），
  与侧栏会话的 projectPath 对齐；控制台回归干净，全量
  `bun run test`、typecheck、Biome 通过；app.js 已同步安装目录。

## 2026-08-20 插件验收与版本核对（当前构建）

- `plugin-acceptance` 6/6 通过（启用插件真实交互：剪贴板、文档导入、
  笔记采集等），插件壳移动菜单改动无插件层回归。
- pi 版本核对：最新仍为 v0.84.2（2026-08-14 发布），无更新可做。

## 2026-08-20 移动端「更多」菜单补上文件入口

- 插件壳此前把 `core.files` 从移动端溢出菜单中过滤掉，文件只能靠顶栏
  按钮（上一轮新增）进入。现在「更多」菜单也保留该入口（仅在对话处于
  激活态时出现），与顶栏按钮形成双入口，手机上更容易发现。
- 实测（390）：更多菜单含「文件」，点击后文件抽屉打开
  （display:flex）；插件壳单测 28 项通过；全量 `bun run test`、
  typecheck、Biome 通过；plugin-shell 已同步安装目录。

## 2026-08-20 运行态健康检查（今日全部改动后）

- 实例 PID 49340 持续运行，内存约 258 MB，稳定；日志无新增错误（仅
  8-19/8-20 中继瞬时 DNS 抖动记录，已自愈）；`/health` 正常、公网中继
  在线；main 与 origin 同步。
- 今日累计改动全部生效于运行实例：任务中心（重试/忽略/复制/截断）、
  收件箱错误文案、移动端文件入口、设置实时轮询与更新入口、工作区栏等。
- 待外部验证：明早 09:00 每日定时任务端到端运行（代码路径与单测已验证）。

## 2026-08-20 任务结果摘要可复制 + 桌面回归补测

- 任务卡片的完成摘要（如每日文章任务列出的文章路径）此前只能看，无法
  复制。新增摘要行内复制按钮（点击后短暂显示「已复制」），方便把路径
  拿去别处使用。
- 补测：桌面端无障碍 13/13、桌面端双语 13/13 全绿；新增复制单测。
  全量 `bun run test`、typecheck、Biome 通过；tasks bundle 与样式已
  同步安装目录。

## 2026-08-20 任务中心支持移除已完成/失败/已取消任务

- 任务中心此前无法删除终态任务（已完成/失败/已取消），列表随每日任务
  无限累积；智能收件箱面板有「忽略」但任务中心没有。新增 `removeTask`
  动作与终态卡片上的「忽略」按钮（悬停提示「从列表中移除该任务」），
  运行中/等待中任务仍只能暂停/取消，不受影响。
- 实测：3 张卡均显示「忽略」，失败卡同时有「重试 + 忽略」；新增单测
  覆盖移除（写入列表过滤后不含该任务）。全量 `bun run test`、typecheck、
  Biome 通过；tasks bundle 与 i18n 已同步安装目录。
- 顺带复核：任务中心当前正常渲染 3 张卡（2 已完成 + 1 失败），计数与
  筛选正确；此前一次无头探测显示 0 卡为会话重定向抖动，非回归。

## 2026-08-20 智能收件箱面板错误文案统一（共享映射）

- 任务中心与自动化历史此前已显示友好错误文案，但智能收件箱运行时面板的
  失败卡片仍直接展示原始 JS 报错（如 `getSelectedSceneId is not defined`）。
- 把 `friendlyTaskDispatchError` 抽成公共模块 `public/super-agent/
  friendly-errors.js`，面板失败卡片与 app.js 派发失败通知统一走该映射；
  实测面板显示「任务派发失败：程序内部错误，请重试。」，无原始标识符。
- 新增面板单测覆盖友好文案渲染；全量 `bun run test`、typecheck、Biome
  通过；组件与 app.js 已同步安装目录。

## 2026-08-20 移动端补上文件浏览入口

- 此前文件浏览器的切换按钮在顶栏右侧（`.header-right`），移动端整个
  右侧被隐藏，手机上没有任何入口打开文件侧栏——不符合「所有功能移动端
  可用」的要求。现在移动端顶栏左侧（汉堡菜单旁）新增文件按钮
  （`data-file-toggle`），与桌面按钮共用同一开合逻辑；桌面端该按钮保持
  隐藏。
- 实测（390）：按钮可见，点击后文件抽屉打开（display:flex、文件列表
  加载），普通会话正常、智能收件箱会话按既有设计隐藏；桌面 1440 按钮
  隐藏。全量 `bun run test`、typecheck、Biome 通过；index.html /
  app.js / 样式已同步安装目录。

## 2026-08-20 任务卡片长描述截断 + 展开/收起

- 自动化任务的卡片会把整段提示词（可超千字）完整铺开，任务列表被撑得
  很高。现在描述默认截断为 4 行（CSS clamp），长于 180 字符时显示
  「显示更多 / 显示更少」切换按钮，悬停 title 保留全文。
- 实测：长描述卡片 clamp=4 + 「显示更多」，点击后切换为「显示更少」；
  新增单测覆盖展开/收起；全量 `bun run test`、typecheck、Biome 通过；
  tasks bundle 与 style.bundle.css 已同步安装目录。

## 2026-08-20 手动安装版更新入口修正

- 桌面为手动安装版，仓库没有 GitHub Releases 通道：此前设置页点「检查
  更新」会打开 `/releases`（实测 404），指向无效页面。现在改为打开项目
  主页（README 正常展示），并把中文提示改为「请关注项目主页获取新版本」。
- 更新对应单测（断言新 URL 与语义），全量 `bun run test`、typecheck、
  Biome 通过；settings bundle 与 i18n 已同步安装目录。

## 2026-08-20 远程访问状态实时刷新（设置页轮询）

- 设置 → 远程访问页此前只在打开/切回/手动刷新时加载状态，中继掉线或
  设备断开期间若一直停留在该页，徽标不会更新。现在页面打开期间每 15s
  静默轮询（`load({ quiet: true })`，不触发加载闪烁；页面隐藏时跳过），
  「经服务器 已连接/已断开」与设备列表保持实时。
- 版本核对：pi 已是最新 v0.84.2（pi-mono 最新发布 2026-08-14，无更新）；
  桌面为手动安装版（无 GitHub release 通道，设置页有对应提示）。
- 设置单测 25 项通过，全量 `bun run test`、typecheck、Biome 通过；
  settings bundle 已同步安装目录。

## 2026-08-20 中继与任务链路运行态复核（无代码改动）

- 日志中的 relay DNS 解析错误（8-19 15:13、8-20 01:58）为瞬时抖动：
  当前 `/health` 正常、`https://relay.zicode.com/d/dev-ax2-01/health`
  公网路径实测 200、DNS 解析正常；设置 → 远程访问页有实时「经服务器
  已连接/已断开」徽标，手机端在失联时显示「桌面离线」，掉线自愈链路
  完整。
- 任务中心运行态复核：3 张任务卡片（2 已完成 + 1 失败）与汇总计数正常
  （`qa-data-presence` 报告的 0 为脚本时序误报）；智能收件箱运行时面板
  在页面常驻并全局轮询（隐藏时 `display:none` 不断开连接），定时任务
  的 autoDispatch 在任何会话下都生效；配合 `agent_end` 完成标记与通知，
  每日定时任务链路（调度 → 派发 → 完成/失败 → 通知）代码路径全部验证。

## 2026-08-20 收件箱欢迎卡补齐快捷键提示 + 数据/无障碍复验

- 智能收件箱欢迎卡补上与通用欢迎页一致的快捷键提示行（`/` 聚焦输入、
  Esc 中止、Ctrl+Shift+P 命令、Ctrl+K 搜索会话），键盘用户在新手卡
  上同样可发现快捷键。
- 复验：数据呈现 5/5、移动端无障碍 14/14；此前已确认禁用插件直达有
  「插件未启用 → 打开插件管理器」引导（含单测）、智能收件箱运行时面板
  在非收件箱会话被 CSS 隐藏（`body:not(.super-agent-active)`）——
  「任务面板出现在对话页」的旧问题确认为已闭环。
- 全量 `bun run test`、typecheck、Biome 通过；chat bundle 已同步安装
  目录。

## 2026-08-20 智能收件箱欢迎文案与实际结果落点对齐

- 收件箱欢迎卡此前承诺「结果回到这段对话」，但派发任务的完成结果实际
  落在智能收件箱面板与任务中心（会话本身不追加消息）。把文案改为
  「结果回到智能收件箱面板和任务中心」，与真实行为一致，避免误导新手。
- 同步验证：键盘回归 14/14、笔记交互回归 pass、侧栏右键功能均有
  「…」按钮移动端替代、通知「打开任务」动作已接任务应用；全量
  `bun run test`、typecheck、Biome 通过；bundle 已同步安装目录。

## 2026-08-20 自动化/任务历史文案本地化补漏

- 自动化任务的事件与运行历史此前混有未翻译的英文：
  `Queued by automation (schedule).`（store 直接拼接字符串，未走 t()）、
  智能收件箱面板手动取消的 `Manually cancelled from Runtime panel.`。
- 修复：投递事件改用 `t()` 并补充中英文案（手动/定时两类）；
  面板取消原因走 t()。任务中心、智能收件箱面板、自动化运行历史统一
  显示中文。
- 验证：i18n 覆盖率、自动化/任务单测、全量 `bun run test`、typecheck、
  Biome 通过；bundle 与运行组件已同步安装目录。

## 2026-08-20 任务失败通知 + 帮助文档同步

- 派发失败此前只在任务中心静默记录（用户需自己发现）。现在
  `dispatchSuperAgentTaskNative` 增加 `onDispatchError` 回调：失败时
  弹出「任务失败」通知（任务名 + 原因；内部 JS 错误映射为友好文案），
  带「打开任务」动作并点亮任务徽标（红色）。
- 帮助文档同步：项目/任务/自动化页补充「派发任务完成自动标记 + 通知、
  失败可重试」说明（中英文）。
- 新增单测覆盖 `onDispatchError` 回调（派发失败时收到 task + error）；
  控制台回归 14/14 干净；全量 `bun run test`、typecheck、Biome 通过；
  已同步安装目录。

## 2026-08-20 派发任务完成闭环（自动标记完成 + 通知）

- 发现缺口：派发到项目代理的任务，子会话结束后从未被标记为完成（只有
  失败/预算超限/手动取消会写状态），任务会一直停在「运行中」；用户也
  收不到结果反馈（此前需要自己进任务中心翻）。
- 现在 `agent_end`（派发的子运行时结束）时：把归属任务标记为完成，摘要
  取子会话最后一条助手消息（无摘要时用通用文案「项目代理已结束，请打开
  子会话查看详情。」）；弹出「任务已完成」通知（任务名 + 摘要截断），
  带「打开任务」动作，并点亮任务应用徽标。仅在任务仍处于运行/等待状态
  时落完成标记，避免覆盖失败/取消结果。
- 验证：新增 i18n 键通过覆盖率测试；控制台回归 14/14 干净（应用模块
  正常加载）；全量 `bun run test`、typecheck、Biome 通过；已同步安装
  目录。真实派发运行后的端到端通知需等下一次定时任务或手动批准验证。

## 2026-08-20 远程/移动端工作区栏常显

- 工作区栏此前依赖 Tauri `list_workspaces`，在 LAN/移动端浏览器客户端
  （无 Tauri invoke）会连同「切换工作区」按钮一起整块隐藏，导致用户
  看不到当前工作区——对应此前「对话时显示的 ax2 是什么？工作区没有
  明显显示」的反馈。
- 现在无 Tauri 时只隐藏切换按钮，工作区标签保持可见：名称 + 完整路径 +
  悬停提示；路径来源由 app.js 从会话列表按 workspaceId 解析（会话列表
  到达时刷新）。桌面 Tauri 路径行为不变。
- 实测（headless，无 Tauri）：标签 display:flex，显示
  `agent-inbox` 与完整路径，切换按钮隐藏；新增单测覆盖无 Tauri 分支
  的标签解析；全量 `bun run test`、typecheck、Biome 通过；已同步安装
  目录。

## 2026-08-20 任务超限后仍可手动重试

- 此前任务自动重试次数用尽（如 2/2）后，任务卡片的「重试」按钮会被
  隐藏，失败任务只能等下一次调度，用户无法在修复后手动重跑。现在
  failed/blocked/needs_input 任务始终显示「重试」；已超限时按钮降级为
  次要样式，点击前弹确认「已超过自动重试上限，仍要手动重试此任务吗？」，
  确认后任务回到待派发状态。
- 实测：任务中心那条 08-20 失败任务（retryCount 2/2）现显示重试按钮 +
  超限确认提示；新增单测覆盖「超限仍可手动重试」与取消分支；全量
  `bun run test`、typecheck、Biome 通过；bundle 已同步安装目录。

## 2026-08-20 任务派发失败文案友好化

- 承接 `getSelectedSceneId` 修复：任务中心/自动化历史此前会把原始 JS
  错误串（如 `getSelectedSceneId is not defined`）直接展示给用户，费解
  且无恢复提示。新增 `friendlyTaskDispatchError`（`shared/hostErrors.ts`）：
  把 ReferenceError/TypeError/SyntaxError 等客户端内部错误映射为
  「任务派发失败：程序内部错误，请重试。」，其余可读信息保持原样。
- 任务卡片与运行历史均应用该映射；原始技术细节保留在元素 `title`
  悬停提示和持久化数据中，便于排查。中英文案走共享 i18n。
- 实测：任务中心那条 08-20 失败任务现显示友好文案 + 原始报错 tooltip；
  新增单测覆盖映射与卡片渲染；全量 `bun run test`、typecheck、Biome
  通过；bundle 已同步安装目录。

## 2026-08-20 任务派发 ReferenceError 修复（getSelectedSceneId 未导入）

- 用户实测：任务中心的「每日技术博客文章生成」运行时报
  `getSelectedSceneId is not defined`。定位：`public/native/app.js` 的
  `sa-dispatch` 处理器调用 `spawnSessionViaHost(workspaceId,
  getSelectedSceneId(), hostFetch)`，但文件顶部从未导入该函数（settings
  构建产物 `settings.js` 实际有导出，纯属缺 import），任务批准派发路径一
  走到就抛未绑定标识符错误。
- 修复：在 `app.js` 的 `./react/settings.js` 导入中补上
  `getSelectedSceneId`；安装目录已同步，控制台回归 14/14 干净（若导入
  仍缺，应用模块会在启动阶段直接失败）。
- 新增静态契约测试 `public/native/settings-import-contract.test.js`：
  校验 app.js / workspace-actions.js 从 settings 构建产物导入的每个
  命名导出都真实存在、且用到 `getSelectedSceneId` 的位置都有对应导入，
  防止此类「调用未导入」的引用错误再次漏过（此前 QA 未覆盖任务派发路径）。
- 全量 `bun run test`、typecheck、Biome 通过。

## 2026-08-20 智能收件箱新手引导（空会话欢迎页）

- 针对此前「智能收件箱是个很奇怪的东西」的反馈：Agent Inbox 会话在
  空状态时不再显示通用欢迎页，改为专用的新手引导卡片——一句话说明
  （飞书/企业微信消息 → 待办任务 → 你批准 → 项目代理在本机执行 →
  结果回传）、流程标签、「三步开始」步骤，以及三个直达按钮：
  「配置智能收件箱」（打开设置 → 智能收件箱标签页）、「打开任务中心」、
  「了解智能收件箱」（帮助中心 inbox 页）。
- 实现要点：`ChatMessageList` 的欢迎组件按工作区路径（或运行时
  `super-agent-active` 信号）区分收件箱会话；`app.js` 在 `renderHistory`
  及会话列表到达时把工作区路径传入 `renderWelcome`（此前新会话因不在
  列表里无法命中按会话 id 的检测，已补按工作区 id 解析）。修复过程中
  定位到 `renderWelcome` 参数形态问题（对象 vs 裸字符串）导致路径丢失。
- 验证：新会话端到端实测欢迎卡片渲染（流程 5 项、步骤 3 项、按钮 3 个），
  「配置智能收件箱」点击后 hash 变为 `#/settings/chat` 且激活
  「智能收件箱」标签页；i18n 覆盖率测试（新增 key 均为纯英文，中文只在
  zh 译文）与全量 `bun run test`、typecheck、Biome 通过；bundle 已同步
  安装目录。

## 2026-08-20 窄屏断点边界审计与笔记大纲滚动修复

- 修正 `visual-qa` 的「更多」菜单覆盖缺口：此前只在 `<700px` 触发移动
  菜单检查，而移动壳在 `max-width: 768px` 即生效，700–768px 整段未被
  回归覆盖。现改为 `<=768px`，并在 700/768 实测菜单可开（13 个应用项、
  `aria-expanded` 正确）。此前「700px 点击更多无效」的结论是 QA 用了
  错误选择器（`[role=menu]`，而移动菜单是 `role="dialog"`）造成的误报。
- 修复笔记在窄屏打开即把顶部工具栏卷出/压到页头下的真实缺陷：预览模式
  的大纲跟随逻辑在窄屏（大纲为文章下方的静态区块）对 `scrollIntoView`
  无差别执行，导致主视图被滚到文章底部（实测 scrollTop 603/930，工具栏
  top -535/-862）。修复为仅在大纲面板自身可独立滚动（桌面 sticky 形态）
  时才跟随；700/390 打开笔记后 scrollTop 保持 0、工具栏完整显示在页头
  下方（top 68 > header 64），桌面 1440 行为不变。
- 700/768 全应用边界扫描：所有应用无横向溢出、无启动失败、顶部裁切标记
  归零；键盘审计 14/14 干净；`qa-notes-flow` 交互回归（含拖拽、选中文字
  代入对话、标签过滤）pass。
- 门禁全绿：`bun run test`（vitest + Tauri 权限 + 子进程策略）、typecheck、
  Biome。修复后的 React bundle 已同步安装目录并在运行实例实测生效。

## 2026-08-20 金融场景守卫 CTA 实测可用

- 在非金融场景打开金融工作台：守卫文案完整（「金融工作台需要金融场景…
  数据、凭据、工具和模拟账本按场景隔离」），点击「选择金融场景」打开
  设置面板并聚焦场景选择器（`#/settings/general`）——新手恢复路径
  「守卫 → 一键到场景选择」实测闭环。

## 2026-08-20 移动 PWA 表面静态验证

- manifest.json 有效：standalone 显示、theme_color、4 个图标（含
  maskable 512）；service-worker.js（9.7 KB）存在，注册点在
  `mobile-pwa-lifecycle.js`（远程客户端，`updateViaCache: none`），
  移动端更新检查逻辑完整。PWA 安装/离线表面在静态层验证通过
  （真机安装走查仍属外部项）。

## 2026-08-20 四个完整插件真实验收 9/9

- 临时启用 OCR/习惯/网页监控（知识图谱）后跑 `plugin-acceptance`：
  验收 **9/9 全过**——OCR 真实识别测试图「ZiCode QA 123」、习惯与网页
  监控走真实添加/列表 CRUD 流程（含测试数据清理）、原 6 项照常通过。
  验证后恢复默认禁用（11 启用 + 6 禁用，场景状态复原）。
- 至此四个「完整但默认关闭」插件在 UI 加载、后端、真实交互三层都通过
  验收，用户随时可启用。

## 2026-08-20 错误边界回退样式

- 为 `plugin-crash-fallback` 补设计系统样式：消息与「重试」按钮同行、
  与上方 header 留出间距（复用 ui-card 卡片外观）。Biome 通过，已同步
  安装目录。

## 2026-08-20 插件视图错误边界与 vendor React 约束

- 此前插件视图渲染抛错会留下空白表面，无提示、无恢复动作。现在
  `mountPluginSurface` 为所有插件应用包上 React 错误边界：崩溃时显示
  「此视图遇到了意外错误。」+ 「重试」按钮，重试重新渲染（应用自身
  store 错误 UI 可接管）；新增单测覆盖崩溃回退与重试恢复，全量测试、
  typecheck、Biome 通过，控制台 14/14 确认应用正常启动。
- 关键约束（已写入 `reactMount.tsx` 注释）：自研 React vendor bundle
  仅以 default 导出完整 React 对象，命名导出不含 `Component`——类组件
  必须用 default 导入的 `React.Component` 定义（本轮曾因此导致全应用
  启动失败，已定位修复）。

## 2026-08-20 用量区间切换与移动双语审计

- 实测用量面板区间切换：点 90d 后 `aria-pressed` 正确更新（7d/30d 复位、
  90d 选中），交互正常。
- `qa-locale` 增加 `VIEWPORT` 支持（与 console/a11y 一致），移动端
  390×844 双语审计 14/14 零泄漏、语言实时切换验证通过——双语审计
  桌面/移动全覆盖；Biome 通过。

## 2026-08-20 模型选择流程端到端验证

- Ctrl+M 打开模型下拉，列出 8 个真实模型（sonnet/deepseek-v4-flash/
  v4-pro/gemini/glm/gpt-4o/gpt-4o-mini/kimi，含定价）；选择 deepseek-
  v4-pro 后模型按钮即时更新，且选择持久化到会话（全新档案加载同一
  会话时已显示所选模型）。验证后已将 QA 会话模型恢复为
  deepseek-v4-flash。

## 2026-08-20 全局快捷键实测与键盘审计增强

- 实测帮助页声明的全局快捷键：Ctrl+Shift+P 命令面板、Ctrl+M 模型下拉、
  Ctrl+T 思考切换、Ctrl+Shift+N 新会话均正常；Ctrl+Shift+O 工作区
  切换器依赖 Tauri invoke 桥（无头 Chrome 无此桥、按钮隐藏），真实
  窗口的 bench-desktop-ui 已验证可用。
- `qa-keyboard` 常驻审计新增 Ctrl+Shift+P 与 Ctrl+M 探测，14/14 全绿；
  Biome 通过。

## 2026-08-20 设置标签页与当前构建回归确认

- 实测「智能收件箱」与「配置」设置标签页正常渲染（无启动失败、含各自
  内容），补齐此前未单独验证的两处设置面。
- lint 清理与 articles 重建后复跑控制台 14/14 干净，当前构建无回归。

## 2026-08-20 远程访问「经服务器」开关实测可用

- 设置 → 远程访问的「经服务器中继远程访问」开关此前仅确认存在，本轮
  实测切换：关闭后 relay 指示消失（`data-relay-state` 由 connected 变为
  无），重新打开后恢复 connected 并重连中继——端到端可用，与最初
  优先级清单第 ③ 项一致。

## 2026-08-20 lint 警告清理（可安全项清零）

- 清理 Biome 可安全修复的警告：useTemplate 7 处（bundle-css/qa-notes-flow/
  qa-session-sidebar 的字符串拼接改模板字面量）、useConst 1 处、
  noNonNullAssertion 1 处（Articles 删除按钮改为 `if (current)` 守卫）、
  noUnusedVariables 1 处（qa-a11y 移除未用 map）、noDocumentCookie 2 处
  （remote-auth 设备令牌 cookie 写入属有意行为，补说明性 ignore）。
- 剩余 noDescendingSpecificity 18 处为 CSS 特异性顺序提示：style.bundle.css
  是生成产物不可手改，源码重排存在视觉回归风险，且当前视觉 QA 全绿，
  故保留并记录为有意状态。
- 验证：i18n 覆盖 4 项、全量 `bun run test`、qa-notes-flow/qa-session-sidebar/
  qa-a11y 复跑全部通过；产物已同步安装目录。

## 2026-08-20 清理死路由（launcher）

- 排查发现 `launcher` 路由是死代码：`parseAppRoute`/`appRoutePath` 支持
  它，但应用内无任何入口导航过去，且 app.js 启动即要求会话路由（直达
  launcher 会渲染启动失败屏）。工作区切换由原生侧解析/创建会话，实际
  不存在「无会话工作区」的用户可见状态。
- 清理：从 router 移除 launcher 分支（解析与构建），更新对应测试
  （改为仅断言 session 往返）。90 项路由/布局测试、Biome 全绿；控制台
  14/14 复扫干净；已同步安装目录。

## 2026-08-20 pi 0.84.2 升级后全量回归

- 升级后重跑完整电池：视觉 28 视图零失败、控制台 14/14、键盘 14/14、
  双语 14/14、数据呈现 5/5、交互抽查（笔记全流程、网页采集）通过。
- 用量面板验证 0.84.2 修复生效：真实累积数据正常渲染（总费用 $0.31、
  会话 15、总 Token 859 万、glm-5.2/deepseek-v4-flash/v4-pro 三模型
  分布、工具费用明细），设置页显示 Pi 版本 0.84.2。

## 2026-08-20 pi 运行时升级至 0.84.2

- 按用户「有新版就更新」的偏好跟进 pi 更新：0.84.1 → 0.84.2（2026-08-14
  发布）。相关修复直接惠及桌面端：流式 `message_update` 用量累积丢失、
  DeepSeek 输出限制字段、上游缓冲失败自动重试、`sendMessage` 队列语义、
  系统提示词拼接、nanoid DoS 漏洞等；新增可配置默认工具与全屏转录搜索
  （后者偏 TUI，桌面端暂不暴露）。
- 流程：更新 `scripts/pi-version.json` 锁与 SHA-256 → `fetch:pi` 拉取
  并校验新二进制（pi-windows-x64.zip，SHA 验证通过）→ RPC 冒烟 6 命令
  通过 → 重建 release（exe 47,813,632 B，04:23）→ 同步安装目录 pi 资源
  树与 exe → 重启激活（PID 49340）。
- 验证：`/health` 显示 `piVersion 0.84.2`；真实模型调用核心链路桌面/
  移动双视口通过（发送→回复）；控制台 14/14 干净；启动日志无错误
  （清理 3 个废弃空实例）；新增 0.84.2 RPC 契约夹具（与 0.83.0/0.84.1
  同模式）。

## 2026-08-20 真实窗口交互性能基准

- 通过 WebView2 调试参数（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`）首次
  在真实桌面窗口上跑通 `bench-desktop-ui`：会话切换渲染 110ms、笔记树
  打开 2ms、笔记打开 121ms、命令面板打开 25ms、会话搜索 227ms——全部
  远低于产品成功指标（长操作 <15s、查找旧结果 <20s），交互性能优秀。
- 测后已恢复正常启动（去掉调试参数，CDP 端口关闭），`/health` 200、
  中继在线，运行实例 PID 75292。

## 2026-08-20 实例健康与回归确认

- 运行实例（PID 46356）内存 126 MB，6 个 pi 运行时（各 186–232 MB）
  对应工作区各会话，数量稳定无累积；日志自重启（18:57 UTC）起零
  ERROR/WARN/panic。临时会话回收器保持待命：重启后仅 1 个临时会话，
  无超龄可回收项，属设计内行为。
- 本轮四插件引导卡改动（app.js/i18n/产物）后复跑：控制台 14/14、
  数据呈现 5/5 全绿，启用应用无回归。

## 2026-08-20 四个完整插件的首次引导卡

- 给「完整但默认关闭」的 OCR/习惯/网页监控/知识图谱补 `FirstRunGuide`
  （此前它们启用后没有使用闭环）：OCR「从图片中提取文字」（CTA 选图）、
  习惯「培养每日习惯」（CTA 聚焦名称输入）、网页监控「监控网页变化」
  （CTA 聚焦名称输入）、知识图谱「查看笔记如何关联」（CTA 经新增
  `openApp` 选项直达笔记）。
- 验证（临时启用 → 全新档案实测 → 恢复禁用）：四张卡片标题/CTA 正确、
  CTA 触发对应动作并关闭（Graph 切换到笔记应用）；i18n 覆盖 +
  四应用 31 项、typecheck、Biome、全量测试全绿；恢复后四插件仍为
  默认禁用。
- 至此全部 15 个内置插件（11 启用 + 4 完整禁用）均有首次引导卡，启用
  即就绪。

## 2026-08-20 命令面板与欢迎页无插件状态漂移

- 打开命令面板逐条核对：19 个条目全部为已启用应用（任务/笔记/翻译/
  金融/证件照/图片工具/剪贴板/文档/文章创作/产物）与核心命令（新建
  会话/切换工作区/压缩上下文/工具展开收起/设置/帮助），无禁用插件
  命令混入。
- 欢迎页快捷键文案为通用表述（Ctrl+1-9 / / / Esc），不绑定具体应用
  映射，无过时风险；帮助页映射已于此前修正。命令面板内容随启用状态
  动态生成，与活动栏一致。

## 2026-08-20 帮助页「项目、任务与自动化」启用状态说明

- 内容漂移审计发现该帮助页把默认禁用的项目/自动化当作可用功能描述
  （「更多 → 项目/自动化」），用户会因找不到入口而困惑。顶部补启用
  状态说明：任务已启用；项目与自动化需先在「管理插件」中启用，规则
  在启用后适用。中英双语同步，help 单测 4 项通过，已同步安装目录。

## 2026-08-20 帮助页快捷键映射修正

- 发现中英帮助「快捷键」页的 Ctrl+1~9 映射过时（写着 2=项目、9=文字
  识别，而项目/OCR 已禁用，实际为 2=任务、9=文档）。由于映射按当前
  启用插件动态生成，修正为当前默认顺序并注明「顺序随启用插件变化」；
  同步检查确认源码中无其他过时映射。已同步安装目录。

## 2026-08-20 浅色主题视觉回归（visual-qa THEME 支持）

- `visual-qa` 新增 `THEME` 参数：首次导航前种入主题 cookie，支持在
  浅色等非默认主题下跑全视图布局回归。
- 实测：`THEME=clean`（明亮白色）桌面/移动双视口 28 视图零启动失败、
  零横向溢出、零顶部遮挡——浅色主题下无布局回归。
- Biome 全绿。

## 2026-08-20 qa-a11y 支持移动视口

- `qa-a11y` 增加 `VIEWPORT` 参数（与 console/locale 一致），移动端
  390×844 全视图 AX 树审计 14/14 零无名称交互控件——桌面与移动壳的
  无障碍名称覆盖均得到确认。

## 2026-08-20 无障碍名称审计（qa-a11y，第八层 QA）

- 新增 `scripts/qa-a11y.mjs`（`bun run qa:a11y`）：通过 CDP Accessibility
  域逐个视图读取 AX 树，检查按钮/链接/输入框/组合框/复选框/开关等交互
  角色是否有可访问名称（无标签控件对键盘与读屏用户不可用），带启动
  失败哨兵。
- 结果：14/14 视图零无名称交互控件——应用的 aria-label 覆盖（i18n 门禁
  强制）与键盘走查一直以来的守护在此得到 AX 树层确认。
- Biome 全绿，`qa:a11y` 已加入 package.json。

## 2026-08-20 加载竞态系统扫描收口

- 全量扫描 store 的 `load()` 后确认：已为习惯/网页监控/知识图谱/剪贴板/
  文章创作补序号守卫；任务中心有 `loading` 互斥（轮询不重叠）天然安全；
  OCR 无挂载加载；笔记无 setTarget 双加载且长期稳定；设置类 store 按
  标签页单次触发。禁用中的 Projects/Automation 存在同类潜在竞态，但按
  用户决策保持禁用，启用前再补守卫即可。
- 修复后复验：数据呈现 5/5、控制台 14/14 全绿，最新构建无回归。

## 2026-08-20 竞态守卫扩展到剪贴板与文章创作

- 系统扫描全部 store 的 `load()` 后发现同类隐患：剪贴板（挂载加载 +
  setTarget 双加载，无守卫）与文章创作（setTarget 在目标就绪前后各触发
  一次，早到的 403 可能晚返回覆盖成功状态）。为两者补序号竞态守卫，
  与习惯/网页监控/知识图谱修复一致。
- 验证：全新档案实测剪贴板与文章创作首开均无 403 横幅、正常渲染；
  clipboard + articles 6 项测试、typecheck、Biome、全量测试全绿；
  产物已同步安装目录。

## 2026-08-20 修复习惯/网页监控/知识图谱首开 403 错误横幅

- 背景：对「完整但默认关闭」插件做启用就绪性验证时，发现 Habits 与
  Web Watch 首次打开会残留 `failed (403)` 错误横幅——挂载加载在场景
  目标就绪前发起（sceneId=undefined → 403），其失败结果晚于
  `setTarget` 的成功加载返回时覆盖成功状态；Knowledge Graph 同样存在
  该竞态（此前因禁用未暴露）。
- 修复：三个 store 的 `load()` 增加序号竞态守卫（与产物库等一致），
  过期请求结果一律忽略；挂载加载与 setTarget 加载并存不再互相覆盖。
- 验证（临时启用 → 全新档案实测 → 恢复禁用）：Habits 显示习惯与连续
  天数、Web Watch 显示监控表单、Knowledge Graph 正常激活并渲染笔记
  图谱，三处均无 403 横幅；OCR 无挂载加载故无此问题，后端真实识别
  「ZiCode QA 123」通过。恢复后四个插件仍为默认禁用（场景状态复原）。
- 门禁：habits/watch/graph 22 项测试、typecheck、Biome、全量
  `bun run test` 全绿。

## 2026-08-20 真实对话链路端到端验收

- 在最新运行实例（PID 46356）上以真实模型调用验证核心用户流程：
  `visual-qa` 开启 `QA_SEND_MESSAGE=1`，桌面 1440×900 与移动 390×844
  双视口均完成「发送消息 → 模型回复」闭环（`userSent=true,
  replyReceived=true`）。
- 佐证：`[model-gateway]` 日志记录两次真实 `POST /chat/completions`
  （deepseek-v4-flash），上游均 200 OK，无失败/重试；对话区无布局
  异常（chatGap 12–13px，历史与输入间距正常）。

## 2026-08-20 产物库首次引导卡（启用应用引导全覆盖）

- 核查发现：产物库是唯一没有 `FirstRunGuide` 的启用应用（仅有空态文案）。
  按既有模式补引导卡「自动汇总结果」：三步说明（对话中请 Pi 生成图表/
  报告/数据集 → 导出笔记或保存金融研究结果 → 结果连同来源自动汇入），
  CTA「去对话」直达 Chat（`ArtifactAppOptions` 新增可选 `openApp`，由
  app.js 接线 `pluginShell.activate`）。
- 验证：活实例全新档案实测引导卡完整显示，点「去对话」切到 `core.chat`
  并自动关闭持久化；typecheck、artifacts + i18n 16 项、Biome、全量
  `bun run test` 全绿；控制台 14/14 复扫干净；产物已同步安装目录。
- 至此 9 个主要启用应用（对话/任务/笔记/翻译/金融/证件照/图片工具/
  剪贴板/文档/产物/文章）均有首次引导或等效的快速开始路径。

## 2026-08-20 QA 脚本正确性警告清零

- 清理 Biome 剩余的 4 处正确性警告（均在脚本层）：`qa-notes-flow` 创建
  笔记后补响应断言（id 存在 + 标题一致，让「未使用变量」变成有效校验）；
  `qa-artifacts-flow` 删除未使用的调试捕获；`qa-data-presence` 与
  `bundle-css` 修正未使用参数。
- 验证：Biome 4 文件 0 错误；`qa-notes-flow`（含新断言）、`qa-artifacts-flow`
  、`qa-data-presence` 5/5 复跑全部通过。

## 2026-08-20 帮助中心新增「文章创作」双语指南

- Articles 恢复默认启用后，帮助中心仍无对应条目（此前 14 页，覆盖笔记/
  金融/产物等应用但无文章创作）。新增中英双语帮助页：
  `public/help/articles.md` 与 `public/help/en/articles.md`，覆盖写作、
  发布目标配置（公众号应用 ID/密钥/站点/作者，博客主机/用户名/密码/
  远程目录，Astro 源目录）、五条发布路径与未配置提示；中英文清单各
  新增「文章创作 / Article Publishing」分区与页面条目（16 页）。
- 验证：清单 JSON 合法、help 单测 4 项全绿、全量 `bun run test` 通过；
  活实例帮助中心实测点击「文章创作」打开完整正文（约 1 分钟阅读）；
  文件已同步安装目录。

## 2026-08-20 数据呈现 QA（qa-data）与应用数据审计

- 依据 Articles 空列表教训新增 `scripts/qa-data-presence.mjs`
  （`bun run qa:data`）：全新档案逐个加载数据型应用，把 UI 渲染条目数
  与宿主 API 计数交叉核对（articles 严格相等、notes/artifacts/tasks
  按 API 计数断言、finance 断言表单或场景守卫存在），带启动失败哨兵，
  可捕获「应用打开但列表为空」类回归。
- 审计结果：articles UI 456 = API 456（修复后）；notes 3 项（API 1 个
  笔记本 + 分支/子项）；artifacts 0 = 0（API 确认无产物，空态正确）；
  tasks 2 张任务卡（任务中心真实数据）；finance 场景守卫/表单 28 个
  交互元素（编程场景无金融数据为设计行为）。5/5 通过，无其他应用存在
  Articles 类缺陷。

## 2026-08-20 修复 Articles 列表首次打开为空

- 真实缺陷：Articles 应用挂载时从不加载文章列表（`load()` 只挂在
  `refresh()` 上，壳在目标就绪后调用 `setTarget` 时没有对应实现），
  首次打开始终显示「还没有文章」，尽管 API 实际有 456 篇文章；此前
  全表面验收只检查布局/错误，未断言列表内容，因此漏报。
- 修复：为 ArticlesApp 实现 `setTarget()`（调用 `store.load()`），壳在
  目标就绪/切换时自动加载；hydration 前 `sceneId=undefined` 的早期
  请求被 store 正常吞掉，就绪后重新加载成功。
- 验证：活实例全新档案实测列表渲染 456 篇（首篇「2026 年 VS Code
  插件缺口分析…」），请求序列 403（hydration 前）→ 200（就绪后）；
  Articles 控制台 1/1 干净；typecheck、Biome、全量 `bun run test` 全绿。
- 经验：新增应用的验收需断言真实数据呈现（列表非空），不能只看布局
  与无错误；已把此点纳入后续新应用验收清单。

## 2026-08-20 Articles 首次引导卡（使用闭环补齐）

- 审计发现：Articles 恢复默认启用后是唯一缺少 `FirstRunGuide` 的主要
  应用（文档/证件照/剪贴板/翻译/图片工具/笔记/任务均有），新手打开
  文章创作看不到使用闭环。
- 实现：按既有模式补引导卡「一次创作，多处发布」，三步说明（写 Markdown
  并保存 → 同步公众号草稿或直接发布 → 发布 Astro 博客或从源目录同步），
  CTA「新建文章」直达新建草稿（载入 Markdown 模板、slug 留空待填）。
- 验证：活实例全新档案实测——引导卡显示完整文案，点 CTA 新建文章草稿
  并自动关闭卡片、持久化已读标记；「知道了」同样关闭；i18n 覆盖 +
  FirstRunGuide 6 项、全量 `bun run test`、typecheck、Biome 全绿；
  Articles 控制台 1/1 复扫干净。
- 联动修复：`plugin-shell.test.js` 的禁用插件深链示例原用 Articles
  （现已默认启用），改用仍默认禁用的 Projects，28/28 通过。

## 2026-08-20 Articles 全表面验收并入 QA 常驻视图

- Articles 恢复默认启用后补齐全表面验收：视觉 QA 桌面/移动双视口无
  启动失败/横向溢出/顶部遮挡（首按钮 66px/76px，均在 header 之下）；
  设置「文章发布」标签页完整渲染公众号（应用 ID/密钥/站点/作者/封面/
  评论）与博客服务器（主机/用户名/密码/远程目录/Astro 源目录）表单，
  `#/settings/articles` 路由正常。
- 双语泄漏与键盘扫描的常驻视图列表补入 `com.zicode.articles`：Articles
  单视图零泄漏、23 个 Tab 焦点元素无卡死、Ctrl+K 会话搜索正常；Biome
  全绿。此前 console/visual 已覆盖 Articles（14/14），至此六层 QA 全部
  包含该应用。

## 2026-08-20 Articles 文章创作插件恢复默认启用

- 背景：用户明确要求的文章创作/公众号/博客发布插件（Articles）此前
  一直处于默认禁用，活动栏与「更多」菜单不展示，用户请求的功能被隐藏。
- 改动：Rust `builtin_manifests()` 与前端 `plugin-registry.js` 的
  Articles `enabled_by_default` 均改为 `true`；通过 `/v2/plugins/enablement`
  在当前 programming 场景即时启用。
- 验证：活实例 Articles 应用真实加载（activePlugin=com.zicode.articles，
  主视图显示完整文章创作 UI：编辑/预览/保存/删除、同步公众号草稿、
  同步并发布到公众号、发布已有草稿、博客 Astro 源目录同步）；全视图
  控制台扫描 14/14 零错误（新增 Articles 视图）；Rust 12 项 registry 测试、
  Clippy `-D warnings`、fmt、前端 registry 5 项全绿。
- 交付：重建 release（exe 47,805,440 B，2026-08-20 02:20，含 Articles
  默认启用），已按「重命名 `.prev` + 复制」暂存；运行实例不受影响，
  下次重启后新装场景/全新安装默认启用 Articles，`.prev` 确认稳定后可删。

## 2026-08-20 任务预算通知增加「打开任务」直达动作

- 「Task budget reached」警告此前只有金额文案，需自行前往任务中心查看
  被停止的子任务；现复用通知 action 能力，增加「打开任务」按钮，点击
  经既有 `zicode:open-tasks` 事件直达任务应用。
- 验证：新增 i18n 键 `Open tasks`→打开任务，i18n 覆盖 4 项全绿；app.js
  与 i18n.js 同步安装目录后，控制台 13/13、键盘 13/13、双语 13/13 全绿。

## 2026-08-20 运行时断连通知增加「新建会话」直达动作

- 「Runtime disconnected」警告此前只有文案（「启动新会话以重连」），
  用户需要自行找到新建会话入口；现复用通知 action 能力，增加「新建会话」
  按钮，点击直达 `new-session-btn`，把模型/运行时断连的恢复路径一步
  闭环（与禁用插件通知的「打开管理插件」同模式）。
- 验证：i18n 键存在（"New session"→新建会话）；app.js 已同步安装目录，
  全视图控制台扫描 13/13 零错误零警告（app.js 每视图加载，语法/运行时
  问题会被启动失败哨兵兜住）；通知 action 渲染与点击行为由 notification
  center 单测覆盖。

## 2026-08-20 qa-locale 增加实时语言切换验证

- `qa-locale` 在泄漏扫描之外增加活体验证：通过设置 UI 把语言切到英语，
  断言界面 chrome 变为英文且写入 `zicode-studio-locale=en`，再恢复简体
  中文；任一步失败即非零退出。选项标签随当前语言本地化（中文界面显示
  「英语」、英文界面显示「English」），匹配逻辑按候选标签兼容。
- 实测：设置里「语言」切换在活实例上工作正常——选英语后 cookie 写入
  `en`、设置页全部变英文（Appearance/Theme/Language/…），恢复中文后
  界面还原；此前一次「未切换」为探针正则未匹配「英语」所致，非应用缺陷。
- 泄漏扫描补充任务中心容器排除（`.task-center-card/.task-center-list`，
  任务名为用户内容）：桌面 13/13 视图零泄漏，切换验证通过；Biome 全绿。

## 2026-08-20 英文界面泄漏扫描（qa-locale）与全量视觉回归

- 新增 `scripts/qa-locale.mjs`（`bun run qa:locale`）：设置 en cookie 后
  逐个加载应用视图，扫描 UI chrome（按钮/标签/占位符/aria-label/标题等）
  中的汉字，排除用户内容容器（对话记录、会话列表、笔记树、任务卡、
  运行时任务面板、插件权限描述等）；带启动失败哨兵，任一视图出现
  硬编码中文 UI 即非零退出。
- 结果：桌面 13/13 视图零泄漏——英文界面没有硬编码中文残留，源级
  i18n 门禁之外再添运行时一层；扫描到的唯一汉字均来自用户内容
  （中文对话、笔记标题、任务名），属预期。
- 同时完成近期前端改动（Collapse 键、已归档 role 修复、禁用插件通知
  动作按钮）后的全量视觉回归：桌面 1440×900 与移动 390×844 全部视图
  无启动失败、无横向溢出、无顶部遮挡；笔记工具栏位于 header 下方，
  chat 顶部输入布局指标为已知误报形态。

## 2026-08-20 禁用插件通知增加「打开管理插件」直达动作

- 现状核查：从「更多」菜单打开已禁用插件时，活动栏/菜单已按启用状态
  过滤，不会出现该入口；直接深链（`?app=<pluginId>`）打开禁用插件会
  回退到对话并弹出「插件未启用」警告——此前该通知只有文案，无法直接
  处理。
- 改进：通知中心支持可选 `action`（标签 + 动作），「插件未启用」警告
  增加「打开管理插件」按钮，点击后直达插件管理器并自动关闭通知，
  把「为什么打开的是对话 + 怎么启用」一步闭环。
- 验证：新增通知动作单测（渲染/点击执行/自动关闭）共 5 项全绿；i18n
  覆盖 4 项、Biome、typecheck、全量 `bun run test`（vitest + Tauri 权限
  + Windows 子进程策略）全绿；活实例实测：深链 projects → 通知含
  「打开管理插件」→ 点击后活动项切到 `core.pluginManager`、通知消失；
  控制台全视图 13/13 复扫干净。产物已同步安装目录（刷新即生效）。

## 2026-08-20 键盘可达性审计与 QA URL 修复

- 新增 `scripts/qa-keyboard.mjs`（`bun run qa:keyboard`）：逐视图 Tab
  走查（焦点卡死/落在隐藏元素检测）+ 全局快捷键验证（Ctrl+K 打开会话
  搜索、Esc 关闭）。结果：桌面 13/13 视图 Tab 可达 20–25 个元素、无焦点
  卡死、无隐藏焦点，Ctrl+K/Esc 全视图正常。
- 修正 `scripts/qa-console-errors.mjs` 会话 URL：此前误用裸
  `/sessionId` 路径（`parseAppRoute` 判为 `not_found`，页面渲染启动失败
  屏），首轮「13/13 干净」结论无效；改为
  `/app/workspaces/<wsId>/sessions/<sessionId>` 后复扫，并在两个 QA 脚本
  加入启动失败哨兵（页面处于 `startup-failed` 一律计为错误，防止再次
  出现「失败屏还报干净」）。修正后桌面与移动 390×844 均为 13/13 视图
  零控制台错误、零警告。
- 本轮同时确认此前修复的 Biome 存量 3 处错误（真实可用性隐患）：
  - 会话侧栏「已归档」分组头补 `role="button"`（`aria-expanded` 语义
    合法；因内嵌删除全部按钮保持 div + 显式 role）；
  - 笔记采集预览「收起」改用独立键 `Collapse`（此前重复键覆盖导致侧栏
    「显示更少」也显示成「收起」）；
  - 文章发布配置的挂载加载 effect 补充意图说明，消除依赖告警。
- 验证：相关单测 241 项 + i18n 覆盖 4 项全绿，全量 `bun run test`（vitest
  + Tauri 权限 + Windows 子进程策略）、typecheck、Biome lint 0 错误全绿；
  前端产物已同步安装目录（刷新即生效）。

## 2026-08-20 临时会话空闲运行时自动回收

- 背景：QA 与多轮新建会话会留下 `temporary-*` 临时会话对应的 Pi 运行时，
  此前长时间空闲不回收（曾观察到 11 个空闲运行时进程），占用本机资源。
- 实现：`NativePiManager` 新增 15 分钟空闲宽限回收器，在新建会话前清理
  超龄的 `temporary-*` 运行时；Starting/Working 状态与永久会话运行时
  一律不回收；`spawn()` 与内存注册路径统一记录创建时间。
- 验证：新增回收器单测（宽限期内保留、超龄回收、永久会话不受影响）；
  Rust 246 项、Clippy `-D warnings`、`cargo fmt --check`、前端全量
  vitest + Tauri 权限 + Windows 子进程策略全绿；提交 `3a4ed22e` 已推送。
- 交付：重建 release（exe 47,800,832 B，2026-08-20 00:16），新 exe 已
  暂存到安装目录（运行实例占用旧 `.prev`，应用下次重启后回收器生效；
  `.prev` 在重启后可直接删除）。本轮为 Rust 端改动，前端无变更。
- 激活与可观测：追加回收日志（提交 `e1a2a629`），重建 release
  （exe 47,805,440 B，2026-08-20 00:34）后于 00:35 重启实例
  （PID 79848）：`/health` 200、pi 0.84.1、公网中继 dev-ax2-01 在线、
  启动日志无 ERROR/WARN/panic，启动清理移除 12 个废弃空实例；此后
  每次新建会话前的回收都会在日志留下
  `[picot-native] reaped N stale temporary runtime(s)` 记录。

## 2026-08-19 首次引导卡全应用验收

- 全新档案逐应用实测引导卡完整链路：剪贴板/文档/图片工具/证件照首次进入均
  显示引导卡（步骤 + CTA），点击 CTA 无报错且正确触发首个动作（聚焦输入/
  打开文件选择器），关闭后引导卡消失；无横向溢出、无页面错误。与先前已验
  证的翻译/笔记/任务一起，首次引导系统覆盖全部主要应用并端到端可用。

## 2026-08-19 欢迎页新手界面速览

- 欢迎页新增一行界面速览：「左侧图标切换应用 · 顶部切换工作区 · 右侧面板放
  文件与后台任务」，让新用户第一眼就知道三栏布局各区域的作用。
- 验证：chat 测试 17 项 + i18n 覆盖通过，活实例新建会话实测速览文案显示且
  无横向溢出；全量测试 + 类型检查全绿。

## 2026-08-19 活动栏悬停显示应用说明

- 活动栏图标悬停提示从「应用名 (+快捷键)」升级为「应用名 — 一句话说明
  (+快捷键)」，新手无需打开应用就能知道每个图标是做什么的。
- 验证：活实例实测笔记/翻译 tooltip 含描述与快捷键；plugin-shell 与
  活动栏测试 29 项通过，全量测试 + 类型检查全绿；首次引导卡全应用铺开后的
  全表面双视口回归无布局破坏。

## 2026-08-19 首次引导卡扩展到笔记与任务

- `FirstRunGuide` 覆盖到笔记与任务：笔记首次进入显示完整闭环（新建笔记本 →
  写/采集 → 组织 → 带入对话/导出/发布，CTA 直达新建）；任务中心说明
  审批/暂停/重试/打开结果（CTA 查看全部任务）；关闭后按应用持久化。
- 验证：notes 145 项 / tasks 9 项测试（含引导卡断言），活实例实测两个应用
  引导卡显示且无横向溢出；全量测试 + 类型检查全绿。

## 2026-08-19 工具类应用「首次使用引导卡」

- 新增可复用、可关闭的 `FirstRunGuide` 组件（localStorage 按应用持久化
  「已关闭」），并把「使用闭环」做成主动引导：首次进入翻译、剪贴板、文档、
  图片工具、证件照时，顶部出现卡片说明「做什么 / 第一步 / 结果去哪」，
  带直达首个动作的 CTA（聚焦输入、打开文件选择器等）；关闭后不再出现。
- 验证：组件单测（渲染/CTA/持久化）+ 翻译应用集成断言 + 活实例实测
  （首次进入显示、关闭后刷新隐藏、无横向溢出）；全量测试 + 类型检查全绿。

## 2026-08-19 金融工作台新手快速路径

- 金融概览页新增「如何开始」四步推荐路径：配置数据 Key → 为标的创建研究卡 →
  回测策略/运行选股器 → 用模拟账户跟踪结果，并注明「每次保存的结果自动进入
  产物库」；每步带按钮直达对应视图。
- 验证：新增 financeWorkbench 渲染测试（11 项通过），金融场景活实例实测
  「如何开始」与步骤文案生效、无横向溢出；全量测试 + 类型检查全绿；
  长闭环文案的全表面双视口回归无溢出。

## 2026-08-19 全应用「使用闭环」文案收口

- 按「每个应用都要有自己的使用闭环」逐应用补齐落地页/空状态文案：
  - 笔记：空库说明完整闭环（写笔记、采集网页、标签组织、带入对话、发布博客）；
  - 金融：研究空状态指向创建卡片表单，并说明结果会进入产物库；
  - 翻译/证件照/图片工具/剪贴板/文档：头部说明均补充「结果去哪」
    （复制/下载/新标签页打开/发送到笔记/保存到笔记本）；
  - 此前已完成：任务中心审批与来源说明、智能收件箱新手设计、产物库创建指引、
    自动化审批语义。
- 验证：translate/documents/notes 活实例抽查新文案生效且无横向溢出；
  全量测试 + 类型检查全绿；public 已同步，刷新即生效。

## 2026-08-19 智能收件箱新手化设计

- 按用户反馈「智能收件箱对新手不友好」，重新设计其功能与使用方式的呈现：
  - 新增双语帮助指南 `inbox.md`：一句话定义（外部消息 → 待办任务 → 你批准 →
    AI 代理执行 → 结果回传）、三步开始、飞书/企业微信接入步骤、日常使用与
    安全说明；注册进帮助中心（现 15 篇）。
  - 设置 → 智能收件箱页顶部新增「智能收件箱是什么」白话说明 + 三步快速开始
    + 「查看使用指南」按钮（打开帮助页）。
  - 侧边栏入口状态文案改为「外部消息在这里变成待办任务」，不再罗列平台名。
  - 对话页智能收件箱面板头部新增「怎么用」按钮直达指南；空状态说明其用途。
  - app.js 新增 `zicode:open-help` 事件，支持从任意组件按页打开帮助。
- 验证：设置页说明块/三步/按钮、面板入口、帮助 manifest（15 篇含 inbox）
  活实例实测通过；全量测试 + 类型检查全绿；public 已同步，刷新即生效。

## 2026-08-19 可用性验收清单（用户需求 → 验证证据）

| 用户需求 | 实现 | 验证证据 |
| --- | --- | --- |
| 笔记 6 项初始任务（遮挡/移动端/预览默认/新建布局/图标/标签快捷） | 全部落地 | qa-notes-flow PASS + 全表面 visual-qa |
| 笔记 11 项细化（自动保存/图标/标签/带入对话选中文字/Markdown 渲染/删除确认/附件自动保存/定期保存/移动端附件/侧边栏） | 全部落地 | qa-notes-flow、qa-notes-attachment PASS |
| 笔记本/笔记图标与多级目录、跨笔记本拖拽 | 已实现 | qa-notes-flow drag: movedToTarget=true |
| 网页采集去噪（导航/页眉页脚/广告/侧边栏）并保留样式 | web_extract 增强 | 19 项单测 + Wikipedia/阮一峰/sspai 真实页冒烟 |
| 使用 Pi 的能力处理网页 | `/v2/notes/summarize` + notes_extract_web | 真实调用模型网关返回结构化摘要 |
| 证件照混合排版（1寸+2寸）与源照片裁剪 | idphoto 混合排版 + 交互裁剪 | visual-qa idphoto mixed 通过 |
| 8 个插件真机验收 | 验收 harness | plugin-acceptance 6/6（启用子集） |
| 不完善插件先禁用 | Projects/Tasks/Automation 默认禁用 | 运行实例 API 状态确认 + 单测 |
| 自动化全自动 | 调度器全页面运行 + 非审批自动派发 | 活实例写入 autoDispatch 任务自动转出 pending |
| 布局问题清单（对话间距/图标沉底/help/笔记遮挡/主题下拉/任务空） | 全部修复 | 全表面双视口 visual-qa 全绿 |
| 工作区切换/会话按工作区隔离/配置入 ~/.zicode | 已实现 | 早期轮次验收记录 |
| M2 P2P / M3 端到端加密 | 已基本闭环 | 文档验收记录（coturn 公网验收待服务器） |
| 帮助文档与新增功能同步 | 采集预览/Pi 提炼/自动化边界已入档 | layout-contract 68 项 PASS |

运行基线：19:11 release（exe 47,808,000 B）已重启激活，`/health` 200、
公网中继 dev-ax2-01 在线；Rust 245 项 + 前端全量 + 插件验收全绿。

## 2026-08-19 运行实例重启激活全部暂存改进并完成真实验收

- 运行实例（8/18 启动的旧 exe）确认完全空闲后按计划重启：优雅关闭旧进程、
  删除 `.prev`、启动 19:11 新构建，`/health` 200、公网中继 dev-ax2-01 在线。
- 新 exe 生效后完成端到端验收：
  - `POST /v2/notes/summarize` 真实调用模型网关返回结构化摘要
    （一句话摘要 + 要点 + 结论，deepseek-v4-flash）；
  - 网页采集（新提取器）qa-web-capture PASS；
  - 核心回归 qa-notes-flow / qa-notes-attachment / qa-artifacts-flow /
    qa-session-backup 全部 PASS；
  - 插件验收 6/6 PASS。
- 重启同时清掉了此前 QA 会话累积的数十个空闲 Pi 运行时进程。

## 2026-08-19 网页采集「用 Pi 提炼要点」与发布重建

- 完成用户「使用 pi 的能力」的明确需求：新增 `POST /v2/notes/summarize`
  （复用场景 QVeris 凭据与模型网关，与 translate 同一调用模式），采集预览
  增加「用 Pi 提炼要点」按钮，把提取到的正文交给模型生成结构化摘要
  （一句话摘要 + 要点 + 结论），在预览中以卡片展示，支持复制/收起；保存的
  笔记仍保留完整原文。
- 新增 `src-tauri/src/summary.rs`（提示词构建、响应提取、长度校验，3 项单测）；
  NotesGatewayLike/NotesGateway/notes store 增加 summarize 通道；前端新增
  UI 测试（模拟网关返回摘要并断言展示与参数），notes 144 项测试通过。
- 全量验证：Rust 245 项、Clippy `-D warnings`、fmt、前端全量 vitest +
  Tauri 权限 + 子进程策略、typecheck 全绿。
- 交付：重建 release（exe 47,808,000 B / NSIS 348,679,022 B，2026-08-19
  19:11），新 exe 已暂存到安装目录（运行实例占用旧 `.prev`，重启后生效，
  届时 `/v2/notes/summarize` 与完整新提取器同时可用）；public/extensions
  已同步。

## 2026-08-19 会话侧边栏 headless 渲染问题调查（排除三项假设）

- 背景：headless Chrome 下 `#session-list` 的 React 根有 fiber 但无 DOM
  提交（0 子元素）；真机/桌面正常。本轮补充证据并排除三个假设：
  1) `SessionSidebarApp` 对 skeleton/loading/error/empty 均有早退渲染，
     空 DOM 说明提交确实被跳过，而非「空数据渲染为空」；
  2) 构造器 `flushSync(() => root.render(...))` 改为普通 render 后 headless
     仍无提交——外层 flushSync 不是原因；
  3) 挂载推迟到 `setTimeout(0)` 宏任务后仍无提交——引导同步阶段冲突不是原因。
- 另外确认：headless 页面内 `fetch`/`window.__zicodeHostFetch` 请求
  `/v2/sessions` 均 200 且返回 16 个会话（数据路径正常）；`listAllSessions`
  在引导时即被调用。剩余假设指向 React 19 调度器在该根上的提交被跳过
  （可能与 `useSyncExternalStore`/zustand 快照契约或 headless 环境差异有关），
  需真机/真实浏览器对照确认，本仓库不再重复这三项实验。

## 2026-08-19 自动化调度全页面运行与非审批任务自动派发

- 修复「任务不能做到全自动」的两个实际缺口：
  1) 自动化调度器此前只在自动化中心打开时启动，用户停留在对话等页面时定时
     工作流不会触发；现在随页面启动运行（`automationApp.startScheduler()`），
     整个页面生命周期持续 tick，与其他应用视图无关。
  2) 非审批自动化入队的任务此前仍停在 pending，必须在 Agent Inbox 运行时
     面板手动点「批准」才派发；现在入队时写入
     `automation.autoDispatch=true`（由工作流 `requireApproval` 决定），
     运行时轮询发现此类任务自动 `markTaskForDispatch` 并触发 `sa-dispatch`，
     与手动批准走同一派发链路；需审批的工作流保持等待人工批准。
- 验证：自动化 store 新增 autoDispatch 标记单测（审批/非审批两分支）、
  运行时自动派发单测（仅 autoDispatch 任务被派发、manual 任务保持 pending），
  automation 11 项 + super-agent-runtime 17 项测试通过；全量 vitest + Tauri
  权限 + Windows 子进程策略、typecheck 通过；chat 引导冒烟无控制台错误；
  public 已同步安装目录，刷新页面即生效。
- 边界：应用关闭后的无人值守执行仍依赖后台 Host Runner（路线图非目标），
  本轮覆盖「应用打开期间」的自动调度与自动派发。

## 2026-08-19 核心回归全绿与验收脚本适配

- 对运行实例跑通全部核心回归：`qa-notes-flow`（编辑/自动保存/标签/图标/
  多级拖拽/带入对话选中文字/标签筛选）、`qa-notes-attachment`（移动端附件
  预览与直链）、`qa-artifacts-flow`（创建/查看/删除）、`qa-session-backup`
  （会话导出/导入往返）、`qa-web-capture`（网页采集→笔记，含来源与标签），
  全部 `pass: true`；跑完检查无 QA 数据残留（剪贴板收件箱为空、无 QA 命名
  笔记/产物）。
- `plugin-acceptance.mjs` 适配默认禁用状态：Habits/Watch/OCR 深链现在按
  预期回退到对话，验收遍历改为按 host 启用状态过滤（`PLUGIN_FILTER` 仍可
  强制单测），实测 6/6 通过（Translate/ID Photo/Image Tools/Clipboard/
  Documents/采集防护）。
- 设置「文章发布」页在 Articles 插件禁用时已显示「启用 Articles 插件后可
  配置」的引导文案，无需改动。

## 2026-08-19 插件引导重复 setTarget 竞态修复

- 上一轮的水合等待修复仍有竞态：app.js 会话引导会在 `setupPluginShell`
  之后再次调用 `pluginShell?.setTarget(target)`，同一 scene 命中
  `sceneId === registrySceneId` 守卫并立即 `finishBoot()`，赶在首次 host
  水合完成前就用目录默认值决定了初始深链，导致用户手动启用的 Tasks 深链
  在部分时序下静默回退到对话（桌面端 tasks 遍历偶发/持续失败，移动端正常）。
- 修复：新增 `hydrationPending` 状态，水合进行中重复 setTarget 不提前完成
  引导，等首次 `setScene` 落定后再解析初始应用；无 gateway 路径保持同步。
  新增「水合期间重复 setTarget」回归测试（plugin-shell 28 项通过），
  无头浏览器 + visual-qa 连续 3 次桌面 tasks 深链均正确打开任务中心，
  全表面双视口回归无启动失败/横向溢出。

## 2026-08-19 插件引导水合时序修复与视觉回归工具改进

- 修复插件深度链接竞态：引导时 `registry.setScene` 异步水合 host 启用状态
  （fire-and-forget），初始深度链接与应用栏在完成前用本地默认值判断，导致
  用户手动启用、但目录默认禁用的插件（如 Tasks）深链静默回退到对话。现在
  host 模式下引导等待水合完成再解析初始应用；无 gateway 的测试路径保持同步。
  新增 `BuiltinPluginRegistry.hostBacked` 与回归测试（27 项 plugin-shell 测试
  通过），并用无头浏览器 + visual-qa 实测 `?app=com.zicode.tasks` 正确打开
  任务中心。
- `scripts/visual-qa.mjs` 改为按 host 当前启用状态过滤待遍历应用，避免把
  「禁用插件深链回退」当作失败误报；系统入口（chat/settings/help/plugin
  manager）始终遍历。桌面 + 移动双视口全表面回归通过（tasks 显示真实任务，
  其余应用无启动失败/横向溢出/控制台错误）。

## 2026-08-19 欢迎页快捷入口跟随插件启用状态

- 欢迎页快捷入口原为硬编码列表，禁用插件（Projects/Tasks/Automation）后
  仍显示按钮、点击静默回到对话。现改为从 Plugin Shell 读取已启用应用，
  按注册表顺序取前四个展示（始终保留「新建对话」）；用户在 Plugin Manager
  开关插件后列表自动适配。
- 实现：`ChatMessageList`/`ChatFeed`/`MessageRenderer` 新增
  `getEnabledAppIds` 选项，`app.js` 惰性读取 `pluginShell.registry`；
  新增过滤单测（17 项聊天测试通过），并重建 `public/native/react/chat.js`。
- 端到端验证：新建空会话后无头浏览器实测欢迎页仅显示
  新对话/任务/笔记/翻译/金融 5 个入口（Tasks 为运行实例中用户手动
  重新启用的应用，Projects/Automation 不再出现），活动栏同步正确；
  新前端已同步到安装目录，应用刷新即生效。

## 2026-08-19 网页采集正文提取增强

- 按用户反馈「从网页生成笔记需要去除导航/页眉页脚/广告/侧边栏，保留正文与
  原文样式」，增强 `src-tauri/src/web_extract.rs`（笔记采集与 `notes_extract_web`
  Pi 工具共用同一提取器）。
- 语义去噪：`nav`/`footer`/`aside` 标签、`role=banner/navigation/
  complementary/contentinfo/search`、`aria-hidden="true"`、`hidden`、
  `data-nosnippet` 直接剔除；补充广告/弹窗/工具栏/登录注册/排行/关注/下载等
  英文与拼音类名提示；`body`/`html` 不再因站点级 class（如
  `skin-vector-search-vue`）整体误判为噪声；噪声匹配改为词边界感知，避免
  `research` 误伤 `search`、`loader` 误伤 `ad`。
- 正文选择：`article`/`main` 标签加分，容器按段落数与标题数加分，正文容器
  能胜过同文本量的导航/推荐列表。
- 样式保留：标题内联链接/代码、表格单元格内联链接、图片标题（figure +
  figcaption 斜体）、定义列表（dl/dt/dd）、水平线、折叠块（details/summary）、
  删除线、行内代码（code/kbd/samp/var）、引用引号、音视频源链接；嵌套列表
  递归缩进渲染；输出折叠多余空行并去除行尾空白。
- 验证：`web_extract` 19 项单测通过（新增语义去噪、嵌套列表、样式保留、
  表格内联、正文优先、Cookie 横幅、边界匹配等）；全量 Rust 242 项、Clippy
  `-D warnings`、`cargo fmt --check`、前端全量 vitest + 权限/子进程策略全绿；
  真实页面冒烟（Wikipedia 英文文章、阮一峰中文周刊）正文完整、导航/捐赠/
  页脚零泄漏（冒烟测试默认忽略，`ZICODE_SMOKE_URL` 可指定其他页面）。
  2026-08-19 追加验证 sspai.com 文章页（含侧边栏/图片水印参数），正文、
  链接、图片、加粗标题均完整保留。
- 交付：重建 release（`target/release/zicode-studio-desktop.exe`
  47,776,256 B / NSIS 安装包 348,682,991 B，2026-08-19 16:19），
  public/extensions 已同步到安装目录；运行中实例占用旧 exe，采用
  「重命名 `.prev` + 复制新 exe」方式暂存，应用下次重启即使用新版正文
  提取器；`.prev` 文件在重启后可直接删除。

## 2026-08-19 未完善插件默认禁用

- 按用户决策，将尚未完善且暂不继续开发的三个内置插件默认禁用：Projects
  （缺少项目新建/修改/删除）、Tasks（缺少后台 Host Runner，任务列表长期为空）、
  Automation（无人值守执行依赖后台 Host Runner）。代码与数据全部保留，用户可在
  Plugin Manager 中随时重新启用。
- 同步修改 Rust `builtin_manifests()` 与前端 `plugin-registry.js` 的
  `enabledByDefault`，并通过 `/v2/plugins/enablement` 在运行实例中立即禁用
  （programming 场景）；前端与 Rust 回归测试覆盖新默认值。
- 当前默认启用的内置插件：Chat、Notes、Finance、Artifacts、Translate、
  ID Photo、Image Tools、Clipboard、Documents；Articles、OCR、Web Watch、
  Habits、Knowledge Graph 维持默认禁用。
- 验证：前端全量 vitest + Tauri 权限 + Windows 子进程策略通过，TypeScript
  typecheck 通过，Rust `plugin_registry` 12 项测试通过。

## 2026-08-02 QVeris 凭据读取与 API Key 前缀

- 修复 QVeris Key 已设置但仍提示“尚未配置 API Key”的问题。根因：Rust Credential
  Broker 在每次 pi 启动时把场景凭据物化为 `auth.json` 供运行时加载，扩展随后调用
  `sealBrokerAuthConfig()` 删除该文件；但 pi 的模型可用性/请求仍按
  `auth.json` 语义解析凭据，扩展侧 `readQVerisApiKey()` 也只读内存、env 与
  `auth.json`。重启后内存为空、auth.json 已封存，QVeris 模型目录同步失败，模型下拉框
  显示“尚未配置 API Key，请前往设置 → 配置添加”。
- 修复方式：`sealBrokerAuthConfig(registry)` 在删除 auth.json 前先把每个提供商的密钥
  写入运行时凭据存储（`authStorage.set` / `runtime.credentials.modify`）；当运行时没有
  实时凭据存储时保留 auth.json，保证可用性优先。封存时机从 `session_start` 推迟到首次
  `/picot-config` 调用（前端打开配置或加载模型目录时触发），此时运行时已能通过实时存储
  或保留的兼容文件继续解析凭据。
- 新增“编辑 API Key 显示前缀”：`scene_credential_status` 返回已配置密钥的前 4 个字符
  （`prefix`，不返回明文），API Key 编辑器与自定义渠道编辑器在已配置时显示
  “已设置 API Key（前缀 sk-…）”，便于区分当前保存的是哪把 Key。
- 验证：Rust 104 个测试通过、Clippy warnings-as-errors 与格式检查通过；前端 120 个
  测试文件、597 项测试通过；Biome、设计规范、Tauri 权限、Windows 子进程策略、MkDocs
  strict 与补丁空白检查通过。

## 2026-08-01 移动端远程设备管理第六轮

- 新增“设置 → 远程访问”页面，保持设置应用的功能区/主视图交互；可查看设备名称、
  配对时间、最近活动、已配对/已撤销状态，并以二次点击确认撤销访问。
- 配对设备元数据升级为 schema v2，旧数据库会原位补齐设备名称与最近活动字段；
  只持久化令牌哈希，不向前端返回哈希或明文令牌。
- 配对交换按来源 IP 使用 60 秒失败窗口限流，设备 ID 与名称进入存储前执行长度和字符
  边界校验；过度尝试显示独立的本地化恢复页面。
- 撤销后新 HTTP/WS 鉴权立即失败，已有远程 WebSocket 最迟五秒结束；客户端停止自动
  重连并展示“访问已撤销”恢复页，避免无限断线重试。
- 修复通过 URL 直接进入远程设置时设备列表早于 Host 握手发出的启动竞态；网关现在
  等待 runtime ready 后再发送首个本地设备管理请求。
- Edge 应用内浏览器在 312×675 页面内部视口验证设置目录自动收起、远程访问卡片完整、
  40px 触控按钮且无横向溢出；1024×640 桌面回归和控制台检查通过。
- 自动验证：105 个测试文件、443 个前端测试通过；Rust 92 个通过、1 个按约定忽略；
  Cargo all-targets、Clippy warnings-as-errors、Rust 格式、Biome、设计规范和 MkDocs
  strict 构建通过。
- Host 仍只监听 `127.0.0.1`。真正开放手机连接仍需 HTTPS/WSS、外部 Origin 校验和
  默认关闭的显式启用开关。

## 2026-08-01 移动端远程安全基础第五轮

- Host 增加基于连接端地址的远程身份约束：非回环 WebSocket 必须声明为远程客户端并
  提供有效设备令牌，不能通过伪装 `desktop` 绕过。
- 非回环 HTTP `/v2/*` 请求统一进入设备 Bearer 鉴权；仅健康检查、WebSocket 升级和
  一次性配对交换保持公开。Host 仍只监听 `127.0.0.1`，本轮没有开放 LAN。
- 远程客户端不能调用 `create_pairing` 为其他设备签发配对凭据。
- 浏览器新增同源 Host fetch 封装，设备令牌不会被发送到模型服务或其他外部 Origin；
  Bootstrap、会话、Notes、Artifacts 与插件 HTTP 网关均接入。
- 未配对、配对失效和一般启动失败新增中英文阻塞页面、明确恢复说明和重试按钮。
- Edge 应用内浏览器验证：失效配对参数会从地址栏移除，阻塞页使用模态警告语义，
  Tab 焦点保持在重试按钮，底层界面不可交互且无横向溢出；桌面正常路径与控制台回归通过。
- 自动验证：103 个测试文件、432 个前端测试通过；Rust 90 个通过、1 个按约定忽略；
  Biome、设计规范与 MkDocs strict 构建通过。
- 安全启用 LAN 仍需 HTTPS/WSS、外部 Origin 校验、配对限流、设备管理/撤销界面和
  默认关闭的显式配置，详见 [ADR 0004](adr/0004-secure-mobile-remote-gate.md)。

## 2026-08-01 移动端导航第四轮

- 手机底部导航由十二个入口的横向滚动改为固定“对话、项目、笔记、文件、更多”五入口，
  常用功能始终可见，文件管理仍保留独立按钮。
- 任务、自动化、金融、产物、命令、插件管理、设置和帮助进入“更多”应用面板；面板
  支持遮罩、Esc、Tab / Shift+Tab 焦点循环和触发按钮焦点恢复。
- 选择次级应用后“更多”保持选中指示；中英文标签与可访问名称同步更新。
- 增加响应式断点监听：从手机切回桌面会关闭隐藏面板，并把导航方向从 `horizontal`
  恢复为 `vertical`。
- 明确当前运行边界：Host 仍只监听 `127.0.0.1`，移动端目前是界面准备而非可连接的
  Android/iOS 客户端；安全远程访问仍需设备配对、加密传输和全路由鉴权。
- Edge 应用内浏览器在 288×640 页面内部视口验证五入口完整可见、“更多”八项均可达、
  焦点循环和 Esc 正常且无横向溢出；1024×640 桌面断点回归通过。
- 自动验证：102 个测试文件、428 个测试通过；Biome、设计令牌、Tauri 权限、Windows
  子进程策略与 MkDocs strict 构建通过。

## 2026-08-01 移动端交互与可访问性第三轮

- 修复手机模型选择器与 Composer 的定位关系：菜单现在以完整 Composer 卡片为边界
  向上展开，不覆盖输入框，也不产生页面级横向滚动。
- 首次打开模型菜单时显示明确的加载状态；加载结束后自动刷新菜单并恢复搜索框焦点，
  加载失败时显示可重试错误，不再短暂误报“没有可用模型”。
- 会话搜索、模型搜索、会话归档、新建对话和思考强度等运行时生成文案接入中英文
  切换，避免静态页面翻译完成后又被英文属性覆盖。
- 命令面板和会话搜索增加 Tab / Shift+Tab 焦点循环与 Esc 焦点恢复；功能区抽屉会
  尊重已被上层弹层处理的 Esc，避免一次按键同时关闭两层界面。
- Edge 应用内浏览器在 344×745 页面内部视口验证模型菜单重叠为 0、中文动态文案、
  命令面板和会话搜索焦点循环；675×312 横屏命令面板完整位于视口内，1024×640
  桌面端恢复 52px 导航、272px 功能区和主视图三栏布局，均无页面级横向溢出。
- 自动验证：102 个测试文件、424 个测试通过；Biome、设计令牌、Tauri 权限与
  MkDocs strict 构建通过。

## 2026-08-01 移动端 Shell 第二轮验收

- 命令面板、会话搜索、通知、配置编辑器、二维码和原生对话框增加移动端安全区与
  底部弹层布局；短高度粗指针设备也进入横屏手机 Shell。
- 软键盘状态改为“输入区聚焦 + 视口实际缩小”联合判断，避免初始化自动聚焦误隐藏
  底部导航；设置模型状态与健康检查的新增文案已补齐中文。
- 修复手机端收起功能区后切回桌面时三栏布局仍保持收起的问题。
- Edge 应用内浏览器完成窄屏 312×675（请求 390×844）与宽屏 1024×640（请求
  1280×800）真实渲染检查；命令面板、会话搜索、Help、Settings 与主视图均无页面级
  横向溢出。粗指针模拟与软键盘真机行为仍分别由单测和后续真机验收承担。
- 自动验证：102 个测试文件、421 个测试通过；Biome、设计令牌和 Tauri 权限检查通过。

## 2026-08-01 移动端 Shell 第一轮

- 小屏幕不再同时压缩展示导航、功能区和主视图：应用导航固定为底部可横向滚动的
  触控栏，功能区成为带遮罩的左侧抽屉，主视图保持全宽。
- 点击当前或其他应用会打开对应功能区；选择会话、笔记、设置项或帮助文章后自动
  收起抽屉。遮罩、Esc、窗口跨断点和 `aria-expanded` 状态已统一处理。
- 对话输入区避让底部导航；输入框聚焦、软键盘出现时临时隐藏导航，并把消息滚动
  安全区同时按输入区和移动导航高度计算。
- Notes、Help、Settings 在手机上共用相同的抽屉交互；Help 目录取消嵌入态高度截断，
  Settings 恢复纵向类别列表。主要触控目标提升到 40–48px。
- 当时自动验证为 102 个测试文件、418 个测试通过；真实视口验收已在第二轮补齐。

## 2026-08-01 M0–M6 本地候选发布

- 产品审计路线图 M0–M6 的实现与本地验收完成；完整门禁、界面走查、EXE/NSIS 哈希
  和签名边界记录在[本地发布验证](release-validation-2026-08-01.md)。
- Help 扩展为 13 篇中英文指南；Notes 功能区采用笔记本与笔记的树形目录。
- Credential Broker 在启动时迁移所有注册场景并清理孤立明文认证文件，最终 release
  独立启动后场景目录中的 `auth.json` 数量为 0。

更新时间：2026-07-31

## 已实现

- Windows GUI subsystem 与统一 `CREATE_NO_WINDOW` 子进程工厂。
- Pi `0.83.0` x64/arm64 官方资产 SHA-256 锁定。
- PortableGit `2.55.0.3` x64/arm64 官方资产 SHA-256 锁定。
- Release 构建缺少 Pi、Git 或 Bash 时直接失败。
- Rust Host 与 Pi 子进程都优先使用内置 PortableGit。
- 固定 SHA-256 的 WebView2 离线安装器与 NSIS 安装钩子。
- 结构化模型渠道：渠道 ID、`baseUrl`、API 类型、模型 ID 和 API Key。
- 编程、金融、创作内置场景，以及自定义场景编辑器。
- 场景提示词与工具白名单在 Pi `tool_call` 前执行；格式损坏时 fail closed。
- 场景级 Pi agent 目录；实例级 session、log 和 tmp 目录。
- ID 经 SHA-256 映射为目录名，不能用路径字符逃逸。
- 历史会话兼容旧目录和新实例目录，并恢复原场景。
- `v*` tag 自动测试、构建 NSIS EXE 和创建 GitHub Release。
- MkDocs Material 严格构建与 GitHub Pages artifact workflow。

## 验证项目

- JavaScript/TypeScript lint 与设计规范检查。
- Vitest 全量测试和 Windows 子进程静态守卫。
- `cargo check --all-targets`。
- Clippy warnings-as-errors。
- Rust 格式检查。
- MkDocs `--strict` 构建。
- Pi、Git、Bash 本地资源版本命令。

## 本地交付证据

以下是改名前完成的安装包验证，文件仍使用历史产品名，不作为当前品牌发布包：

- NSIS：`Pi Windows Desktop_0.1.0_x64-setup.exe`
- 大小：311,788,643 bytes
- SHA-256：`4500ab72ea5b1092a790d5341165ffbda2092eb702ef2670fa1d45901e12024a`
- 包内复核：Pi `0.83.0`、Git `2.55.0.windows.3`、Bash `5.3.15`。
- 包内 WebView2 SHA-256 与 `scripts/webview2-version.json` 一致。
- Release EXE 已在 Windows 上实际启动，标题、连接状态和欢迎界面检查通过。

改名后的代码已通过前端、Rust 和文档检查；名为
`ZiCode Studio Desktop_0.1.0_x64-setup.exe` 的安装包尚未重新构建，将由下一次
本地完整构建或 `v*` Release tag 生成并重新记录哈希与启动验证。

## 发布前外部事项

- 私有仓库为 `ax2/zicode-studio-desktop`，默认分支为 `main`。
- 正式对外分发前建议配置 Windows Authenticode 代码签名。
- 私有仓库 Release 不适合匿名自动更新；当前以安装包下载为交付方式。

## 凭据安全

API Key 已迁移到 Rust Credential Broker：Windows 使用 Credential Manager，macOS
使用 Keychain，Linux 使用 Secret Service。Broker 维护不含密钥的场景/Provider 索引，
Pi 启动时只短暂物化兼容 `auth.json`，模型注册表就绪后立即删除；旧文件自动迁移。

## 2026-07-31 场景、模型与 Help 修复

- 设置页分别显示当前会话场景和下一会话默认场景；Configuration 明确标出实际写入
  凭据与模型配置的当前场景。
- 内置 QVeris 提供商在首次模型同步前也会出现在凭据列表。
- 设置 QVeris Key 后从 `/v1/models` 自动同步聊天模型，并提供手动刷新入口。
- Help 从聊天提示升级为 `public/help/` 驱动的 MkDocs 风格文档中心；中英文各包含
  13 篇指南，覆盖界面、对话、任务自动化、场景、模型、插件、笔记、金融、产物、
  安全和故障排查，并提供目录筛选、文章导览、页内目录和上一篇/下一篇导航。

## 2026-07-31 应用插件平台设计、P0 Shell 与 P1 Registry 基础

已完成设计：

- ADR 0005 明确应用插件位于 Pi Extension 之上，安装、权限、UI 和生命周期由桌面
  Host 管理。
- 定义 Manifest v1、Activity/View/Command/Keybinding/Capability/Pi Tool
  Contribution；顶部 Toolbar/Menu Contribution 已按产品决策取消。
- 定义 Chat Core Plugin、Main View Router、风琴式 Sidebar 和 Plugin Manager。
- 定义权限目录、包校验、数据/密钥隔离、审计、更新回滚和第三方沙箱门槛。
- 定义 Notes 的 Markdown + Astro 兼容 Vault、Finance 迁移、Artifacts 和 Automation
  方向。
- 分为 P0–P7 阶段并给出每阶段验收条件。

已实现 P0 前端壳：

- 左侧 Activity Bar 包含 Chat、Notes、Finance、Artifacts、Command Palette、
  Plugin Manager、Settings 和 Help。
- Chat 作为默认核心插件；切换插件主界面后，Chat 和右侧面板退出可见与焦点树，但
  Session 状态保留。
- Notes、Finance 和 Artifacts 提供风琴式 Sidebar 与独占 Main View 原型。
- Chat 强制启用；Host 尚未就绪时只使用内存/本地状态作为启动占位。
- 插件 Command 合并到现有 Command Palette，并在 Activity Bar 保留全局命令入口。
- 插件顶部 Toolbar/Menu Contribution 已取消；Finance 的旧标题栏按钮也已移除。
- Tauri 原生 File/Edit/Window/Help 菜单栏已移除；Chat 标题区移除工作区完整路径和
  “Open in…” 启动器，只保留文件管理按钮及必要的会话状态控件。
- 应用 Shell 明确为导航、功能区、主视图三部分；Chat 功能区不再重复显示品牌 Logo，
  底部不再重复显示 Settings/Help。
- Settings 和 Help 已改为普通系统应用：设置分类和帮助目录显示在功能区，设置内容与
  MkDocs 风格帮助正文显示在主视图，不再弹出覆盖层。
- 新增插件平台界面文案已接入中英文翻译；Help 目录和 Markdown 内容提供中文与英文
  两套资源，并随界面语言切换；帮助文章使用统一 Hero、提示块、表格、代码和翻页样式。
- 插件壳使用专属可见性状态，不会覆盖 Finance Workbench 等功能自身的 `hidden`、
  `inert` 或 `aria-hidden`。
- 顶部全局栏已从可见布局移除；文件管理入口移到左侧导航，模型与思考控制保留在对话
  输入区。普通界面不显示 P5/P6 等内部路线图标签。

已实现 P1 Registry 基础：

- Rust `PluginRegistry` 是内置插件、启用状态和权限授权的权威来源，状态持久化到
  ZiCode 数据目录的 `plugins/registry.json`，并按 Scene 隔离。
- Host 提供 `/v2/plugins`、`/v2/plugins/enablement` 和
  `/v2/plugins/permission`；前端 Plugin Manager 从 Host 加载，不再以
  `localStorage` 作为桌面运行时的权威状态。
- Manifest v1 校验覆盖 Schema 版本、插件 ID、SemVer、重复 Contribution、JSON
  深度、资源存在性、绝对路径/网络 URL/`..` 逃逸和符号链接目录。
- `plugins/developer/<package>/plugin.json` 支持开发包发现；无效包 fail closed，并在
  Plugin Manager 展示诊断。开发包默认禁用且权限默认拒绝。
- Plugin Manager 展示 Built-in/Developer 来源、当前 Scene、启用状态和权限；撤销
  required 权限会自动禁用插件。状态经 Host 持久化并在刷新后恢复。
- 桌面 Plugin Manager 可以选择本地 Developer 插件目录；Host 在 staging 中执行包大小、
  文件类型和 Manifest/资源校验后原子安装，同 ID 重装作为升级并保留失败回滚。
- Developer 插件可刷新、筛选和卸载；卸载只删除托管包目录，保留源目录、场景授权记录
  以及未来的 `plugin-data` 数据目录。Built-in 插件不能卸载或被同 ID 包覆盖。

已实现 P4 Capability/Broker 基础：

- Rust Host 按 Scene 生成已启用 Capability 和获 `pi.tools.register` 授权的 Pi Tool
  Registry；Manifest 校验固定输入 Schema、Tool 到 Capability 的映射，并拒绝场景内
  Tool Name 冲突。
- Chat/应用层可通过同源 Capability Gateway 调用 Host；内置 Notes 提供首个真实
  `notes.search` Handler，只扫描托管数据目录中的 Markdown，并只返回相对路径。
- 每个 Native Pi Runtime 获得独立工具快照和随机 Broker Token；Host 仅保存 Token
  哈希，并校验 Runtime、Session、工具授权和 `toolCallId` 幂等。
- 内置 `plugin-broker` Pi Extension 从有界快照注册工具，通过 AbortSignal 调用 Host，
  不允许插件自行注入未声明的 Tool。
- Capability 输入限制 256 KiB、输出限制 1 MiB；审计 JSONL 只记录调用元数据与输入
  SHA-256，不记录输入、结果或密钥。

已实现 P5 Notes 核心：

- 一个 Notebook 对应一个独立 Vault；Markdown + Frontmatter 是内容真相，并自动创建
  Astro Content Collection 兼容目录、配置和附件目录。
- 统一三栏界面已接入笔记本、标签、笔记列表、标题/标签/Markdown 编辑、预览、正文搜索、
  快捷保存和版本冲突提示。
- Host Notes API 支持创建、读取、带 SHA-256 版本保存和删除；外部修改不会被静默覆盖。
- 网页采集不发送 Cookie 或 Authorization，禁止本机/私网目标并逐次校验重定向，限制类型、
  时限和正文大小；活动 HTML 被移除，来源元数据和正文摘要用于重复检测。
- `notes.search`、`notes.get` 和 `notes.create` 已作为受权限控制的 Chat/Pi Capability，
  继续使用 P4 的 Runtime Token、幂等和无正文审计。
- 附件限制为 5 MiB 和静态白名单格式，按 Note 存入 Vault；桌面预览经权限路由读取，
  Astro 保持标准 `public/attachments` 路径。
- 支持 Markdown 导入、包含附件的可读 JSON 备份导入导出，以及从 Markdown 重建
  `.zicode/index.json`；损坏文件和孤立附件只报告，不自动删除。
- 中英文内置帮助已增加 Notes 使用与安全说明。
- Notes 功能区改为笔记本父节点、笔记子节点的可折叠目录树，搜索和标签筛选结果仍保留
  笔记本归属，当前笔记在树内高亮。

已实现 P6 Finance 与 Artifacts：

- Finance 已作为内置应用在统一三栏 Shell 中显示，功能区按数据、分析和账户分组，主
  视图只显示当前页面；非 Finance Scene 继续 fail closed。
- QVeris Key、费用审计、市场快照、确定性回测、多因子筛选和模拟账本复用原服务，
  Scene 隔离边界没有因插件化放宽。
- Artifacts Host Store 提供场景隔离、1 MiB 内容上限、32 KiB 来源上限、SHA-256 完整性、
  `artifact:<uuid>` 句柄和乐观删除。
- Artifacts 应用支持搜索、类型与来源插件筛选、内容/来源查看和可读 JSON 导出；Finance
  成功快照、回测和选股会自动归档，归档失败不影响结果显示。
- 中英文内置帮助已增加 Artifacts，并说明 Finance 的统一界面与自动归档。

Developer View 已实现资源路径与大小校验、opaque sandbox iframe、限制性 CSP、
来源/通道/大小/并发消息校验，以及 Context、Dirty、通知、Own Command 和 Own
Capability API；`examples/plugins/view-demo` 已在真实 WebView2 桌面壳中通过显示与
交互验收。Developer Worker 已实现独立隐藏子进程、纯 JavaScript Capability/Command
注册、有界 stdio 协议和 5 秒强制超时；同一示例已通过 View→Host→Worker Capability
桌面端到端验收，Command 链路另有 Host、前端和 Worker 自动化验证。

Developer JavaScript Worker 仍只用于用户明确完全信任的本地开发包。签名包后台代码已
增加 WASI Preview 1 运行时：不继承目录、环境变量或网络，限制 64 MiB 内存、执行燃料、
1 MiB 输出，并由外层独立进程执行五秒超时终止。

签名插件包已实现逐文件 SHA-256、Ed25519 签名、发布者指纹首次信任、撤销、原子更新、
保留旧版本和显式回滚；Plugin Manager 提供安装签名包、回滚与撤销入口。打包脚本拒绝
Secret 常见文件、符号链接、Source Map 和越界内容。公共 Marketplace 仍保持关闭；
远程仓库和在线撤销同步需要独立服务、运营审核与端到端验收，不能由本地签名和 WASI
自动推导为已开放。

## 2026-07-31 产品路线图 M0–M6 完整实现

- Chat 模型失败卡增加一键重试与模型设置入口；后台任务在导航显示状态徽标，项目预算
  同时在发送前预估拦截和运行中按实际费用终止。
- Projects 使用工作区 `.zicode/project.json` 作为项目说明、默认场景和预算真相，聚合
  会话、根文件、Notes、Artifacts、活动与跨类型搜索。
- Tasks 接通真实 Runtime Abort、暂停后重新派发、取消、重试上限、成本上限、通知和
  会话跳转，不再只是修改显示状态。
- Knowledge 提供双链、反链、相似笔记、同标题/同来源冲突和可直接送入 Chat 的上下文包。
- Finance 增加研究卡片、正反证据、失效条件、来源、事件日历和组合集中度/缺失报价风险。
- Automation 增加手动、间隔和每日配方，项目目标、每次成本、审批、重试和运行历史；
  到期任务统一进入 Agent Inbox 权威任务队列。
- Notes 增加增量游标、删除墓碑和自动日志压缩；未知或过期游标返回 `resetRequired`。
- Notes 可在用户确认后使用固定 Astro 5.13.5 和随应用发布的 Bun 1.3.14 构建本地
  `dist/`，构建脚本白名单、五分钟超时和发布日志均已验证。
- Credential Broker、WASI 签名插件运行时、发布门禁和静态 i18n 覆盖测试已纳入门禁。

## 2026-07-31 产品路线图第一批实现

- 新增 Projects 内置应用，并同时登记到前端与 Rust Plugin Registry。项目工作区按当前
  Workspace/Scene 聚合 Notes 与 Artifacts，提供概览、最近成果和活动视图。
- 项目上下文支持项目说明、默认场景和会话预算；预算在发送模型请求前执行硬拦截，不只
  显示提醒。
- 新增 Tasks 内置应用，复用 Agent Inbox 的权威任务数据，统一显示运行、待输入、失败和
  完成状态，提供会话跳转、失败重试、取消和事件历史。
- 内置应用壳改为可扩展的 `builtinApps` 映射，后续 Knowledge、Automation 等应用不再
  继续增加硬编码分支。
- 模型选择器显示 QVeris/运行时返回的输入与输出单价，并在满足上下文窗口要求的模型中
  标记成本最低项。
- Notes 新增知识关系快照：从可读 Markdown 中解析 `[[双链]]` 与
  `zicode-note://notebook/note` 引用，生成反向链接；按共享标签计算相似笔记。关系与相似
  结果显示在项目工作区的“知识关联”视图中，不引入不可读的私有图数据库。
- 新增项目工作区、任务中心和模型路由单元测试；前端检查和 Rust 全量检查通过。

完整阶段依赖和验收见[产品化路线图 M0–M6](product-roadmap.md)。
设计文档入口见[应用插件平台总览](plugins/overview.md)和
[Notes 内置插件](plugins/notes.md)、[Artifacts 内置插件](plugins/artifacts.md)。

## 2026-08-01 移动端第七轮：安全局域网传输

- 远程访问配置独立保存且默认关闭；未知版本、CA 公钥/私钥任一缺失都会失败关闭。
- 稳定本地 CA 的私钥只进入系统凭据库，公开证书落入应用数据目录；当前私有网卡地址
  获得临时服务器证书，Rustls 固定加密 Provider，避免多 Provider 启动 panic。
- 启用并重启后启动 HTTPS/WSS 主监听；非回环 WebSocket 必须携带精确匹配的 HTTPS
  Origin，HTTP 数据路由继续要求配对设备令牌。
- 独立 HTTP 引导监听只提供双语安装说明和公共 CA 证书，要求与桌面设置核对指纹；主
  应用和 API 不从引导端口提供。
- 会话二维码改为五分钟一次性配对链接；设置页显示开关、运行/待重启状态、HTTPS 地址、
  手机信任地址、CA 指纹和已配对设备。
- 自动化验证包括默认关闭与配置版本、CA 半缺失失败关闭、证书轮换指纹稳定、精确
  Origin、真实 CA 信任 HTTPS 往返、设备鉴权/撤销和移动设置交互。

## 2026-08-01 移动端第八轮：首次连接、PWA 与恢复体验

- 手机信任页从内联占位页拆成独立 Rust 模块，自动识别 Android 与 iPhone/iPad，提供
  分平台证书步骤、指纹复制、数据边界说明和完成后的桌面扫码提示。
- 远程客户端新增网络状态组件：断网时说明会自动恢复，WebSocket 尚未握手或正在重连时
  显示连接状态，恢复后自动隐藏；桌面客户端不创建该界面。
- HTTPS 非回环入口可注册最小 Service Worker，导航失败时显示独立离线页；Service
  Worker 不缓存应用数据、Host API 或认证令牌。
- Web App Manifest 增加作用域、稳定 ID、192/512 PNG 图标和 maskable 声明；Android
  接入浏览器安装提示，iOS 提供 Safari 添加到主屏幕说明；冷启动从本地保存且严格校验
  的最近会话路径恢复，不保留配对查询参数。
- 中英文 Help 增加“手机访问与安装”章节，覆盖证书、配对、主屏幕安装、断网恢复和撤销。
- 自动化覆盖远程/桌面隔离、离线/重连状态、Android 安装事件、iOS 指引、Service
  Worker 注册边界和证书页面；系统证书信任与后台恢复仍等待 Android/iOS 真机验收。

## 2026-08-01 移动端第九轮：锁屏与前台恢复

- `HostRuntimeAdapter.reconnectNow()` 可安全替换移动浏览器后台冻结后可能陈旧的连接，
  并在新握手后恢复原目标订阅。
- 网络重新上线、页面重新可见和 BFCache 恢复会触发主动恢复；处于连接建立阶段时忽略
  重复事件，避免同一轮唤醒制造多条 WebSocket。
- 远程鉴权被撤销后 `reconnectNow()` 保持失败关闭，生命周期事件不能重新启动连接。
- 自动化覆盖陈旧连接替换、订阅恢复顺序、重复恢复事件、监听器清理和撤销后不重连。

## 2026-08-01 移动端第十三轮：系统返回手势与历史同步

- 新增可复用的同路由移动历史层，保留已有 `history.state`；“更多”应用面板和功能区
  抽屉打开时各自进入一层历史，系统返回只关闭最上层，手动/程序化关闭会正确消费或
  丢弃哨兵状态。
- 用户从底部导航切换应用时写入应用历史；`popstate` 恢复对应应用。设置 Hash 更新保留
  应用状态，不再把返回目标覆盖为 `null`。
- 会话历史返回新增权威路由判定：同工作区切换目标 Session 且不重复 push，跨工作区
  reload 当前历史 URL，避免地址栏已后退但主视图仍显示旧会话。
- Edge 应用内浏览器在 312×675 内容视口验证：“更多”返回一次关闭；切到笔记后第一次
  返回关闭功能区，第二次返回恢复对话，路径始终留在应用内且控制台无错误。

## 2026-08-01 移动端第十四轮：手机拍照与附件处理

- 手机“添加图片”使用底部操作面板区分系统拍照与相册选择；桌面端保留直接打开多选
  文件选择器的原交互。面板支持安全区、焦点循环、Esc、遮罩和系统返回分层关闭。
- 图片处理队列公开忙碌状态，解码和 2048px 有界压缩期间显示“正在处理图片”并禁用
  发送；提交函数仍显式等待队列，避免 Enter 等路径绕过按钮互锁。
- 图片读取失败不再只写控制台，而是显示本地化可恢复错误；触屏预览放大并持续显示
  40px 移除目标，动态文案和可访问名称跟随中英文切换。
- Edge 应用内浏览器在实际 312×675 内容视口验证：操作面板约 296×117px、无页面级
  横向溢出；系统返回只关闭面板、恢复“添加图片”焦点并留在当前路径，控制台无错误。
- 自动验证：110 个测试文件、474 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第十五轮：后台任务完成提醒

- 常规设置新增仅远程客户端可见的“移动端 → 任务完成提醒”开关；权限只在用户点击时
  请求，拒绝、浏览器阻止和 iOS 未安装到主屏幕都有本地化说明，桌面端保持隐藏。
- 前台与后台 Runtime 事件共用会话键跟踪运行任务，`agent_settled` / `agent_end` 去重；
  页面可见时不通知，Service Worker 等待期间用户返回前台也会取消迟到提醒。
- 通知使用固定隐私文案，不包含提示词、模型回答、文件名或工作区数据；点击提醒优先
  聚焦已有窗口，没有窗口时只打开通过严格正则校验的会话路径。
- 自动化覆盖显式授权、偏好持久化、后台完成单次通知、前台静默、迟到取消、桌面隔离和
  Service Worker 点击恢复边界；中英文 Help 与移动实现档案同步。
- Edge 应用内浏览器在实际 312×675 内容视口验证：开关为 48×40px，设置区完整位于
  首屏，启用后的选中状态和隐私说明同步，页面无溢出且控制台无错误；1024×640 桌面
  内容视口回归正常。
- 自动验证：111 个测试文件、483 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。
- 文档明确区分运行边界：Pi 上游可在 Android Termux 中独立运行，但 ZiCode 当前移动端
  仍连接桌面 Host；iOS 尚无对应的本机 Pi 运行方式。

## 2026-08-01 移动端第十六轮：回答系统分享

- 支持 Web Share API 的客户端在 Pi 回答下方显示本地化分享操作；仅分享可见回答，
  排除思考过程、工具调用和凭据。系统分享面板取消保持静默，调用失败则自动复制并显示
  “已复制”，复制也失败时显示“分享失败”。
- 回答的复制、存笔记、分享以及用户消息的分叉操作，在宽度不超过 768px 或粗指针设备上
  统一使用至少 40×40px 触控目标；桌面端保持紧凑操作栏。
- Edge 应用内浏览器在实际 312×675 内容视口验证三个回答操作均为 40×40px、完整同行、
  页面无横向溢出；分享交互传入的文本与可见回答一致，控制台无错误。1024×640 桌面
  内容视口回归保持正常。
- 自动化覆盖静态回答、流式完成、无 API 隐藏、取消静默和失败复制回退；中英文 Help 与
  移动实现档案同步。
- 自动验证：111 个测试文件、489 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第十七轮：Android 系统分享接收

- Web App Manifest 增加 POST `share_target`，Android 已安装 PWA 可接收系统分享的
  标题、文本和网页地址；分享内容进入当前 Composer、保留已有草稿并始终等待用户确认，
  不会自动发送。
- Service Worker 对字段长度设限，使用带时间戳的 UTF-8 Base64 负载生成 `no-store`、
  严格 CSP、禁止引用来源和 `nosniff` 的本地落地页；正文不进入 URL、日志、Cache API
  或长期存储。
- 落地页只恢复严格校验的最近会话路径；负载仅暂存在标签页 `sessionStorage`，应用在解析
  前先删除原值，并拒绝超过十分钟、未来时间、空白或损坏内容，失败时显示本地化提示。
- Edge 应用内浏览器通过真实 multipart POST → Service Worker → 安全会话重定向验证：
  312×675 内容视口保留原草稿、预填完整分享、聚焦输入框且 URL 无正文；页面无横向溢出、
  控制台无错误。1024×640 桌面内容视口回归正常。
- Android/iOS 系统分享目标的可见性与交付仍等待真机验收；iOS Web Share Target 支持
  取决于系统和浏览器，不作为当前承诺能力。
- 自动验证：112 个测试文件、495 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第十八轮：Android 系统分享图片

- Manifest 在既有 POST Web Share Target 中增加 PNG/JPEG/GIF/WebP 图片字段；Service
  Worker 按实际 MIME/扩展名、最多四张、单张 8 MB 和总计 12 MB 重新校验，拒绝项不会
  丢弃同一次分享中仍有效的文字或图片。
- 有效 Blob 进入 UUID 标识、十分钟时效的一次性 IndexedDB 收件箱，不进入 URL 或
  Cache API。Service Worker 激活和新分享会清理遗留项；应用读取目标记录时先删除，再
  交给现有 2048px 压缩、预览、移除和发送等待链。
- 图片收件箱五秒无响应会降级为本地化错误且不阻塞应用启动；部分失败显示“部分分享图片
  无法添加”，现有草稿和可读取内容继续保留，所有分享仍需用户确认后才发送。
- Edge 应用内浏览器在 312×675 内容视口通过真实 multipart 图片导航验证：安全 URL 无
  文件名、正文或令牌，原草稿与说明保留，生成一张本地化预览并聚焦输入框，控制台无错误；
  刷新后内容不再出现。1024×640 桌面内容视口回归无溢出。
- Android/iOS 系统级文件分享可见性仍等待真机验收；Web Share Target 本身不是跨浏览器
  Baseline 能力，iOS 不作为当前承诺平台。
- 自动验证：113 个测试文件、502 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第十九轮：加密未发送草稿恢复

- 仅远程手机客户端启用按 Workspace/Session 隔离的文字草稿恢复；停止输入 250ms 后，
  使用浏览器生成的不可导出 AES-GCM 256 位密钥、随机 96 位 IV 和会话附加认证数据加密，
  密钥与密文保存到同源 IndexedDB，不写入 Host 会话或云端。
- 草稿最多 32,768 字符、七天过期；损坏、过期和未来时间异常记录自动删除，存储三秒
  超时静默降级。恢复不会覆盖读取期间的新输入，并显示“已恢复此设备上的未发送草稿”。
- 常规会话切换保存旧稿、清空旧图片并恢复目标稿；临时会话升级正式 ID 时迁移草稿而不
  清空输入。提交成功删除，失败继续保留；等待提交期间产生的新文字不会被成功清理误删。
- Edge 应用内浏览器在 312×675 内容视口验证真实 IndexedDB/CryptoKey：94 字节密文无
  原文片段、密钥不可导出；reload 恢复并聚焦，会话间不串稿，发送成功后 reload 不再恢复。
  1024×640 桌面回归无溢出，控制台无错误。
- 第十九轮当时只恢复文字；该限制已由下一轮图片草稿恢复解除。Android/iOS PWA 进程回收后的
  实际保留行为仍需要真机联合验收。
- 自动验证：115 个测试文件、509 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十轮：加密图片草稿恢复

- 远程手机客户端把已处理、尚未发送的图片加入现有 Workspace/Session 草稿恢复；刷新、
  PWA 进程回收和会话切换可恢复图片预览，图片-only 草稿同样有效，且不会自动发送。
- 文字与图片使用同一不可导出 AES-GCM 设备密钥，但分别写入独立密文记录。普通输入只更新
  小型文字密文，新增、移除或替换附件时才重写图片，避免每次输入都重新加密大图。
- 图片恢复限制为最多四张、单张解码后 8 MB、合计 12 MB，只保留最近三个含图片会话并在
  七天后清理。超过限制的图片仍留在当前 Composer，但显示本地化提示，明确重启后需重选。
- 恢复读取期间若用户已输入文字或添加图片，旧快照不会覆盖新内容；临时会话升级正式 ID
  会迁移文字和图片，提交成功一并删除，失败恢复，等待提交时产生的新附件继续保留。
- Edge 应用内浏览器在实际 312×675 内容视口验证一张 PNG 与 15 字中文草稿：文字与图片
  分别形成 61/182 字节密文，密钥不可导出且密文无图片 Base64 原文；reload 恢复预览、
  聚焦输入框且无横向溢出，清除后再次 reload 不再恢复。1024×640 桌面视口回归正常，
  页面控制台无错误；临时 QA Host、页面和日志均已清理。
- Android/iOS 进程回收后的图片恢复与实际存储配额行为仍需真机联合验收。
- 自动验证：115 个测试文件、515 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十一轮：断线待发送确认

- 仅远程手机客户端在 Host 未连接时拦截 Composer 提交：保留当前文字和图片，不创建
  Runtime 请求，先刷新现有加密草稿，再保存一个按 Workspace/Session 隔离的加密待发送
  标记；存储失败时保持输入并显示友好错误。
- 待发送标记不重复保存提示词，24 小时过期；底层草稿仍按七天规则保留。临时会话升级会
  同步迁移标记，成功提交和清除站点数据会删除，取消待发送只删除标记而保留草稿。
- 重连后 Composer 上方显示“可以发送”确认条，但不自动请求模型。用户必须选择“立即发送”；
  也可以“保留为草稿”。断线期间主发送按钮的 title/aria-label 明确变为“保存草稿，等待重连”。
- 确认条按当前会话恢复并清除孤立标记；连接变化、异步会话切换和发送中状态均有竞态保护，
  桌面客户端保持原行为。
- Edge 应用内浏览器在实际 312×675 内容视口验证：断线提交产生 85/54 字节的草稿/标记
  密文，未发现原文且 Runtime 请求数为 0；reload 恢复全文、输入焦点和确认条，模拟重连后
  请求数仍为 0，点击“立即发送”后才变为 1 并清空密文。页面无横向溢出、控制台无错误，
  1024×640 桌面视口回归正常；临时 QA Host、页面和日志均已清理。
- Android/iOS 锁屏、切网与进程回收组合下的确认条恢复仍需真机联合验收。
- 自动验证：116 个测试文件、521 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十二轮：iOS 可见视口与软键盘

- Composer 获得焦点且 Visual Viewport 高度缩小至少 100px 后，布局层计算可见区域的
  `offsetTop` 与底部遮挡量；Header、Composer 和消息滚动安全区使用同一组动态边界，
  输入区不再只依赖布局视口的 `bottom: 0`。
- 新增 Visual Viewport `scroll` 监听并与 `resize`、焦点、元素尺寸变化逐帧合并；iOS
  因地址栏或输入焦点平移页面时会继续更新。失焦与销毁会恢复导航、清除变量和监听器。
- Edge 应用内浏览器在实际 312×675 内容视口模拟高 430px、顶部偏移 48px 的可见区域：
  Composer 底边为 478px、Header 顶边为 48px、底部导航隐藏且消息安全区为 325px；
  平移到 76px 后 Composer 底边更新为 506px，关闭后全部恢复。页面无横向溢出和应用
  控制台错误，1024×640 桌面回归正常；临时 QA Host 与测试页已清理。
- Android/iOS 真机键盘、第三方键盘、浏览器缩放与分屏组合仍需联合验收。
- 自动验证：116 个测试文件、522 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十三轮：长对话滚动锚定

- 布局层复用 100px“接近底部”阈值并监听消息容器滚动；键盘、导航、附件预览或 Composer
  尺寸变化前若用户位于末尾，更新完成后使用即时滚动保持最新消息可见。
- 每一帧开始前冻结底部意图，浏览器因隐藏导航或改变容器高度而产生的中间滚动事件不会
  把锚定误判为历史阅读；全局平滑滚动样式不再让布局修正缓慢追赶键盘动画。
- 用户主动上滚后只更新安全区并保留原 `scrollTop`，不会因键盘变化或流式回答被强制拉回
  底部；布局销毁时同步移除滚动监听。
- Edge 应用内浏览器在实际 312×675 内容视口验证 28 轮长对话：底部状态打开键盘后距
  末尾 1px、Composer 底边 478px；历史阅读状态在键盘前后均保持 `scrollTop=240`。
  页面无横向溢出和应用控制台错误，1024×640 桌面长对话回归正常；临时 QA 资源已清理。
- Android/iOS 真机惯性滚动、第三方键盘与流式输出组合仍需联合验收。
- 自动验证：116 个测试文件、524 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十四轮：可操作的最新消息入口

- 将原先不可点击的“新消息”提示替换为原生按钮；用户上滚后收到新回答时显示“最新消息 ↓”，
  点击、触摸或键盘激活后平滑回到会话末尾并自动隐藏。
- 按钮和会话导航点补齐中英文可访问名称，并在语言切换时即时重建；销毁导航器时同步移除
  点击和语言事件监听，避免重复挂载。
- 移动端触控高度至少 40px，右侧位置包含安全区，底部位置沿用消息安全区以避开 Composer。
- Edge 应用内浏览器在实际 312×675 内容视口验证 24 轮长对话：按钮高 40px、距输入区
  32px，点击后距末尾约 0.2px 并隐藏；1024×640 桌面状态稳定后按钮高 28px。两种视口
  均无横向溢出；临时 QA 资源已清理。
- Android/iOS 真机惯性滚动、屏幕阅读器和软键盘联动仍需联合验收。
- 自动验证：116 个测试文件、526 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十五轮：新回答播报与动态效果偏好

- 新增独立的礼貌级别实时状态区；用户上滚时收到新回答会播报本地化操作说明，到达末尾、
  即时跳转或销毁导航器后清空，避免屏幕阅读器重复读取过期提示。
- “最新消息”按钮文字、可访问名称、实时播报和对话圆点标签均随语言切换即时更新。
- 会话圆点和“最新消息”跳转共同遵循系统减少动态效果偏好；开启时全部使用即时定位。
- 正常模式下不超过两个消息视口的跳转保持平滑，更长距离改为即时完成，避免长对话滚动
  数秒且入口提前隐藏；平滑跳转期间入口保留到真正到达末尾。
- Edge 应用内浏览器在实际 312×675 内容视口验证 24 轮长对话：实时状态语义和中文播报
  正确，按钮高 40px、距输入区 32px；约 2144px 的跳转在 150ms 内到达末尾并清空状态。
  1024×640 桌面回归按钮稳定高度 28px，长距离跳转后距末尾约 0.5px。两种视口均无横向
  溢出或应用控制台警告/错误；临时 QA 资源已清理。
- Android/iOS 真机 VoiceOver/TalkBack 的实际播报顺序、触摸探索与返回手势仍需联合验收。
- 自动验证：116 个测试文件、528 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十六轮：最新回答焦点交接

- 用户显式激活“最新消息”后，焦点在即时跳转完成时或短距离平滑滚动真正抵达末尾时转移
  到最新回答，避免按钮隐藏后键盘和屏幕阅读器焦点丢失。
- 最新回答只在聚焦期间临时获得 `tabindex=-1`，焦点离开后自动清理，不污染常规 Tab
  顺序；普通手动滚动到底部不会请求焦点，因此不会抢走当前控件。
- 未完成的平滑跳转焦点请求两秒后自动失效，导航器销毁时同步取消，避免中断滚动后延迟
  抢焦点。
- Edge 应用内浏览器在实际 312×675 内容视口验证 24 轮长对话：激活入口后距末尾约
  0.2px，焦点落在最新回答，按钮和播报清除；切换到其他控件后临时 `tabindex` 被移除。
  1024×640 桌面回归距末尾约 0.5px，焦点交接一致。两种视口均无横向溢出或应用控制台
  警告/错误；浏览器客户端一次 Statsig 队列告警与页面无关，临时 QA 资源已清理。
- Android/iOS 真机 VoiceOver/TalkBack 的焦点朗读、虚拟光标和触摸探索仍需联合验收。
- 自动验证：116 个测试文件、529 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十七轮：应用导航语义与历史稳定性

- 应用栏使用标准 `nav + button + aria-current` 语义，移除无对应面板、无方向键模型且
  “文件”跨出容器的 `tablist/tab/aria-selected`；移动和桌面读屏均按应用导航理解。
- 次级应用激活时，可见“更多”同步获得 `aria-current=page`，辅助名称显示“更多：设置”
  等具体当前页；切回一级入口后清理。自动定位遵循系统减少动态效果偏好。
- 修复从“更多”选择设置等次级应用后被菜单历史 `back()` 弹回对话：目标应用激活前以
  replace 方式丢弃菜单临时历史，后续系统返回仍回到前一应用。
- Edge 应用内浏览器在实际 312×675 内容视口验证五个入口高 56px、设置不会回弹且系统
  返回恢复对话；675×312 横屏五个入口宽约 130px，更多面板在 32–244px 内部滚动；
  1024×640 桌面导航宽 52px。所有视口均无横向溢出，页面日志为空；浏览器客户端 Statsig
  遥测超时与页面无关，临时 QA 资源已清理。
- Android/iOS 真机系统返回边缘手势、VoiceOver/TalkBack 当前项朗读仍需联合验收。
- 自动验证：116 个测试文件、530 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十八轮：长对话渐进呈现

- 长会话切换不再同步创建整段历史 DOM：手机/远程客户端先渲染最近 60 条记录，桌面端
  先渲染最近 120 条，并从完整用户轮次边界开始；会话数据、工具结果索引和状态恢复仍使用
  完整来源，不裁剪持久化内容。
- 顶部“加载更早消息”逐批扩展历史，并用新增高度补偿保持当前阅读锚点；中间批次恢复
  按钮焦点，最后一批切换到可聚焦 `role=status`，避免按钮消失造成焦点丢失。
- 会话搜索在高亮前自动展开完整历史；磁盘快速历史被 Pi 权威快照替换时保留用户已经
  展开的范围。中英文帮助和独立阶段档案同步。
- Edge 应用内浏览器以 300 条合成长历史验证：312×675 内容视口首屏为 60 条记录、
  40 个消息节点和 20 个工具卡，同步渲染约 5.1ms；完整历史为约 45.9ms。逐批加载保持
  滚动位置，搜索直接命中最早批次，最终状态获得焦点；1024×640 桌面回归正常，均无
  横向溢出或应用日志。
- 真实超长 Markdown、图片历史以及低内存 Android/iOS 设备峰值仍需真机联合验收。
- 自动验证：117 个测试文件、535 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第二十九轮：安装提示与 PWA 更新生命周期

- Android“暂不”和 iOS“知道了”统一为七天冷却，不再永久关闭或每次启动重复提示；
  过期时间戳、历史永久标记和安装成功状态均有明确清理规则。
- 安装卡隐藏后恢复此前控件、当前应用导航或主内容焦点，临时主内容焦点属性在离焦后清理。
- Worker 注册禁用 HTTP 缓存复用；手机从后台或 BFCache 恢复时按一小时节流主动检查更新，
  不强制刷新当前对话，注册/更新失败也不阻断连接恢复。
- 中英文帮助同步说明七天冷却、手动安装入口和非打断式更新行为。
- Android/iOS 的实际安装事件、系统提示频率和 Worker 更新调度仍需真机联合验收。
- Edge 应用内浏览器在实际 312×675 内容视口验证安装卡位于安全区、操作高 40px；确认
  后焦点恢复、冷却写入，模拟八天后重新显示。1024×640 桌面卡片宽 380px。两种视口
  均无横向溢出或应用日志，临时 QA 资源已清理。
- 自动验证：118 个测试文件、542 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次
  Rust 门禁仍为 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第三十轮：本地草稿存储保护

- 远程手机客户端在常规设置中显示“保护本地草稿”，先读取浏览器持久存储状态和可用的
  用量/额度；桌面客户端不显示该设置。
- 仅在用户点击后调用浏览器 `persist()`。已保护、拒绝、不支持和读取失败均使用独立、
  本地化且诚实的状态，不把浏览器拒绝误报为成功，也不在后台静默触发请求。
- 获得保护只阻止浏览器因空间压力自动回收当前 Origin；清除站点数据、重置浏览器或卸载
  并删除数据仍会删除草稿和设备密钥。现有 AES-GCM 加密、七天过期和容量限制保持不变。
- 页面回到前台重新查询状态，语言切换即时更新；销毁后忽略迟到异步结果。中英文帮助同步
  说明权限边界和无上传行为。
- Edge 应用内浏览器在实际 312×675 内容视口验证设置卡宽约 288px、按钮高 40px、授权后
  显示禁用“已保护”和 3.0 MB/64 MB 用量，且无横向溢出；1024×640 宽屏布局正常，模拟
  桌面客户端时整段隐藏。两种视口应用日志为空，临时 QA 资源已清理。
- 自动验证：119 个测试文件、547 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- 浏览器真实授予策略、额度和系统清理行为仍需 Android/iOS 真机联合验收。

## 2026-08-01 移动端第三十一轮：最近会话持续恢复

- 修复最近会话路径只在移动端启动时写入一次：安全远程客户端持续跟踪同页 History 更新、
  系统返回、BFCache 和前台恢复，切换会话或临时 ID 绑定正式 ID 后立即更新冷启动目标。
- 设置、帮助和插件页面不会覆盖最后有效会话；只允许与应用路由一致的受限 Workspace 与
  Session ID，查询参数、片段、配对令牌和异常路径段都不会进入记录。分享目标校验同步收紧。
- 销毁时恢复原 History 方法并移除监听器，且不会覆盖组件安装后由其他代码再次替换的方法。
  中英文帮助同步说明更新时机和隐私边界。
- Edge 应用内浏览器在实际 312×675 内容视口完成会话 A → B → 正式 ID → 设置 → 冷启动
  链路，最终恢复正式会话且无令牌/片段，四个操作均高 40px、页面无横向溢出；1024×640
  宽屏卡片宽 720px。两种视口应用日志为空，临时 QA 资源已清理。
- 自动验证：119 个测试文件、550 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 被系统实际终止后的主屏幕冷启动与系统返回手势仍需真机联合验收。

## 2026-08-01 移动端第三十二轮：主屏幕安装身份与主题系统栏

- Manifest 安装名从 “ZiCode Studio Desktop” 修正为 “ZiCode Studio”，描述改为手机安全
  伴侣语义，默认启动底色/主题色对齐明亮白色；iOS 增加明确的 192px PNG touch icon。
- 现有品牌图标的重要内容不在 maskable 中心安全区内，撤销不真实的 `any maskable`，三项
  图标只声明 `any`，避免 Android 厂商遮罩裁掉“Zi”。实验性 `launch_handler` 不进入生产。
- 六套主题映射各自背景色；切换主题时同步更新 `theme-color`，减少手机浏览器和独立 PWA
  状态栏残留旧品牌色。中英文 Help 增加安装缓存刷新和重新安装说明。
- Edge 应用内浏览器在实际 312×675 内容视口读取生产 Manifest：名称、三项 `any` 图标和
  touch icon 正确；三种主题按钮高 40px，纯黑主题页面与元数据均为 `#000000`，无横向溢出。
  1024×640 宽屏卡片宽 720px、按钮高 32px，两种视口应用日志为空，临时 QA 资源已清理。
- 自动验证：119 个测试文件、552 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 安装确认文案、Launcher/SpringBoard 图标缓存和真实系统栏着色仍需真机验收。

## 2026-08-01 移动端第十二轮：可恢复的离线冷启动

- PWA 离线页从静态 reload 按钮升级为独立恢复状态机：区分手机断网、正在检查、手机
  在线但桌面不可达和 Host 已恢复；联网或回到前台后立即检查，之后以五秒有界间隔重试。
- `/health` 探测使用 `no-store`、同源凭据和四秒中止上限，只访问本机 ZiCode Host；
  Host 恢复后 reload 原导航 URL，因此主屏幕冷启动会回到原会话路径而非离线页路径。
- Service Worker 缓存版本升级，离线 HTML、恢复模块和入口模块作为完整原子资源集预缓存；
  不缓存会话、API 响应、设备令牌或模型数据。
- 离线页按浏览器语言只显示中文或英文，包含连接检查清单、实时状态和 44px 主操作，
  支持安全区、暗色主题、焦点样式和减少动态效果。
- Edge 应用内浏览器在 312×675 内容视口验证卡片完整位于首屏、无横向或纵向溢出；
  模拟 Host 恢复后自动返回原 `/app/chat`，控制台无错误。
- 自动验证：108 个测试文件、462 个前端测试通过；Biome、设计规范、Tauri 权限、
  Windows 子进程策略、MkDocs strict 和补丁空白检查通过。

## 2026-08-01 移动端第十一轮：可操作的重连恢复

- 远程手机连接在短暂断线时继续自动恢复；连续重连约八秒后升级为明确的耗时过长提示，
  并提供 40px 高的“重试”按钮。手动重试、网络恢复、回到前台或 BFCache 恢复都会
  清理旧计时并立即替换连接。
- 联网失败、持续重连和连接恢复三种状态各自清理计时器；组件销毁后不遗留监听器或
  定时任务。中英文动态文案和 Help 已同步。
- 修复安装提示卡片的 `hidden` 被组件 `display:flex` 覆盖的问题；不满足安装条件时，
  卡片现在完全退出渲染树与可访问树。
- Edge 应用内浏览器在 312×675 内容视口验证状态条宽约 288px、重试按钮高 40px、
  页面无横向溢出；点击按钮会触发一次主动重连并回到普通重连状态，控制台无错误。

## 2026-08-01 移动端第十轮：安全双步骤二维码

- “在手机上打开”弹窗区分“首次设置”和“打开当前对话”：前者生成证书安装二维码并
  显示 CA 指纹与引导地址，后者按需签发五分钟一次性配对链接。
- 会话二维码显示实时倒计时，过期后停止计时并提供显式刷新；切换步骤会丢弃迟到响应，
  关闭弹窗会清理计时器并恢复触发按钮焦点。
- `/v2/lan-qr` 现在校验真实连接对端必须是回环地址。已配对手机即使持有有效设备令牌
  也无法签发新的二维码凭据，远程客户端同时隐藏桌面二维码按钮。
- 中英文 Help、移动实现说明和安全 ADR 已同步；自动化覆盖双模式、过期刷新、远程隐藏
  和回环签发边界。
- Edge 应用内浏览器在 312×675 内容视口验证：首次设置卡片宽约 296px、高约 519px，
  CA 指纹稳定分成两行，卡片和页面均无横向溢出；1024×640 桌面内容视口保持 360px
  卡片宽度，控制台无错误。
- 当前工作树的 `bun run test`、`bun run check`、`bun run check:rust`、MkDocs strict 和
  `git diff --check` 均通过；Rust 104 个测试通过、1 个按约定忽略。

## 2026-08-01 移动端第三十三轮：长对话图片按需加载

- 审计确认根布局和主要长列表已有滚动链隔离，未增加可能影响 iOS 内部滚动的重复锁定。
- 历史附件与 Markdown 图片增加原生懒加载、异步解码和 `no-referrer`；视口外图片接近可见
  区域时再加载、解码，外部图片请求不携带 ZiCode 页面来源。
- Composer 当前图片预览和打开的大图查看器保持即时加载；中英文 Help 说明资源、隐私与
  离线边界。
- Edge 应用内浏览器在实际 312×675 与 1024×640 内容视口通过两类生产渲染路径验证；
  图片属性正确，滚动区与页面无横向溢出，应用日志为空，临时 QA 资源已清理。
- 自动验证：119 个测试文件、554 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- 远端图片弱网表现、超长图片历史峰值和 Android/iOS 图片解码内存仍需真机联合验收。

## 2026-08-01 移动端第三十四轮：可操作的 Pi 任务进度

- Pi 任务镜像的紧凑标题改为真实按钮；手机触摸、键盘与屏幕阅读器可以展开/收起，按钮
  暴露完成比例、`aria-expanded` 和唯一 `aria-controls`。
- 收起详情同时使用 `aria-hidden` 和 `inert`，避免视觉隐藏后仍进入辅助导航；动态刷新、
  `/todos` 展开和语言切换均同步更新当前状态。
- 手机按钮高 40px，展开内容避开左右安全区并限制滚动高度；长任务显示两行，粗指针粘滞
  悬停不会阻止收起。桌面保留悬停预览和点击固定展开。
- 任务标题、状态、完成比例、剩余数量和辅助名称完成中英文本地化；历史附件替代文本也使用
  当前语言。中英文 Help 同步说明交互与无障碍边界。
- Edge 应用内浏览器在实际 312×675 内容视口验证 132px 紧凑面板与 280×245px 展开面板，
  七项任务正确显示五项和剩余数量；1024×640 桌面展开宽 420px。两种视口无横向溢出、
  错误覆盖层或应用日志，临时 QA 资源已清理。
- 自动验证：119 个测试文件、555 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- TalkBack/VoiceOver 的真实朗读、触摸探索与系统返回联动仍需 Android/iOS 真机验收。

## 2026-08-01 移动端第三十五轮：宽表格与代码复制恢复

- Markdown 宽表格改为可聚焦、具名的滚动区域；手机触摸与外接键盘方向键都能横向阅读，
  表格和代码滚动链不会把整个页面带动或撑宽。
- 代码复制按钮在手机上达到 40px，提供本地化名称和礼貌状态播报；长语言标签省略显示，
  不挤压操作。
- 成功显示“已复制”后恢复；剪贴板权限拒绝或 API 缺失会显示持续五秒的“复制失败”和权限
  建议，Promise 失败被捕获，不产生无响应或控制台异常。
- 中英文 Help 说明滑动、外接键盘、复制反馈与权限恢复方式；所有新增动态文案进入翻译覆盖。
- Edge 应用内浏览器在实际 312×675 内容视口验证 279/551px 表格与 279/702px 代码滚动区、
  40×40px 复制按钮、方向键滚动和成功/拒绝反馈；1024×640 桌面内容在 747px 内适配。
  两种视口无页面横向溢出、错误覆盖层或应用日志，临时 QA 资源已清理。
- 自动验证：119 个测试文件、559 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 真机的惯性横向滑动、外接键盘焦点环和系统剪贴板权限文案仍需联合验收。

## 2026-08-01 移动端第三十六轮：工具卡片触控与错误恢复

- 实时与历史工具卡片共用真实展开按钮，`aria-expanded`、`aria-controls`、正文 `hidden`
  和箭头状态在触摸、键盘、自动展开及批量操作中保持同步。
- 辅助名称只读工具名与展开/收起动作；长命令和路径在标题省略、在展开参数保留。失败工具
  自动展开错误详情。
- 手机标题与复制按钮均为 40px，复制按钮不依赖悬停；输出和差异区限制为 38dvh 并内部滚动。
- 实时与历史输出复制统一捕获 API 缺失和权限拒绝；成功显示绿色可见反馈，失败显示五秒红色
  权限建议，并同时使用礼貌状态播报。已移除历史卡的 `execCommand` 回退。
- 待处理、运行中、完成、错误、复制和展开文案完成中英文本地化；中英文 Help 同步操作说明。
- Edge 应用内浏览器在实际 312×675 内容视口验证 40px 触控、错误自动展开、成功/拒绝反馈
  和零横向溢出；1024×640 桌面用 Enter 展开并保持焦点，卡宽 748px。两种视口无应用日志，
  临时 QA 资源已清理。
- 自动验证：120 个测试文件、566 个前端测试通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 真机 TalkBack/VoiceOver 的动态状态播报、触摸探索和长输出惯性滚动仍需验收。

## 2026-08-01 移动端第三十七轮：Notes 窄屏编辑工具栏

- Notes 编辑器的编辑/预览与四个文档操作在手机和粗指针横屏下改为两列网格，不再由单行
  flex 把主视图撑宽；按钮至少 40px 高，长标签可换行。
- Markdown 编辑区使用动态视口高度，在横屏与软键盘场景不再强制 320px 最小高度。
- 两个控制组获得本地化辅助名称；编辑和预览按钮通过 `aria-pressed` 暴露当前状态，触摸、
  Enter 和空格使用同一按钮行为。
- Edge 应用内浏览器在实际 312×675 内容视口确认六个按钮均为 140×40px、页面宽 312px
  且无横向溢出；预览切换、正文编辑、保存启用及成功后复位均通过。1024×640 桌面功能区
  树、主视图和键盘激活回归通过，两种视口均无应用日志，临时 QA 资源已清理。
- 自动测试维持 120 个文件、566 项；新增断言覆盖控制组名称与视图状态。Biome、设计规范、
  Tauri 权限、Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，
  最近一次 Rust 门禁仍为 104 个测试通过、1 个按约定忽略。
- Android/iOS 真机软键盘、TalkBack/VoiceOver 触摸探索和横屏分屏仍需联合验收。

## 2026-08-01 移动端第三十八轮：统一触控表单与 Automation 创建修复

- 手机和粗指针横屏下，普通/设计系统按钮至少 40px 高，图标按钮为 40×40px；单行输入、
  下拉框及复选框/单选框标签至少 40px，多行及单行表单字号至少 16px，避免 iOS 聚焦缩放。
- 桌面端不受移动规则影响，继续使用 32px 高、14px 字号的紧凑控件。
- 修复 Automation 创建表单无响应：提交逻辑改为直接读取 input、textarea 和 select 的值，
  不再错误查询控件内部不存在的同类节点。
- 新增“填写表单 → 提交 → 新规则卡片出现”的自动化测试，以及移动控件基线契约测试。
- Edge 应用内浏览器在实际 312×675 内容视口确认按钮、字段和审批标签均为 40px，表单字号
  16px、零横向溢出；创建后卡片数由一变二且表单清空。桌面实际内容宽 819px 保持 32px/
  14px 密度，两种视口页面身份、内容、错误覆盖层和应用日志检查通过。
- 自动验证为 120 个测试文件、568 项通过；Biome、设计规范、Tauri 权限、Windows 子进程
  策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 真机聚焦缩放、系统字体放大、触摸探索与横屏软键盘仍需联合验收。

## 2026-08-01 移动端第三十九轮：Automation 持续标签与窄屏宽度

- 名称、目标项目、任务说明、计划、单次费用和最大重试次数改为原生 `label` 包裹的持续
  可见字段；placeholder 不再是唯一说明，点击文字和辅助技术名称均关联正确控件。
- 手机断点移除 Automation 主内容重复的 16px 内边距，保留外层安全区与卡片边界。
- Edge 应用内浏览器实际 312×675 内容视口中表单宽 280px、字段宽 239px，较前一轮增加
  32px；六个标签在填写后继续显示，创建成功后卡片出现、表单清空且无横向溢出或应用日志。
- 桌面实际内容宽 819px 时表单/字段宽 475/434px，控件保持 32px/14px，功能区与主视图
  布局无回归。
- 自动测试维持 120 个文件、568 项；新增六个字段标签及 select 原生关联断言。Biome、
  设计规范、Tauri 权限、Windows 子进程策略、MkDocs strict 和补丁空白检查通过。本轮未
  修改 Rust，最近一次 Rust 门禁仍为 104 个测试通过、1 个按约定忽略。
- Android/iOS 真机系统字体放大、标签触摸聚焦和 TalkBack/VoiceOver 表单导航仍需验收。

## 2026-08-01 移动端第四十轮：项目搜索标签与结果重排

- 项目搜索框改为原生 `label` 包裹的持续可见字段；placeholder 只保留搜索范围提示，输入后
  字段含义、点击标签聚焦和辅助技术名称继续保持一致。
- 手机断点移除项目主视图重复的 16px 内边距，搜索结果由三列改为单列卡片，文件路径和对话
  摘要不再被窄屏压缩；桌面端继续保留紧凑的三列扫描布局。
- Edge 应用内浏览器在实际 312×675 内容视口确认搜索框/按钮分别约为 219×40px、53×40px，
  输入字号 16px；提交 `roadmap` 后文件和对话结果出现，标签保留、结果单列、零横向溢出且
  无应用错误。桌面实际 819×512 内容视口保持约 422×32px 搜索框、53×32px 按钮、14px
  字号及三列结果。
- 项目工作区测试新增原生标签关联断言，中英文 Help 与移动实现档案同步。全量自动验证为
  120 个测试文件、568 项通过；Biome、设计规范、Tauri 权限、Windows 子进程策略、
  MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为 104 个测试
  通过、1 个按约定忽略。
- Android/iOS 真机系统字体放大、标签触摸聚焦和 TalkBack/VoiceOver 搜索导航仍需验收。

## 2026-08-01 移动端第四十一轮：任务与产物信息密度

- Task Center 移除嵌套主容器的重复 16px 手机内边距，四张状态摘要改为 2×2；任务操作使用
  等宽两列，历史标题至少 40px 高，详情长值允许换行。桌面任务标题与操作顶部对齐，避免
  按钮被 flex 拉伸到 52.5px。
- Artifacts 搜索改为持续可见的原生标签；手机详情的导出/删除使用两列等宽操作，元数据改为
  单列标签和值，内容根原有安全边距保留。搜索输入继承产品字体，桌面不再回退到浏览器默认
  的 13.33px。
- Browser 在实际 312×675 内容视口确认任务卡宽约 288px、摘要 2×2、操作各约 120×40px、
  历史标题 40px 且可以展开；相同数据页面比修复前约短 210px。产物搜索框约 263×40px、
  16px 字号，输入“移动端”后持续标签与结果均保留；详情操作各约 140×40px，零横向溢出。
- 桌面实际 819×512 视口保持四列任务摘要、28px 任务操作、32px 产物操作、两列元数据和
  14px 搜索字号。移动与桌面页面身份、有效内容、错误覆盖层、交互及应用日志检查通过。
- 自动测试新增产物原生标签关联和任务/产物移动布局契约；中英文 Help 与移动实现档案同步。
  全量自动验证为 120 个测试文件、569 项通过；Biome、设计规范、Tauri 权限、Windows
  子进程策略、MkDocs strict 和补丁空白检查通过。本轮未修改 Rust，最近一次 Rust 门禁仍为
  104 个测试通过、1 个按约定忽略。
- Android/iOS 真机动态字体、长本地化文本、TalkBack/VoiceOver 历史展开和搜索导航仍需验收。
