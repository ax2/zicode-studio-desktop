# Stage：Windows 平台 CI 的 PTY 失败核对

日期：2026-10-17。仅核对 Studio 仓库和公开 CI；未修改提供方、插件权限、产品代码或应用版本。

## 当前证据

- 公开 `main` 的 [Developer platform 运行 38950680629](https://github.com/ax2/zicode-studio-desktop/actions/runs/38950680629) 对应提交 `9cf5fd0b108ce59b3661a7d90a829a182984df8a`。四个任务中，macOS 15 arm64、macOS 15 Intel 和 Ubuntu 22.04 成功，Windows 2022 失败。因此不能称该提交的四平台矩阵通过，也不能把该运行视为当前本地 `72f4b0ee` 加未提交修改的验收。
- 下载的 Windows 检查摘要显示：来源、目标平台和 Rust 工具链身份均核对成功；全量 JavaScript、TypeScript、Rust check、Clippy、内嵌 Pi/扩展资源检查、Windows 子进程策略、Go/Cargo 与 Python 生命周期检查均通过。必需的 `rust-tests` 退出码 101；`rust-format` 为现有建议性警告。
- Rust 主二进制测试为 511 通过、1 失败、30 忽略。唯一失败是 `project_environment::tests::new_pty_receives_project_path_without_mutating_host_path`：30 秒内只记录到 PowerShell 窗口标题控制序列，夹具命令未写入标记。该测试在此前 Windows CI 有过通过记录；本次不能据单次日志断定是固定功能故障或仅是机器慢。
- 当前本地测试仍以 30 秒等待首次 PowerShell/PSReadLine 提示符，识别 `PS ... >` 后才发送夹具命令，并响应观察到的光标位置查询。现有失败日志没有记录子进程状态、输入阶段和 `Add-Type` 启动耗时，尚不足以确定卡点。仅延长等待或无条件重试会掩盖启动可靠性问题，本阶段没有改测试判定。

## 与插件验收的关系

同日已归档的当前 Windows Debug EXE 摘要为 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`；隔离 Inspect 0.1.1 的 8 项工具已有逐项原生发现、按需加载、执行和结果展示记录。用户手动启用主开关和 `pi.tools.register`，代理未更改权限。该证据是无签名开发候选的 Windows 单次验证，不弥补公开 CI 的 Windows 失败，也不代表全部 154 项正式接受。当前隔离窗口已退出；没有为同一 EXE 重复安装或重跑 8 项。

## 后续判定

先在 Windows PTY 专项记录首次输出、子进程状态与命令发送阶段，并在同一源码修订的远端 Windows 任务复现或通过后判断是否需要修复。随后重新核对四平台终态与上传摘要。正式签名包、其他平台原生插件流程和 154 项工具完整范围继续单独验收。

已对运行 38950680629 请求仅重跑失败任务；attempt 2 的 Windows 任务排队后进入执行中。本记录在其终态与上传摘要核对前不宣称复验通过。

## 本地失败诊断续篇

现有 PTY 专项在 30 秒超时时额外报告 Shell 名称、会话状态、输出是否关闭、是否见到提示符、是否已发送夹具命令以及已回应的光标查询数。只是失败诊断；原等待时间、发送条件和成功断言均未改变。本机 `bun run check:rust:static` 退出 0（rustfmt 仍有仓库既有建议性漂移），定向 `cargo test --bin zicode-studio-desktop project_environment::tests::new_pty_receives_project_path_without_mutating_host_path -- --exact --nocapture` 为 1/1，通过用时 3.34 秒。这只能说明本机当前工作树可运行，不能判定远端旧提交的间歇失败原因。

测试前后只读存储扫描：`target` 29,997,194,081 → 30,000,374,587 字节（+3,180,506）；非 scratch `.cache` 355,458,670、task-scratch 1,137,263,565、`site` 29,644,753 字节均不变，未知项均为 0。E 卷可用 30,040,629,248 → 30,160,752,640 字节；卷余量受其他进程影响，不归因于本轮。没有按容量门槛删除缓存、创建第二套运行目录、改版本或发布。

后续将会话消失时的诊断改为显示 `missing`，避免诊断自身覆盖原始失败。第二次 `bun run check:rust:static` 退出 0；对本次修改的 `tests.rs` 单文件执行 `rustfmt --edition 2021 --check` 退出 0。第二次只读存储扫描前后 `target` 均为 30,000,374,587 字节，其他项目树逻辑大小不变，未知项 0。公开 attempt 2 仍使用旧源码，不能检验此新诊断。

## 公开重跑终态

[运行 38950680629](https://github.com/ax2/zicode-studio-desktop/actions/runs/38950680629) 的 attempt 2 已结束，四平台任务均为 `success`。重跑的 [Windows 任务](https://github.com/ax2/zicode-studio-desktop/actions/runs/38950680629/job/117323228669) 上传摘要明确为 `passed_with_warnings`、提交仍为 `9cf5fd0b`、来源/runner/toolchain 身份核对成功；所有必需检查通过，仅仓库已有 rustfmt 漂移为建议性警告。Rust 主二进制 512 通过、0 失败、30 忽略，原失败 PTY 用例本次通过。首次 Windows 失败（511 通过、1 失败）保留，不因重跑成功被改写。

attempt 2 的 Windows 原始上传物保存在 `.cache/task-scratch/cross-platform-ci-20261017/attempt-2/`，23 个文件合计 601,047 逻辑字节；首次失败上传物另存同一 scratch 根目录。重跑成功支持将失败归为尚未复现的间歇问题，仍不能确定 PowerShell、PSReadLine、测试交互或 runner 资源争用的具体原因。本地诊断补丁不在远端提交中；正式安装包、原生 WebView、提供方签名包和 macOS/Linux 插件真实界面仍需单独验收。
