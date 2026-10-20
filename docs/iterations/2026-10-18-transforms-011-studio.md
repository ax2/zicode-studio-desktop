# Transforms 0.1.1：Studio 23 项实际运行验收（2026-10-18）

## 目标与冻结输入

在 Studio 隔离配置中对冻结的 ZiDevTools Transforms 0.1.1 逐项执行全部 23 项候选 capability，核对目录发现、按需加载、实际 Worker 输出和权限生命周期。只修改 Studio 的验收测试、开发平台检查及档案；不修改提供方字节或用户插件配置。本地开发版保持 0.4.2。

候选 `tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/transforms-0.1.1-candidate-01` 为 804 文件、4,421,575 逻辑字节。包外收据 `tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.transforms-0.1.1-verification.json` 逐文件核验通过，目录索引 SHA-256 `4f2c7cc1c3b70ba0ae05344bf0eb83b54d17f8f7e661d4ae808a35da934e25b3`。冻结 `fixtures/transforms.json` 包含 23 个互异能力的 `-sample` 成功样例，恰与包目录 23 项一一对应。候选仍未签名。

## 修改与实测

- 保留历史 Transforms 候选测试，新增当前 0.1.1 的独立外部候选测试；源目录及安装副本均按包外收据复验。
- Windows 当前 Debug Worker + 嵌入式 Pi/Broker/Host 的实际运行 1/1 通过：URL 编解码/检查、HTML 和字符串转义、四种大小写转换、文本统计、五种行操作、四种进制转换、Hex 编解码共 23 项。`pi-receipt.json` 中 23/23 行均为 `exact_text`；授权阶段目录显示 23 项，失权阶段隐藏，再授权后恢复。
- 十阶段权限/启停/卸载/重装流程通过，旧工具拒绝 115 次，同场独立 Text 对照工具成功 5 次；成功测试的隔离 scratch 自动清理。
- 四系统共用开发平台检查增加 `devtools-transforms-011-pi-worker` 非建议级门槛。本地 `ci-receipt.json` 的 `validateReceipt=true`；门槛脚本专项 9/9、全目标 Cargo check 与严格 Clippy 通过。全仓格式检查仅提示建议级既有漂移，未批量格式化其他工作。

运行时 SHA-256：当前 Debug Worker `4F19F9952D216755B2420684F8C226623A5ADEB8369D5F6BD50EC011A97EB4FC`，Pi `eb2205e842d1b02a1a539e98618b20d6b055a008fa0b678ebbbeb004239f1365`，Broker `3abd05b5583e30637a620ce4fe71bc0069b264ffa4ac6fc4cf1290360dd6783a`。

## 边界与待办

23/23 指当前候选的 23 条成功样例实际执行，不等于每个源工具的全部输入、错误边界和独立版功能都已验收。没有原生 Tauri 安装、授权、点击和截图；没有正式签名包或 macOS/Linux CI 运行结果。门槛引用的冻结包和收据仍是工作区未跟踪文件，远端运行前须随代码提交；本轮不提交。DevTools 完整正式接受仍 0/154，ZiFile 仍 0/108，JSON Object 依用户决定禁用。未发布新版本或 ZIP。

磁盘只读前后扫描：`target` 22,558,701,546 → 22,558,703,594 逻辑字节，`task-scratch` 均为 2,784,637,275 字节、52,723 文件；成功测试没有留下新增 scratch。E: 空闲 61,407,985,664 → 61,405,802,496 字节，卷空间变化包含同期活动，不能全归因于本轮。此前被审批拒绝的目录不重试。
