# ZiFile 归档适配传输跨平台测试门槛（2026-10-18）

## 目标与修改

Studio 为未来 ZiFile 独立插件准备的 `plugin_archive_transport` 已限制请求、超时与输出总量，并在完整事件流验证前不向调用方释放结果。此前真实子进程专项仅在 Windows 编译执行；macOS/Linux 的开发者平台 CI 无法据此证明同一进程边界。

本轮将现有真实进程专项扩展为三平台通用测试：Windows 继续使用固定 PowerShell 夹具读取器，macOS/Linux 由系统 `cat` 读取同一冻结事件夹具，`head -c 50` 构造截断流，`false` 构造非零退出。检查完整结果、截断、调用身份错误、无效预算、预先取消、Worker 失败后相邻成功。CI 的 Windows x64、macOS arm64/x64、Linux x64 `cargo test` 会自动包含这一测试，不新增 Cargo 目标树或应用发布包。

代码只扩展内部传输测试；`runtime.native` 的安装预检继续拒绝，尚无 OS 文件/网络沙箱、资源授权、写入事务或 ZiFile 签名 Worker。此项不提高 ZiFile 18×6 格接受数（**0/108**），也不影响 DevTools **0/154**。

## 本机验证和偏差

- `bun run check:rust:static`：`cargo check --all-targets` 与严格 Clippy 通过。`cargo fmt --check` 报本文件既有 `rejects_invalid_transport_budget_before_launch` 排版漂移，为建议性提示；没有自动格式化其他工作。
- 首次无 `--bin` 的定向 `cargo test` 在编译阶段尝试替换仍被后台进程占用的 `target/debug/zicode-studio-desktop.exe`，报 Windows 拒绝访问，未运行测试。只读核对进程 ID 62316 指向该 Debug EXE；未结束程序或删除缓存。
- 改用 `cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop plugin_archive_transport::tests:: -- --nocapture`，复用同一缓存，只构建测试二进制，Windows **3/3 通过**，其中真实进程专项包含完整流、截断、身份、取消和失败隔离分支。

macOS/Linux 的测试分支已进入源码与 CI `cargo test` 范围，但本轮没有相应系统的实际运行收据，不能称三平台通过；正式签名插件安装、真实归档算法、文件资源与写入、原生界面仍待验收。无版本号变更、ZIP、界面修改或截图。

本轮前后只读空间扫描的 `target` 从 22,547,558,533 字节、53,195 文件变为 22,547,934,120 字节、53,213 文件，未知条目均为 0；项目复用同一 Cargo 目标。E: 空闲从 9,736,454,144 字节变为 36,717,776,896 字节。卷空闲的大幅变化不能由这次测试解释，本会话未删除文件，不能将其记为清理收益。项目内 `target/release` 仍缺，本轮未重建 Release。收尾空间预算扫描退出 0。
