# Notes：跨笔记本移动中断恢复（2026-11-13，Issue #22）

## 实现范围

移动前准备目标正文、两份笔记本元数据、变更日志和附件，文件写入并同步后将事务目录从 `preparing` 重命名为 `pending`。实际替换使用同卷重命名；原件保存在事务 `old` 目录中。最后把整个目录重命名为 `committed`，这才是成功提交点。

工作区打开取得既有 Notes 独占锁后，先处理 `.note-moves`：未提交事务逆序恢复，已提交事务核对目标后清理备份。清理之前改名为 `done`，所以清理本身中断不会被误判为新的未提交移动。回滚也用重命名，允许再次中断和重试。普通 I/O 失败使用同一套恢复逻辑；已提交后的清理失败不谎报移动失败。

目标位置只从规范 UUID、源/目标笔记本及固定文件类型推导，不接受任意恢复路径。能力目录 I/O 拒绝路径越界与符号链接，摘要校验阻止覆盖外部编辑；未知目录项/损坏记录保留并返回 `move_recovery_required`。解决占用或外部修改后重新打开 Notes 重试。此错误不会自动删除日志或猜测哪份笔记应覆盖另一份。

单附件沿用5MiB限制；逐文件处理，没有采用备份导出的50MiB总量限制。事务 I/O 每目录最多10000项、文件读取上限16MiB；正常正文仍受原有1MiB限制。超出保护范围会在发布前拒绝，原资料保留。此次验证覆盖进程终止，不宣称断电、介质损坏或所有网络文件系统行为已通过。

主仓大文件 `notes_vault.rs` 仅替换模块声明并增加一次恢复接线；核心逻辑和测试位于独立模块。删除已被替代的仅内存附件回滚 helper，避免两套移动实现并存。没有修改生产资料目录、应用版本或前端资源。

## 验证记录

- 首轮编译发现两处返回类型问题，日志保留：主会话 `outputs/notes-journal-tests-1.log`。
- 修正后独立工作树 Notes 回归64通过、2项既有忽略；新用例中7项行为测试和1个子进程入口，不将入口空跑当额外业务覆盖。日志 `outputs/notes-journal-tests-2.log`。
- 包括逐阶段中断后重开、回滚再次中断、提交前/后外部编辑保留、Windows目标文件占用后重试、篡改路径拒绝。
- 实际启动并终止本测试创建的三个子进程，分别停在附件准备、晚期替换和提交后；验证正文、稳定ID及PNG/二进制附件恢复。未终止用户应用。
- 移除临时的附件总量限制并加入原生验收夹具导出后，主仓最终 Notes 回归64通过、2项既有忽略：`outputs/notes-journal-final-tests.log`。主仓开发版本保持0.5.3。
- 主仓 `bun run check:rust:static` 退出0，all-targets check和严格Clippy通过；全仓既有格式漂移仍作为仓库脚本的advisory保留，没有全量格式化并行改动：`outputs/notes-journal-final-static.log`。
- 最终 Windows debug EXE SHA256 `969FE04C475A4DCCFEB5C56A9618C1FB8EF12DDD6BEDB377CDC91562D06DEB63`。仅执行 `cargo build --bin zicode-studio-desktop`，没有重新生成前端资源；1192份 Rust/配置/前端输入构建前后摘要一致，开发版本仍0.5.3。`outputs/notes-journal-native-build.log`、`notes-journal-build-inputs.json`、`notes-journal-binary.json`。
- 当前 Windows 实际 Studio/Host/WebView2：三份由真实子进程终止留下的合成资料（附件准备、晚期替换、已提交）自动恢复；编辑页真实点击可打开笔记，正文、ID、全部原始文件SHA一致。已提交情况的旧链接正确定位目标。正常加载的Notes bundle与主仓资源完全一致，无样式注入。
- 恢复后通过实际管理菜单再次跨本移动，正常退出重开核对正文、附件与旧位置链接持续可用；`outputs/notes-journal-backup-move-native.json`、`notes-journal-backup-reopen-native.json`。
- 另两次启动此前的合成资料，核对原有笔记/晚期失败用例旧链接及129个Notes文件摘要全部保持。六个成功启动的自有程序均位于专用后台桌面，核对身份后正常退出，没有强杀用户进程。
- 原生结果：主会话 `outputs/notes-journal-{attachment,backup,committed,baseline,reopen}-native.json` 及同名PNG；进程/退出记录在主仓 `.cache/task-scratch/notes-journal-native/`。仅使用自有合成资料，未读取或修改个人笔记/日常selector。

## 仍未完成

本项不等于整个 Notes 或v0.5.10完成。窄窗左侧边缘/滚动区域复核、最终发布候选与安装升级验收继续按 Project 跟踪；未发布安装包、未改变用户排期。

本轮原生进程：attachment PID66292, backup PID24112, backup-reopen PID55728, committed PID51044, baseline PID53968, reopen PID51408。

首次夹具预置笔记却缺少隔离资料标记，被产品归属检查拒绝（PID10064），未进入工作区。按既有QA脚本的格式初始化自有夹具后复测通过；原失败receipt保留为 `attachment-launch-attempt1.json`，未放宽产品检查。六个launcher终止码均0，应用exitCode字段为空，不伪称应用退出码0；WebView2退出清理警告1412保留。
