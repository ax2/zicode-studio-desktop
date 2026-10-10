# 2026-09-26 项目交互终端

状态：实现与 Windows 自动化检查完成；原生界面和 macOS/Linux 实机待验收。

## 发现与目标

- 当前项目命令运行器使用无 stdin 的管道进程，适合固定命令；项目只有打开外部终端的入口，没有应用内交互终端。
- 接入跨平台 PTY 与 xterm 终端视图，支持交互输入、ANSI 输出、调整尺寸、退出和项目切换后重新连接。
- Host 管理会话生命周期，桌面端显式启动；项目按注册工作区目录隔离，远程客户端不开放终端操作。
- 终端输出只在 Host 内存保存，设置有界滚动缓存和会话数量上限；重启不会恢复 shell 进程。
- 验证包括真实 Windows ConPTY 的输入/输出/尺寸/停止/子进程回收和 Host 协议。macOS/Linux 实机与原生 UI 验收独立记录。

## 实现约束

- 新逻辑放在终端专用模块，Host/项目页面只做接线。
- 不接受前端任意可执行文件或初始命令；由 Host 选择默认 shell。用户在终端输入的命令按宿主账号权限执行。
- 使用标准终端模拟器渲染控制序列，不把终端输出转成 HTML，不自动打开链接或写入剪贴板。
- 不在持久记录或日志中保存终端输入、输出、环境变量。

## 实现与发现

- 锁定 portable-pty 0.9.0、xterm 6.0.0、FitAddon 0.11.0。终端引擎作为独立 JS/CSS 构建入口按需加载。
- `project_terminal/` 管理 PTY、守护线程、读写队列、字节缓存、Shell 和进程回收。Host 只做适配模块接线。
- 每项目 2 个活动会话、Host 8 个；包括结束记录在内最多 16 个会话。stdout/stderr 合并为终端字节流，每个会话缓存 256 KiB，每帧最多 32 KiB。
- Windows 使用 Job Object 回收受管理进程；Unix 根据 PTY 新建会话的 session ID 回收组内任务，主动 setsid 脱离的程序不承诺回收。
- 前端串行发送有界输入；请求失败后禁止继续输入，不自动重发。历史回放抑制控制序列应答，实时输出正常参与终端交互。
- Host 的输入成功响应在 PTY 写入并 flush 后返回；3 秒内未确认会明确失败，前端提示输入可能已发送并停用输入，避免自动重发命令。
- 真实退出测试发现 ConPTY 的继承光标查询在回放中被重复应答，可能把应答字符送入当前 Shell。改由 Host 完成首次光标握手并从缓存排除此查询；前端进一步区分历史与实时字节。
- Ctrl+C 调查先排除了输入仅入队、固定延时和键事件编码等假设。直接 Cargo 连续 3 次完整通过后，`check:rust` 仍失败；进一步让 Git Bash 单独启动同一个用例也失败，定位到启动链继承的 Windows Ctrl+C 忽略属性。Windows Shell 现在执行固定引导代码，在新 Shell 内通过 `SetConsoleCtrlHandler(NULL, FALSE)` 清除此属性；不修改 Host 的全局控制台状态。该引导依赖 PowerShell `Add-Type`，受限语言环境尚未验证。
- 中断测试等待 Ctrl+C 后的新提示符再发送后续命令，区分 PTY 写入完成与 Shell 已处理完成。试验性 Windows 键事件转换已撤回。
- 立即关闭会话的回归发现迟到的光标握手可能误标为失败；停止后不再因握手发送失败覆盖关闭状态。
- xterm 使用固定宽度字符网格，外层控件沿用项目设计 tokens。自动生成的第三方引擎有一条既有上游内联尺寸提示，不手工改写 vendor 渲染逻辑。

## 验证边界

- Browser 路径调用 `cua.getState()` 返回 apps/browsers 空，报 `Browsers: Error: nodeRepl.fetch request failed`；不声称已完成页面身份、视觉、控制台或真实点击验收。
- Windows 是本轮实际运行平台，macOS/Linux 仍需实机验证。
- 终端字节不进应用持久化库，但 Shell 自身及用户程序的历史策略由它们管理。
- 缓存截断后的 ANSI 片段不能保证恢复任意全屏界面；连接恢复可能需要程序重绘。并不把终端 PTY 隔离宣称为文件系统沙箱。

## 本轮检查结果

- `bun run check:rust` 通过（含经 Git Bash 启动的真实终端），默认 Rust 353 passed、5 ignored，Clippy 无错误。修复后经 Git Bash 启动的完整 Cargo 测试再连续 3 次通过。
- `bun run check:platform`：10 项必需检查通过；前端/网关 40 文件、491 项通过。Cargo/Go 和 Python .venv 真实生命周期用例显式执行通过。
- i18n：2273 键、0 缺失；TypeScript 与 Windows 子进程约束通过。
- Biome 保留基线 111 warnings、7 infos；新增 xterm 构建文件有 1 条上游静态内联尺寸提示。设计检查退出 0；Rust 全仓格式漂移按既有 advisory 记录。
- 前端 React/CSS 资源已重建；MkDocs strict 与 `git diff --check` 通过。没有执行完整 Tauri/release 构建，没有提交、发布或生成安装包。
- 统一证据：`E:\tmp\zicode-terminal-final-evidence\win32-x64-3d7bd14a-fb26-4907-9971-9c42ef77a7be\summary.md`。报告明确记录未提交工作区，不把基准 revision 当作完整变更快照。
- 启动链复现与修复日志：`E:\tmp\zicode-terminal-bash-focused.log`（修复前失败）、`E:\tmp\zicode-terminal-console-final.log`（完整检查通过）、`E:\tmp\zicode-terminal-bash-fixed-{1,2,3}.log`（重复通过）。

## 后续

- 恢复 Browser 工具后进行原生 WebView 键盘、粘贴、主题、尺寸和切换重连验收，并留存真实截图。
- 执行 macOS/Linux 实机 PTY 生命周期检查，覆盖不同默认 Shell；验证 Windows 受限 PowerShell 策略。
- 继续推进项目工具链与自定义环境选择，以及交付验证。
