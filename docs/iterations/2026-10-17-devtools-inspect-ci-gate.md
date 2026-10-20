# Stage：跨平台矩阵接入冻结 Inspect 实际工具

日期：2026-10-17。只修改 Studio 的测试运行路径和平台检查清单；保留现有工作树其他改动，不修改 DevTools 提供方。

## 目标与实现

现有 Developer platform 矩阵验证通用 Pi/Host Broker 与自有资源 Worker，但没有执行仓库已冻结的 DevTools Inspect WASI 实包。矩阵新增必需项 `devtools-inspect-pi-worker`，复用 `tests/fixtures/devtools-inspect-candidate01` 的 7 项能力与既有十阶段 Pi/权限专项。该项在获取内嵌 Pi、构建扩展、Rust 测试、实际资源 Worker 和通用 Broker 检查之后运行；需要当前平台的 Debug Worker EXE，并向本次 CI 证据目录写入机器可读收据。测试失败、进程失败或缺失/无效/未通过的收据都会使矩阵失败。

专项按平台选择 `pi.exe` 或 `pi`。矩阵使用 `src-tauri/resources/pi/` 和 `extensions/dist/` 的当次准备资源；普通手工运行先复用 Debug 运行目录，缺失时才回退项目资源。Worker、Pi 与 Broker 各自计算 SHA-256 并输出到测试日志。设置 CI 收据路径时，通过完整断言后写入 `passed:true`、`mechanismPassed:true`、候选族和 7 项操作数，并删除本次创建的隔离 scratch；失败 scratch 保留供诊断。未设置该路径的历史手工专项仍保留原有审计行为。

后续发现“先取 Debug 目录、缺失才回退”可能让 CI 在锁定资源已更新后误用旧运行目录。矩阵现显式传入 `ZICODE_TEST_PREPARED_RESOURCES=1`，要求专项只从本次 `fetch:pi` 与 `build:extensions` 准备的项目目录取 Pi 和 Broker；缺文件则失败。普通手工运行继续允许复用 Debug 资源。收据新增 `preparedResources`，便于核对本次实际选择。

## 本机验证

- `bun run check` 退出 0，保留仓库已有 145 warnings、10 infos 与 1 条生成样式提示；平台检查定义的定向 Vitest 7/7 通过。
- `bun run check:rust:static` 退出 0；全仓 rustfmt 仍是既有建议性漂移。
- Windows 使用现有 0.4.2 Debug EXE、已准备的 Pi 1.3.0 和 Broker 实际运行冻结 Inspect 专项：7 项操作及 `unauthorized`、`run`、`revoked`、`restored`、`disabled`、`reenabled`、`revoked-again`、`uninstalled`、`reinstalled-denied`、`reinstalled-granted` 十阶段均通过。单测试 1/1，26.27 秒。收据 `passed=true`、`mechanismPassed=true`、`fullCandidateAccepted=false`、操作数 7、拒绝调用 35、独立对照调用 6，大小 9,237 字节；测试报告已删除其自己的隔离 scratch。
- 前后只读预算扫描：`target` 30,000,374,587 → 30,000,433,979 字节（+59,392）；task-scratch 1,137,864,612 → 1,137,873,849 字节（+9,237，即本次收据）；其他项目树不变，未知项 0。E 卷余量变化不归因于此测试。未创建第二套完整运行目录、清理有用缓存或改版本。

CI 同款资源路径补验：`bun run check`、平台检查定向 Vitest 7/7、Rust 静态检查和修改文件单独 rustfmt 检查均退出 0。带 `ZICODE_TEST_PREPARED_RESOURCES=1` 的 Windows 实际专项 1/1，七项与十阶段均通过，用时 26.28 秒；新收据 9,266 字节，`passed=true`、`mechanismPassed=true`、`preparedResources=true`、7 操作、35 拒绝与 6 对照。运行中记录的 Pi SHA-256 `EB2205E842D1B02A1A539E98618B20D6B055A008FA0B678EBBBEB004239F1365`、Broker SHA-256 `587D714F61102AAA1A8582AA61CD5BFC2530140391134E687FB360F8D35818B0` 与项目准备目录的对应文件逐字节摘要一致。前后预算扫描 `target` 30,000,433,979 → 30,000,457,531 B（+23,552），task-scratch 1,137,873,849 → 1,137,883,115 B（+9,266，即新收据），其他树不变、未知项 0；不以卷余量变化估算本测试占用。

进一步收紧矩阵收据门槛：除 `passed=true`，还要求 `mechanismPassed=true`、`preparedResources=true`、族名 `inspect`、操作数 7 和明确的 `fullCandidateAccepted=false`。错误资源来源、操作数或机制状态现在会让矩阵失败；定向 Vitest 8/8，实际 Windows 收据重新经该门槛判定为 true，`bun run check` 退出 0。该次检查前后 `target`、非 scratch `.cache`、task-scratch 和 `site` 逻辑大小不变，未知项 0。

干净 runner 的 Worker 前置条件另行收紧：`rust-tests` 后加入一次 `cargo build --locked --bin zicode-studio-desktop`，继续复用同一 Cargo target，确保 `resource-worker-http` 与 `devtools-inspect-pi-worker` 使用当前源码的 Debug EXE。既有本机 EXE 的时间早于今天的测试编译，不能用本机已有文件推断干净 CI 会自动生成它。此步骤是运行真实进程 Worker 专项的必要产物准备，不生成安装包、Release 或第二套运行目录；不用于代替静态检查。`bun run check` 与平台定义定向 Vitest 8/8 通过，定向检查要求全矩阵只有此一个受限 `cargo build` 且顺序正确。前后存储只读扫描四棵项目树逻辑大小完全相同、未知项 0；本轮未在本机执行新的 Cargo 构建。macOS/Linux 真实 runner 仍待。

远端接线核对：公开 `main` 为 `9cf5fd0b`，当前本地 HEAD `72f4b0ee` 与它并非祖先关系；当前工作树有 314 项其他未提交修改。远端 `compute_candidate_pi_tests.rs` 和平台脚本缺少本地后续的外部候选、资源 Worker 与收据扩展。仅从远端基线另造一个缩减验证分支会测试不同源码，不能证明当前 Studio 工作树跨平台通过，因此本阶段没有推送替代实现或打开 PR。后续需将当前 Studio 变更按现有工作流整理成可追踪修订，再让包含**相同源码与新增必需项**的远端矩阵运行并核对各平台收据。

## 验收边界

当前公开 [四平台成功运行 38950680629](https://github.com/ax2/zicode-studio-desktop/actions/runs/38950680629) 对应旧提交 `9cf5fd0b`，**不含**此新矩阵项。新项只有本机 Windows 实际通过，macOS arm64/Intel、Ubuntu 的提供方实包执行仍待该源码进入相应 runner 后确认。冻结候选只有 7 项，不是无签名 Inspect 0.1.1 的 8 项，更不是正式签名包或 DevTools 154 项完整范围；正式完整接受仍为 0/154。此专项不覆盖原生 WebView、安装/升级/回退、模型自主选择或真实用户数据。
