# 当前 Windows：单默认空间与界面层级简化

用户要求移除项目概念、默认只有一个项目、隐藏各功能区的项目根目录，保留以后新增项目的内部实现；随后明确不做旧数据兼容迁移。本次没有迁移、覆盖或删除旧数据，没有创建定时任务。

## 已交付行为

- 桌面启动固定进入默认空间，不恢复旧项目选择；项目应用不出现在导航、工具目录、命令面板或快捷工具。旧项目深链接转到工具页；打开/切换项目入口及 Ctrl+Shift+O 在当前模式不启用。
- 聊天会话平铺，移除项目分组和根目录标题；工具页移除工作区选择器；任务、自动化表单自动使用默认空间，不显示目标项目、根目录、分组按钮或后台多项目扫描清单；用量页隐藏项目统计和会话目录。
- 文件工具界面使用文件、文件夹、Studio 文件和已保存结果等具体表述，保存/传递确认面板隐藏内部空间编号。文件来源、相对文件名、保存目的地及授权确认仍然展示；没有用全局字符串删除掩盖内容。
- 桌面用户数据统一通过 `workspace_mode::app_directory` 定位到固定配置的 `system/.zicode`，资源上下文仍保留各自工作目录以执行文件权限检查。后台自动化只扫描默认空间；使用独立的根目录映射视图，不改写 Host 的资源上下文映射。
- 当前固定配置为 `D:/work/local-state/zicode-studio-desktop`。旧项目数据留在原处，不合并旧笔记到默认空间，也不承诺旧项目内容自动出现在当前界面。

## 保留的扩展点

Rust `src-tauri/src/workspace_mode.rs` 在桌面组合入口明确初始化 SingleDefault；可复用 Host 未初始化时仍保持 Multiple。前端 `public/native/workspace/workspace-mode.js` 集中管理 MULTI_PROJECT_UI_ENABLED，React 使用共享出口。项目实现、内部标识及协议保留，未来启用多项目时需要同时调整产品模式并明确数据策略。

超过500行文件的例外仅是必要的组合接线、条件渲染或现有数据根目录调用替换；新策略逻辑放在独立模块，没有继续在 main.rs/app.js 内堆积实现。既有目录批量候选仍仅保留在会话草稿目录，本次没有接入或宣称交付。

## 验证与实际运行

- Rust 静态检查通过（既有格式漂移仍为脚本的 advisory）。最终编译产物的本机测试29项通过：策略3、启动1、数据目录4、备份6、Host 数据15。两个自动化过滤项没有匹配测试，未计为通过；后台范围通过真实原生命令验证。
- 相关工具/插件前端回归710通过、2项原有跳过；任务/用量/设置164通过。此前51文件337项及未来多项目入口17项检查记录保留，存在范围重叠，不把它们相加成独立总数。
- 前端检查和类型检查通过，3699个中文键覆盖、缺失0；保留既有 lint/设计告警。旧项目入口、旧场景界面与旧保存文案测试已按当前产品行为更新，原失败日志保留。
- `bun run build:local` 构建，复用 target/debug，不生成安装包或重复完整运行目录。最终 EXE SHA-256：`56E659AA5AB4A72026541C688105065026142FFE11300BDD610AAB4F701F5924`。
- 独立配置和当前 Windows 配置均通过真实 WebView2 CDP 交互：唯一默认空间、后台唯一扫描范围、聊天/工具/任务/自动化/笔记/设置/用量无项目入口和根目录文字或标题；360px客户区无横向溢出、中英文切换、旧链接转工具页、真实 Host/Worker 校验清单生成。截图已查看，工具目录等待实际条目加载后再截图。Browser 插件不可用；没有声明其他操作系统验收。
- 实际 Windows 注册托盘图标与中英文 HMENU 均核验，无项目菜单；两轮关闭隐藏/托盘恢复保持同一进程，最小化后二次启动恢复通过。使用实际原生回调与启动器，不宣称物理鼠标操作。
- 已安装到 `D:/work/apps/zicode-studio-desktop/zicode-studio-desktop.exe`，原 EXE 保留 `.before-single-default-20261102`。仅按路径、PID、精确启动时间核对并正常退出本会话启动的实例。当前普通启动为一个可见且响应的进程，9227调试端口关闭，23个 DevTools 包持久启用，默认空间2篇笔记可读。
- 原32个笔记相关文件、最新保存编辑、原备份和固定位置只读核对保持，SQLite完整性正常。这是物理保留证据，不表示把旧项目1篇笔记迁入默认空间。工具映射范围不因本次界面简化扩大。

## 保留的失败与限制

本机执行曾多次长时间挂起；Rust静态检查日志记565m28s，最终测试编译日志记1379m31s，未查明原因，不把挂起时间说成持续开发进展。本次恢复后的最终三次本地构建分别完成，最后一轮记录2m01s。

独立验收首次脚本错误地寻找新建自动化按钮，真实页面是内嵌表单，已修正定位并保留失败。当前配置首次启动超过脚本15秒发现窗口，连接超时后等待实际启动完成再执行，未重启或放宽产品限额。测试页面重载曾产生 Tauri 传输降级与异步回调历史警告；原记录保留。清除调试器历史后，普通页面切换新增 warning/error/exception 为0，随后恢复无调试启动。没有把这些历史警告抹去或宣称完整测试零警告。普通启动后的旧清单精确比对因新增笔记站点文件、随后新增笔记和 changes.jsonl 追加失败；逐文件核对确认原31个文件字节不变，changes.jsonl 原有字节前缀与原备份完整保留，追加日志及新增内容均保留。最终证据分别记录原文件、日志追加与观察到的新增文件，未修改旧基线，未删除或回滚新内容。该检查发生于可交互的普通运行中，不声明当前目录是原子快照。

证据根目录：`C:/Users/ax2/Documents/Codex/2026-10-22/clone-git-github-com-ax2-zicode`。

- 当前/独立实际验收：`outputs/default-workspace-current-20261031.json`、`outputs/default-workspace-independent-20261031.json` 与相邻截图（文件名日期是续接脚本标识，实际验证日期2026-11-02）。
- 正常运行及托盘：`outputs/default-workspace-current-steady.json`、`default-workspace-tray-en.json`、`default-workspace-tray-zh.json`、`default-workspace-window-cycle.registration.json`、`default-workspace-normal-final.json`。
- 文件核对：`outputs/default-workspace-data-final.json`、`default-workspace-data-normal.json`。
- 检查/构建：`work/default-workspace-rust-gate.log`、`default-workspace-native-final-compile.log`、`default-workspace-delivery-check.log`、`default-workspace-delivery-tests.log`、`default-workspace-surfaces-tests-ready.log`、`default-workspace-wording-i18n.log`、`default-workspace-build-wording.log`。
- 存储：`outputs/file-batch-budget-before.json` 与 `outputs/default-workspace-budget-after.json`。保留有用共享缓存，不清空 target 或其他用户资料。
