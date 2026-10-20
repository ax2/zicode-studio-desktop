# Stage：把 macOS Worker 回收修复单独提交到 main（2026-10-17）

## 目标与证据

Pi 1.3.0 草稿 PR #2 基于较早的远端 main，其 macOS ARM `rust-tests` 在输出超限用例返回 `worker_cleanup_failed`；主线旧修订此前也出现同样失败。Studio 后续修订 `5d52e234` 增加 Unix 进程组 `EINTR` 有界重试，以及首次组终止失败后先回收直接子进程再重试。包含该修订的 `93d56a12` 分支在 [四平台运行 38532278858](https://github.com/ax2/zicode-studio-desktop/actions/runs/38532278858) 通过，但该分支相对远端 main 有 83 个提交，不适合仅为了 Pi PR 直接并入。

## 本阶段修改

从远端 main `8c727f9d` 树创建独立提交 `9f666ca3bc59f734f2684961c6babc6cd47e86f0`，只采用上述已验证修订的两个源码 blob：`src-tauri/src/plugin_worker_process.rs` 与 `src-tauri/src/plugin_worker_tree.rs`。GitHub compare 确认相对 main 仅这两个文件（分别 +31/-7、+27/-7），无本地脏工作树文件。创建[草稿 PR #3](https://github.com/ax2/zicode-studio-desktop/pull/3)，base 为 main、head 为 `fix/macos-worker-cleanup-main-20261017`；复核草稿、两文件及可合并状态。没有放宽测试、忽略回收失败或更改应用版本。

## 验证与遗留

PR #3 的 unit 和 Windows、macOS ARM、macOS Intel、Ubuntu 平台检查已触发；记录时尚未结束。后续必须以该 PR 自身 CI 为准，不能用包含 83 个其他提交的旧通过记录代替。通过后仍需把修复纳入 Pi PR #2 的测试基线，再完成 Pi 1.3.0 的组合检查与审阅。两个 PR 均未合并或发布。未创建本地工作树、未删除文件或清理缓存；DevTools 0/154、ZiFile 0/108 的完整验收仍继续。

后续复查：[PR #3 unit 运行 38938159687](https://github.com/ax2/zicode-studio-desktop/actions/runs/38938159687) 已成功；四个平台作业仍处于 `Check developer platform`，不能据此宣称跨平台通过。

再次复查：PR #3 自身的 [四平台运行 38938159692](https://github.com/ax2/zicode-studio-desktop/actions/runs/38938159692) 已有 Ubuntu 成功，Windows、macOS ARM 与 Intel 仍在运行。对 PR 差异重新核对，仍只有两处 Worker 文件；没有放宽原有大输出失败断言。Pi 草稿 PR #2 现在以此分支为 base，并在 head 中纳入本修复，最小组合运行 38940511257 正在执行。独立修复通过与组合通过仍是两个待分别核对的门槛。

后续 macOS ARM 作业成功。下载该作业完整平台工件至技术博客 `iterations/worker-cleanup-main-pr-2026-10-17/ci-macos-15/`，摘要记录 darwin/arm64、PR merge 修订 `15c6be6d`、来源验证通过；`rust-tests` 为 507 passed、0 failed、30 ignored，原先失败的 `drains_large_output_while_sending_input_and_enforces_limits_and_deadline` 明确为 `ok`。`rust-format` 仍只作 warning。Intel 和 Windows 作业尚未结束，不能以 ARM 通过外推所有平台。

Windows 与 Ubuntu 作业随后也成功，完整工件分别下载至技术博客同阶段的 `ci-windows-2022/` 和 `ci-ubuntu-22.04/`。两个摘要同属 PR merge 修订 `15c6be6d`，均为 `passed_with_warnings`；Windows Rust 512 passed、0 failed、30 ignored，Ubuntu Rust 507 passed、0 failed、30 ignored，旧失败的大输出用例在两处均明确为 `ok`。macOS Intel 仍未终态，故独立 PR 尚无四平台通过结论。
## macOS Intel 原始验证补记（2026-10-17）

PR #3 的 [四平台运行 38938159692](https://github.com/ax2/zicode-studio-desktop/actions/runs/38938159692) 已上传 macOS Intel 原始工件。`results.json` 标记 `darwin/x64`、`sourceVerified=true`、PR merge SHA `15c6be6d481ab7ee72dd677ec6d4f7c01fc6d3b5`，检查摘要为 `passed_with_warnings`；Rust 测试 507 通过、0 失败、30 忽略，旧失败的大输出 Worker 用例明确 `ok`。唯一 warning 是仓库既有 `rust-format` advisory。工件在技术博客档案 `iterations/worker-cleanup-main-pr-2026-10-17/ci-macos-15-intel/`。记录时作业仍执行 post-cache 步骤，待 GitHub 给出最终结论后再称四平台 CI 完成。

GitHub 随后将运行 `38938159692` 标记为 `completed/success`，Windows x64、macOS ARM64、macOS Intel、Ubuntu 四个作业均为 success。该结论只覆盖独立 Worker 修复 PR #3 的 CI；PR 仍为草稿、未合并，Pi 组合与发布另行验收。

据此已将 PR #3 标记为 ready for review，并更新描述为本 PR 自身四平台与 unit 证据；GitHub 复核 `draft=false`、`merged=false`、base `main`、head `9f666ca3`、仅两文件。未合并。

## 合入结果（2026-10-17）

合入前重新核对 PR #3 仍只修改两个 Worker 文件，五项 GitHub 检查成功、head `9f666ca3bc59f734f2684961c6babc6cd47e86f0` 且可合并。使用 head 提交匹配保护合入，GitHub 随后确认 PR 状态为 `MERGED`，合并提交 `98d8d3d2868425164ba4d52194412a5049f6f7ac`，远端 `main` 同步指向该提交。没有在本地脏工作树执行合并或清理文件；该合入不等于正式应用发布。

