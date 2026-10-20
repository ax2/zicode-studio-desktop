# DevTools d084 目录与 Diagnostics 0.1.4 接收（2026-10-18）

## 目标与边界

Studio 只读接收提供方新的不可变目录修订 `devtools-catalog-2026-10-18-d084f541be736aed` 和无签名 `diagnostics-0.1.4-candidate-01`。未修改 DevTools、未安装或启用候选、未更改插件权限；用户决定暂不启用的 JSON Object 保持禁用。

## 修改和验证

- 两份交付及包外收据按原字节复制到 `tests/fixtures/`，旧夹具保留。Studio 收据校验：目录 11 文件、2,256,397 逻辑字节、154 个唯一源工具 ID、六包和 31 个不同源 ID 的操作映射，修订 SHA-256 `d084f541be736aed8ff6698eed4669a21f5531d5726e5cae11daec5ee6293b08`，目录索引 matched。
- Diagnostics 0.1.4：651 文件、5,444,825 逻辑字节、目录索引 matched；11 项能力均声明输出 schema、结果字节上限和目录发现元数据。Studio 的六包实际文件/收据/映射审计通过，六包 manifest profile 静态预检问题 0，操作收据引用缺失 0。
- 从新冻结目录生成 [154 项逐项缺口](../plugins/devtools-catalog-revision-gaps-devtools-catalog-2026-10-18-d084f541be736aed.md)。旧目录和逐项缺口继续保留。

验证命令：`verify-devtools-catalog-revision.mjs`、`verify-devtools-package.mjs`、`audit-devtools-catalog-candidates.mjs`、新修订的 `render-devtools-catalog-gaps.mjs --check --revision ...` 和 `git diff --check` 均退出 0。前后 `storage-budget.ps1` 退出 0；收尾 E: 空闲 35,418,918,912 字节、未低于储备线。这里的“通过”限于字节、目录/协议静态层。

## 遗留与发布

Diagnostics 0.1.3 的输出契约和目录元数据缺口在 0.1.4 的**静态声明层**解决，尚未完成 Studio 安装、Host/Worker/Pi 执行、原生界面、超时/取消、结果接力、其他平台验收。六包仍为无签名目录；JSON Object 2、Trace 2、Transforms 23 合计 27 项能力仍缺目录元数据。`spring-actuator` 的 candidate 标签仍无包操作映射。六包只映射 31/154 个不同源 ID，剩余 123 个无包操作映射，已映射部分也多为局部能力。完整接受 DevTools **0/154**、ZiFile **0/108**。

本轮没有界面改动、Windows 构建或发布，也没有生成 ZIP 或删除缓存。缺口变化需要提供方新交付；Studio 不读取提供方工作树作为运行依赖。

按用户此前授权，已将剩余 27 项目录元数据、Spring 映射、123 个无包操作映射源 ID、签名包与 Diagnostics 真实验收所需证据，回传原会话“zi-devtools”；不由 Studio 修改提供方程序。

## Studio 当前引擎续验（同日）

Studio 增加了隔离 Diagnostics 0.1.4 的当前 Wasmtime 引擎专项，逐项从冻结 View 取得 11 个样例、按冻结 manifest 的能力输入字段构造请求，并调用 Studio 的 `execute_wasi` 和 `output.schema.v1` 结果校验。首轮测试驱动误给全部 11 项发送 `secondary`，7 项只允许 `text`，因此 4 项报告、7 项业务拒绝；失败收据原样保留在 `.cache/task-scratch/diagnostics-014-engine-2026-10-18/receipt.json`。按每项 schema 修正输入后 11/11 返回有效 JSON 报告并通过 Studio 输出契约；模块 SHA-256 `2df08c2a21a66a8598c9ec2b73493cf77d3e70c025ff305c79379a6303ec62b0`，成功收据 `receipt-corrected.json` SHA-256 `0bf2ce29ca7d0e3e9cba7eddc35073af745375aacf5c86e1f6bbd1b990fa7d69`。当前测试 profile 单项最长 2,093 ms，不能推断所有输入在五秒 Host 截止内完成。

`cargo test --bin zicode-studio-desktop --no-run` 成功，直接运行其当前源码测试二进制的 0.1.4 专项退出 0。`bun run check:rust:static` 的首轮通过；最后的 Rust 修改仍需复检。完整 `bun run build:local` 和初次 `cargo test` 都因普通 Studio Debug 进程占用 `target/debug/zicode-studio-desktop.exe` 而无法替换 EXE；当前运行实例未被终止。已向用户请求方便时正常退出，随后才能以新 Debug EXE 验证隔离 Host/Worker/Pi 的搜索、加载、执行、撤权及其他工具隔离。测试二进制通过不等于这条全链或原生界面验收。

## 隔离 Host/Worker/Pi 续验（同日）

