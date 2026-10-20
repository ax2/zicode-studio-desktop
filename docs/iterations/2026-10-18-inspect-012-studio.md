# Inspect 0.1.2：Studio Host 与 Pi 实际运行验收（2026-10-18）

## 范围

仅修改 Studio 的验收代码与开发平台检查。提供方目录、候选包、收据保持冻结；未修改 DevTools，未在日常配置安装或启用插件。开发版继续为 0.4.2。

## 输入与证据

- 冻结候选：`tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/inspect-0.1.2-candidate-01`；616 个文件、2,341,254 字节。
- Studio 留存的外部收据：`tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.inspect-0.1.2-verification.json`；目录索引 SHA-256 为 `1d3af04bb9e35fa9594a673ff71058e56ffbb94e516f4086dba275472d1678ee`。`bun run verify:devtools-package` 复验通过；未签名，不作正式接受。
- Windows Debug Worker 复用当前 `target/debug/zicode-studio-desktop.exe`，SHA-256 `4F19F9952D216755B2420684F8C226623A5ADEB8369D5F6BD50EC011A97EB4FC`；未重新打包或改版本。
- Pi 与 Broker 运行时 SHA-256 分别为 `eb2205e842d1b02a1a539e98618b20d6b055a008fa0b678ebbbeb004239f1365`、`3abd05b5583e30637a620ce4fe71bc0069b264ffa4ac6fc4cf1290360dd6783a`。

## 修改

- 将 Inspect 0.1.1 的 Host 实际 Worker 验收抽成按候选版本和文件数复用的夹具，新增 0.1.2 的 8 项真实调用。
- 内嵌 Pi/Broker 验收新增 Inspect 0.1.2 外部冻结候选。核对 616 文件收据后，在隔离配置执行目录发现、按需加载、调用、权限撤销/恢复、禁用/启用、卸载及重新安装权限生命周期。
- 旧观察脚本把目录取消识别为 `AbortError`；当前 Studio 客户端抛出 `[catalog_request_cancelled]`。首次 Pi 验收停在 `run` 阶段，已把观察脚本与现行合同对齐，保留第一次失败收据以供审计。
- 开发平台四系统检查脚本加入 0.1.2 Host 与 Pi 两个必过步骤，Pi 步骤校验结构化收据。它们复用现有 Debug Worker、Pi 资源与 Cargo target；未额外构建第二套运行目录。

## 已验证

- Windows Host/Worker 定向测试 1/1：8 项 capability 各自按冻结样例得到精确文本；无桌面令牌的调用为 403，无效 YAML 返回 `INVALID_INPUT`，禁用插件后调用被拒绝，测试隔离目录在成功后清理。
- 首次 Pi/Broker 测试的失败收据见技术博客 `iterations/inspect-012-studio-2026-10-18/first-failure-receipt.json`：`failedPhase=run`、`failureClass=[catalog_request_cancelled]`。修正观察脚本后同一冻结候选复跑 1/1 通过。
- 通过收据见技术博客 `iterations/inspect-012-studio-2026-10-18/pi-receipt.json`：`mechanismPassed=true`，10 个阶段、8 项精确输出、40 次拒绝调用、6 次同场其他插件控制调用。授权阶段目录分页显示 8 项；撤权、禁用、卸载、重装未授权阶段显示 0 项；恢复授权后再显示 8 项。无效输入及相邻工具恢复也在执行中校验。
- Rust 全目标 `cargo check --locked`、严格 Clippy 与门槛脚本专项 9/9 通过；`cargo fmt --check` 提示工作树现有格式漂移（建议项），未对其他未提交代码做全局格式化。补跑 Pi 的 CI 收据分支 1/1 通过，归档的 `ci-receipt.json` 满足新门槛的 `validateReceipt`。CI 的 Windows/macOS/Linux 真实结果仍待运行。

## 边界与待办

该验收是实际 Host/Worker 与内嵌 Pi/Broker 调用，不是原生 Tauri 界面安装、授权、点击、展示截图。当前候选无正式签名；Inspect 8 项也不能代表 DevTools 154 项全部可用。全目录完整接受仍 0/154；JSON Object 按用户决定保持禁用。新增 CI 门槛引用的冻结候选和收据目前是工作区未跟踪文件，远端运行前必须连同代码纳入提交；本轮没有提交。下一步继续逐包验证并补原生及跨平台证据。

首次失败留下的隔离 scratch 已核对归属、owner PID 退出和失败收据归档；仅对该精确目录的删除被自动审批以 `blocked by policy` 拒绝，实际删除 0，不换方法重试。手工候选与磁盘扫描见技术博客工作日志。

磁盘只读扫描：测试前 `target` 22,558,513,112 字节、scratch 2,781,959,693 字节、E: 空闲 62,643,523,584 字节；测试后分别为 22,558,547,020、2,784,637,275 和 62,591,643,648 字节。scratch 净增 2,677,582 字节，恰为被拒绝清理的失败目录；成功运行的临时目录已移除。卷空闲变化包含同期其他活动，不能全部归因于本轮测试。

严格静态检查后再扫描，`target` 和 scratch 逻辑字节及文件数均未继续增加；E: 空闲 62,592,311,296 字节。
