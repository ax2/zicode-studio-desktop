# macOS Worker 清理失败复核（2026-10-14）

公开主线 [`Developer platform` 运行 38373324429](https://github.com/ax2/zicode-studio-desktop/actions/runs/38373324429) 的 macOS arm64 与 Intel 均在 `rust-tests` 失败。下载的两份 CI 摘要均显示其他检查通过，`rust-format` 为既有 advisory warning，不是本次退出码 1 的原因。失败同为 `plugin_capabilities::worker_process::tests::drains_large_output_while_sending_input_and_enforces_limits_and_deadline`：测试希望超量输出返回 `result_too_large`，实际收到 `worker_cleanup_failed`。CI 运行版本是 `8c727f9d`，早于当前本地开发提交。

当前 Studio 的 Unix Worker 进程组清理对 `kill(-group, SIGKILL)` 的 `ESRCH` 已视作目标退出。新增有界 `EINTR` 重试（最多八次），只处理系统调用被信号打断的情况；其他错误仍返回清理失败。CI 没有记录原始 errno，因此**不能证明这就是两台 macOS runner 的根因**，也不能将失败测试标为修复完成。保留 `worker_cleanup_failed` 的优先级，不能用输出超限错误覆盖未确认的进程清理。

本地 Windows `bun run check:rust:static` 和该专项测试通过；Windows 条件编译不执行 Unix 分支。下一步在 macOS arm64、Intel 对当前修订重跑此专项及完整平台工作流，若仍失败，在清理错误处记录不含敏感路径的 errno，并核对进程组、子进程退出与管道关闭。不要用放宽测试预期替代回收证明。与 ZiFile 的原生 Worker 准入关联：进程树回收是必要条件，但仍缺文件/网络隔离、私有资源映射、写入事务和提供方签名包；108 格接受数仍为 0。