占用 Debug EXE 的普通 Studio 实例后续自然退出；Studio 复用缓存运行 `bun run build:local`，成功生成当前 Windows Debug EXE（SHA-256 `ffd5d76f20b4fd494bc709ce973fe19d6cf8ff6b34d58c6a020ea6de371907b1`），没有改版本号或生成 ZIP。内嵌 Pi `1.3.0` EXE SHA-256 `eb2205e842d1b02a1a539e98618b20d6b055a008fa0b678ebbbeb004239f1365`，同目录 Broker SHA-256 `3abd05b5583e30637a620ce4fe71bc0069b264ffa4ac6fc4cf1290360dd6783a`。

隔离测试夹具初跑暴露旧观察器两项断言漂移：基础 Broker 现包含 `studio_plugin_call`，以及目录取消返回 `[catalog_request_cancelled]`。两次失败收据分别保留在 `.cache/task-scratch/diagnostics-pi-c1e80faa-4892-4bf2-9500-a570bc8285f0/` 和 `diagnostics-pi-ef59b8d8-5ee8-47dc-ad7e-f2b297a7e764/`。仅修正测试观察器，不放松产品权限或取消语义；观察器改为运行时读取，避免每次诊断修改都重编整个 Rust 测试二进制。

当前冻结 0.1.4 在真实隔离 Host、当前 Debug Worker 与内嵌 Pi Broker 中通过 `unauthorized → run → revoked → restored → disabled → reenabled → revoked-again → uninstalled → reinstalled-denied → reinstalled-granted` 十阶段。按目录搜索并逐项按需加载后，11/11 样例返回报告；撤权等阶段缓存调用共 55 次明确拒绝，独立 Text 插件 5 次仍成功。带 Worker 事件日志的最终收据 `diagnostics-pi-9e98c6c6-393f-4571-8590-4f986430d76c/receipt.json` SHA-256 `fbd0c0b3ffa19c5acebef708250ea5881711ed742eacfba25e2eaa68c570605`；事件日志 SHA-256 `b24f4ccb4c2052651eecf9e240fcfe6cc87108d5fb689e26f213e36e7555106b`，10 阶段实际/预期 Worker 启动均为 20，事件记录 20 次 started、20 次 reaped、20 次 pipes_closed。测试后无该隔离 profile 的 Pi/Worker 残留进程。

这是 Windows Debug 的隔离开发目录候选与合成样例验收，收据自身仍标明 `fullCandidateAccepted=false`。无签名正式包、原生 UI 截图/真实交互、完整输入边界/超时、跨工具结果接力及保存确认、其他操作系统和 11 个来源工具的完整范围仍待验；DevTools 全目录完整接受仍 **0/154**。

收尾 `bun run check:rust:static` 退出 0（cargo check/clippy 通过；全仓 `cargo fmt --check` 仍提示既有格式漂移，改动的两份 Rust 文件定向 rustfmt 检查通过），`git diff --check` 退出 0。构建/测试后 `storage-budget.ps1` 退出 0，E: 空闲 61,885,210,624 字节、未低于储备线；未清理缓存或测试失败证据。`target/debug/incremental` 仍存在，`target/release` 仍不存在。

## Diagnostics 结果接力与确认保存（同日续进）

在当前 Debug EXE 的真实 Worker 和隔离 Host HTTP 中，冻结 Diagnostics 0.1.4 的 `java.threads` 合成报告使用 `captureResult` 生成来源引用。Studio 预览报告后，没有确认的传递提交返回冲突；明确确认后，报告作为 `text` 输入交给独立 Text 开发候选的 Base64 工具，结果与原报告逐字节编码一致。随后对接收结果执行保存预览：未确认的保存提交返回冲突且成果库为空，确认后产生恰好一个成果。另向 Diagnostics `java.jfr_json` 提交无效报告，得到固定 `INVALID_REPORT`、未产生结果引用；之后 Text 工具仍可调用。没有使用用户文件或网络服务。

当前成功证据在 `.cache/task-scratch/diagnostics-result-transfer-054193a1-7851-48c6-866b-a890360af4df/receipt.json`，SHA-256 `e60a56ce1ee8f85bc2c82573c447a36eb8a6ad146b2c9335749d21e042e7aa03`；测试退出 0、隔离进程残留 0。报告内容只保留摘要 `c6b404751fba695cee47e2f1aae13ff765332e7705dbb786b5e0b9ae698ca202`，成果是合成数据。前一次同链成功收据也保留在 `diagnostics-result-transfer-89df9ed7-cc95-423e-8ae4-eb20e2a0370e/`。

这证明 Host API 在该 Windows 合成样例上的来源绑定、预览、确认门禁、执行、保存及业务失败隔离；`confirmed:true` 来自测试客户端，**不是原生界面用户点击证据**。原生 UI 的结果展示和确认、真实用户报告的完整范围、正式签名包、跨平台、长时取消与故障恢复仍待验，完整源工具接受数不变。

本轮新专项测试、`bun run check:rust:static`、定向 rustfmt 与 `git diff --check` 均退出 0；全仓格式检查仍提示已有漂移。前后 `storage-budget.ps1` 退出 0，收尾 E: 空闲 63,528,124,416 字节、未低于储备线。没有新增发布副本、版本号或 ZIP，也没有清理现有构建缓存。
