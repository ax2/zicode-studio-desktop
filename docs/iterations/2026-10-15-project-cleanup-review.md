# 项目空间清理复核（2026-10-15）

## 目标

按“Debug 与 Release 各保留最新一份”的要求核对本机项目占用，给出可手工清理的精确路径；保留当前源码改动、最新开发运行环境、测试证据和插件夹具。

## 复核结果

- Git 工作树已有未提交源码、测试、文档和生成资源修改；本轮只读，没有覆盖或还原这些改动。
- `release/` 共约 8,199,426,024 逻辑字节：8 份旧本地开发运行副本合计 7,176,684,363 字节、81,425 文件；不可变的 `plugin-contracts-2026-10-09-02bd9552-dirty` 基线 898,951,325 字节；`worker-fixtures` 123,790,336 字节。
- `.cache/` 约 1,055,866,543 字节，其中 `.cache/task-scratch/` 约 745,513,282 字节，包含原生界面、插件、Host/Worker 验收夹具和截图。当前工作仍引用其中部分证据，未整体清理。
- 当前锁定 Pi 下载包 `.cache/pi-binaries/1.2.0-pi-windows-x64.zip` 为 45,099,534 字节，属于当前运行依赖，保留。
- `node_modules/` 为 430,599,885 字节；当前开发依赖，保留。
- E 盘检查时剩余空间为 9,591,652,352 字节（8.93 GiB）。卷空间会受其他进程影响，不能将前后差额都归因于本项目。

## 可手工清理的旧运行目录

以下目录均为旧的本地 development/unsigned/dirty 快照，不是正式 GitHub Release。其独有文件和 SHA 索引已归档在技术博客档案 `iterations/build-storage-2026-10-09/`。删除后将失去直接启动这些历史 EXE 的能力；恢复脚本只做过语法检查，尚未实测重建。此前自动审批拒绝了本项目对这些目录的清理，因此本轮不重试、不换工具执行。用户可在资源管理器逐项确认后手工删除：

- `E:\zicode-studio-desktop\release\devtools-catalog-paging-2026-10-08-02bd955-dirty` — 897,114,839 字节
- `E:\zicode-studio-desktop\release\devtools-integrity-2026-10-08-02bd955-dirty` — 896,956,189 字节
- `E:\zicode-studio-desktop\release\devtools-pi-catalog-2026-10-08-02bd955-dirty` — 897,146,237 字节
- `E:\zicode-studio-desktop\release\devtools-receiver-2026-10-08-02bd955-dirty` — 896,914,427 字节
- `E:\zicode-studio-desktop\release\devtools-results-2026-10-08-02bd955-dirty` — 897,574,194 字节
- `E:\zicode-studio-desktop\release\devtools-tool-access-2026-10-08-02bd955-dirty` — 896,966,164 字节
- `E:\zicode-studio-desktop\release\devtools-tool-access-persistence-2026-10-08-02bd955-dirty` — 897,044,638 字节
- `E:\zicode-studio-desktop\release\devtools-tool-navigation-2026-10-08-02bd955-dirty` — 896,967,675 字节

必须保留：

- `E:\zicode-studio-desktop\release\plugin-contracts-2026-10-09-02bd9552-dirty`：当前不可变归档基线，仍被历史索引及验收夹具引用。
- `E:\zicode-studio-desktop\release\worker-fixtures`：运行验收夹具。
- `E:\zicode-studio-desktop\target\debug`、`E:\zicode-studio-desktop\target\release`：当前构建缓存和本地构建输出，不通过 `cargo clean` 清空。
- 源码、依赖目录、用户数据和仍被验收记录引用的 `.cache/task-scratch` 内容。

## 实际操作与验证

- 本轮实际删除：0 文件、0 字节；没有绕过先前的审批拒绝。
- 仅完成只读目录清点与 Git 状态核对；未构建、未测试，也未修改现有工作树代码。
- 详尽归档与恢复材料：`C:\Users\ax2\Documents\技术博客\zicode-studio-desktop\iterations\build-storage-2026-10-09\manual-cleanup.md`、`RETENTION.md` 及对应目录清单。

## 2026-10-15 追加复核

- 重新运行只读 `scripts/storage-budget.ps1`：target 为 45,752,087,951 字节 / 82,011 文件；普通 `.cache` 为 310,353,261 字节 / 155 文件；task-scratch 为 745,636,956 字节 / 29,906 文件；site 为 29,644,753 字节 / 431 文件。所有扫描 `UnknownEntries=0`，卷查询成功。
- 本次结束复查时 E 盘可用空间为 9,266,987,008 字节（约 8.63 GiB）。相较先前记录减少的空间不能全部归因于本项目。
- 复核未发现本轮创建的可删除临时目录。已知验收 scratch 包含用户要求保留的过程证据；具体带有“删除”生命周期标记的目录中，有目录已在对应验收记录中因 `blocked by policy` 明确拒绝，按规则不改用其他工具重试。此前失败记录和 fixture 不因目录较旧而删除。
- 本次实际删除：0 文件、0 字节；当前仓库源码及未提交修改均保留。
- 若用户要手工释放主要空间，可先核对本文件“可手工清理的旧运行目录”列出的 8 个旧本地运行副本，合计 7,176,684,363 字节（约 6.68 GiB）。这些目录不是正式 GitHub Release；手工删除会失去直接启动旧版 EXE 的能力。`plugin-contracts-2026-10-09-02bd9552-dirty`、`worker-fixtures`、`target/debug`、`target/release` 及验收 scratch 不在该手工清理清单内。
- 2026-10-15 插件模型取消功能验证后复核：target 从 45,762,210,943 增至 45,777,609,552 字节，task-scratch 仍为 745,636,956 字节；E 盘可用空间从 17,485,987,840 降至 14,575,247,360 字节。扫描无未知项；卷变化受其他进程影响，不能全部归因项目。本轮没有清理 Cargo 缓存。
- 2026-10-15 在途取消 Host HTTP 回归后复查：target 45,772,369,391 字节、task-scratch 745,636,956 字节、E 盘可用 10,850,279,424 字节。没有切换 target 或清理 Cargo 缓存；卷余量较测试前减少约 3.47 GiB，但 target 逻辑量下降约 5 MiB，无法把变化归因于此次验证。

## 2026-10-15 再次清理盘点

- 项目只读空间扫描完整：target 45,772,369,391 字节 / 82,033 文件，其中 `target/debug` 约 38.25 GiB / 61,064 文件，`target/release` 约 4.38 GiB / 20,967 文件；`.cache` 310,353,261 字节 / 155 文件，`task-scratch` 745,636,956 字节 / 29,906 文件；`site` 29,644,753 字节 / 431 文件。所有扫描 `UnknownEntries=0`。
- E 盘当前可用 4,855,554,048 字节（约 4.52 GiB），低于项目预留线。卷余量变化不能仅归因于项目；本次没有启动构建或测试。
- 未发现适合自动删除的新文件。缓存仍是当前开发复用目标，scratch 内含仍被文档引用的验收材料；8 份旧运行副本的自动删除此前已被拒绝。按 `AGENTS.md` 与磁盘策略，不改用其他工具重试。
- 手工候选仍为前述 8 个旧运行目录，合计 7,176,684,363 字节（约 6.68 GiB）；另有 `.cache/task-scratch/model-generation-http-8a276874-56b9-4abf-8bf8-c38748396ed8`，76,457 字节 / 14 文件，测试 owner 标记为成功后删除。该目录清理同样曾被自动审批拒绝。两组路径均已列入技术博客 `iterations/build-storage-2026-10-09/manual-cleanup.md`。
- 本次实际删除：0 文件、0 字节。源码与未提交修改保留。未运行构建、测试或清缓存。

## 2026-10-15 后续空间复查

- 使用项目只读空间扫描完成全量检查：`target` 45,772,369,391 字节 / 82,033 文件；`.cache` 310,353,261 字节 / 155 文件；`.cache/task-scratch` 745,636,956 字节 / 29,906 文件；`site` 29,644,753 字节 / 431 文件。所有扫描 `UnknownEntries=0`，E 盘可用 9,679,806,464 字节（约 9.02 GiB）。
- 本轮实际清理：0 文件、0 字节。target 缓存、现有验收夹具与历史证据仍在使用或被引用；没有新的可安全自动清理候选。
- 主要可回收空间仍是前文列出的 8 个旧本地运行目录（约 6.68 GiB）。仓库规则记录该清理此前已被自动审批拒绝，禁止换用其他方式重试；本轮仅保留手工候选清单。

## 2026-10-15 当前会话复查

- 再次运行 `pwsh -NoProfile -File scripts/storage-budget.ps1`，只读扫描完整（所有 `UnknownEntries=0`）：`target` 45,772,369,391 字节 / 82,033 文件；`.cache` 310,353,261 字节 / 155 文件；`.cache/task-scratch` 745,636,956 字节 / 29,906 文件；`site` 29,644,753 字节 / 431 文件。
- E 盘可用 4,012,969,984 字节（约 3.74 GiB），低于预留线。命令退出码 1 代表空间预留不足；扫描数据本身完整。
- 当前工作树有多处既有未提交和未跟踪改动，均保留。没有发现新建且无引用的安全清理项；不清理当前 debug/release、Cargo 缓存、插件夹具或验收 scratch。
- 主要手工候选仍为前述8个旧本地运行目录，合计7,176,684,363逻辑字节；删除审批此前被拒绝，遵循项目规则不换工具重试。76,457字节测试 scratch 也有拒绝记录，不再次尝试。
- 本次删除 0 文件 / 0 字节；未构建、未测试、未运行 `cargo clean`。空间数字按逻辑字节报告，卷可用空间变化不能归因于本项目单独活动。

## 2026-10-15 插件 profile 定向验证后复查

- 重跑只读扫描后：`target` 45,766,565,236 字节 / 82,036 文件；`.cache` 310,353,261 字节 / 155 文件；`.cache/task-scratch` 745,636,956 字节 / 29,906 文件；`site` 29,644,753 字节 / 431 文件；所有 `UnknownEntries=0`。
- E 盘可用 13,654,962,176 字节（约 12.72 GiB），扫描仍因低于项目预留线而返回 1。与前次扫描的卷余量变化受其他进程影响，不能归因于项目；构建 target 逻辑量约 42.62 GiB，未清理缓存。
- 本轮运行的是静态检查与3项 profile 定向测试；保留当前 Debug/Release、插件验收材料与任务 scratch。没有删除文件；此前拒绝的旧运行目录与 scratch 清理仍只保留手工清单，不换工具重试。

## 2026-10-15 内存预留复核后空间复查

- 定向测试新增并发槽用例后再次扫描：`target` 45,775,539,187 字节 / 82,036 文件；`.cache` 310,353,261 字节 / 155 文件；`task-scratch` 745,636,956 字节 / 29,906 文件；`site` 29,644,753 字节 / 431 文件。各项 `UnknownEntries=0`。
- E 盘可用 10,336,329,728 字节（约 9.63 GiB），仍低于项目预留线。卷可用空间变化无法归因于当前小型目标测试；target 约 42.63 GiB，缓存保持原样，未删除文件。

## 2026-10-15 图片工具验证与存储扫描追加

- 图片错误结果映射完成后，Rust 静态检查通过。第一轮并行 cargo 定向测试编译遇到 rustc 内存分配失败；改为 `-j 1` 且仅测试主应用 bin 后，图片 profile 用例 5 passed、0 failed、610 filtered。
- Computer Use 状态返回没有可操作的 Windows app window，真实 UI 截图与目录安装步骤未能执行；本轮不据此宣称完整接入验收。
- 存储扫描完整且无未知项：target 45,830,456,035 B / 82,060 files；cache 310,353,261 B / 155；task-scratch 745,636,956 B / 29,906；site 29,644,753 B / 431。E盘剩余 20,991,143,936 B。没有删除文件或清理缓存。

## 2026-10-15 Host image-resize 接收后清理复核

- Studio 本地 Debug EXE 生成与实际 Host HTTP 插件验收后再次扫描：`target` 45,831,529,453 B / 82,064 files；`.cache` 310,353,261 B / 155；task-scratch 747,858,111 B / 29,929；site 29,644,753 B / 431；所有 UnknownEntries=0。E盘可用 21,071,519,744 B；卷余量变化不单独归因于项目。
- 真实 Host 测试成功后会清理本轮自有 scratch；首次失败和修复前通过共遗留两个 `host-image-resize-*` 目录，分别约1,110,477 B与1,110,678 B，owner 均指向本轮 Host HTTP 验收。
- 按绝对路径与项目 scratch 根目录核对后请求删除，自动审批拒绝；没有换工具重试。两个目录留给用户手工处理，合计2,221,155 B。以前列出的8个旧本地运行目录仍因更早拒绝而不重试。
- Debug EXE 与 Release 缓存均保留，没有执行 cargo clean。`git diff --check` 通过。

## 2026-10-15 再次空间扫描

- Host E2E与预览组件定向测试之后只读扫描：target 45,832,228,803 B / 82,064 files；cache 310,353,261 B / 155 files；task-scratch 747,858,111 B / 29,929 files；site 29,644,753 B / 431 files；UnknownEntries=0；E盘可用 21,071,863,808 B。
- 相较前次扫描target逻辑量有增减，卷空间也有变化；本机其他进程会影响，不把差额全归于此项目。本轮没有再次清理被拒绝的两个 Host 验收 scratch，也没有执行cargo clean。

## 2026-10-15 用户再次提出空间过大

- 重新运行只读扫描，完整且 `UnknownEntries=0`：target 45,832,228,803 B / 82,064 files（约42.68 GiB），普通 `.cache` 310,353,261 B / 155 files（约0.29 GiB），`task-scratch` 747,858,111 B / 29,929 files（约0.70 GiB），site 29,644,753 B / 431 files（约0.03 GiB）。E盘可用空间19,246,993,408 B（约17.92 GiB）；低于20 GiB参考预留线。
- 分类复核：`target/debug` 约38.30 GiB，`target/release` 约4.38 GiB；仓库 `release/` 约7.64 GiB。后者含必须保留的归档基线与worker fixtures，以及前述8份旧dirty本地运行副本；这8份仍合计约6.68 GiB，路径和单项字节数见本记录前文。
- 未发现新的未引用缓存或临时目录；8份旧运行副本及此前被拒绝的 Host 验收 scratch 仍受禁止改用其他工具删除的规则约束。本次实际删除0文件/0字节，没有执行 `cargo clean`；当前无 cargo/rustc/bun/tauri 构建进程。
- `target` 当前体量明显高于本项目12 GiB的参考规模。它包含Rust多个配置的依赖、链接与增量编译产物；保留缓存能减少后续构建时间。主要可回收量仍是8份已列明的旧运行副本约6.68 GiB，需用户在资源管理器手工清理；清理后的卷空间变化也会受其他进程影响。

## 2026-10-15 HTTP profile 矩阵检查后的复扫

- `scripts/devtools-pi-evidence.test.js`：1个文件、4项通过。该检查未运行Rust或Tauri构建。
- 前后完整只读扫描结果相同：target 46,418,683,581 B / 82,098 files；`.cache` 310,353,261 B / 155；task-scratch 747,858,111 B / 29,929；site 29,644,753 B / 431；所有 `UnknownEntries=0`。
- E盘可用空间由 18,533,761,024 B 变为 18,533,376,000 B（减少 385,024 B）；target逻辑字节与文件数没有变化。该卷差值不能归因于测试，可能受其他进程影响。
- 本轮没有清理缓存或被拒绝的旧运行副本；Rust静态检查因当前低于20 GiB保留线而未启动。精确手工候选与自动审批拒绝记录仍见本文件上文。

## 2026-10-15 HTTP profile 验证后复扫

- 后置空间扫描完整且无未知项：target 45,849,259,029 B / 82,102 files；`.cache` 310,353,261 B / 155；task-scratch 747,858,111 B / 29,929；site 29,644,753 B / 431。
- E盘可用21,780,320,256 B（约20.28 GiB），高于20 GiB参考保留线。target及卷余量较此前读数有变化；本轮没有手动删除缓存，不能把波动归因于检查。
- `bun run check`、41项插件前端测试、`bun run check:rust:static` 与HTTP模块4项Rust单测均已执行；没有运行完整release构建或 `cargo clean`。

## 2026-10-15 后续目录分解（只读）

- 原生 .NET 目录遍历得到 `target/debug` 41,145,121,515 B / 61,133 files（38.32 GiB），`target/release` 4,704,136,231 B / 20,967 files（4.38 GiB），与上次完整 target 总量相符。`target/tmp` 为空。
- `target/debug` 中 incremental 为 18.56 GiB / 11,663 files，deps 为 15.66 GiB / 9,268 files，build 为 2.81 GiB / 15,755 files。最大单项是增量编译状态，不是重复的 Debug/Release 运行目录；仅凭目录时间无法证明哪些 crate 缓存可删。
- `.cache` 合计约 0.99 GiB（包含 task-scratch）；仓库 `release/` 本轮遍历约 0.12 GiB。E 盘可用 30,829,637,632 B（约 28.71 GiB）。目录扫描期间没有文件变更。
- 检查到的活动 Cargo/Rust 任务命令目标明确指向另一个 `E:\zi-devtools\target\release`。按项目边界没有检查/改动该仓库；本轮未运行 Studio 构建，也未删除任何文件或缓存。
- 结论：Rust 依赖图庞大且保留增量状态会让占用增长，但 Studio 的 Debug 缓存 38.32 GiB 已明显偏高。后续应在不构建期间，依据缓存所属 fingerprint 与现有验收基线列出具体过期 incremental 候选，再按已记录的清理审批边界处理；本次没有足够证据安全挑出可删缓存。

## 2026-10-15 历史运行归档源复核

- 当前仓库 `release/` 下，手工清理清单列出的8份旧运行目录及受保护的 `plugin-contracts-2026-10-09-02bd9552-dirty` 基线均不存在；该目录目前仅有 `worker-fixtures`。本轮未执行删除，无法判定这些路径何时、由谁移除，也不把卷空间变化归因于它们。
- 技术档案中的8份 inventory、`retained-content/` 与 `restore-runtime.mjs` 仍存在，但各inventory仍引用缺失基线；恢复脚本要求先校验来源哈希，基线缺失时不能恢复。当前 `target/release/zicode-studio-desktop.exe` 仍在，但没有证据证明它与历史基线逐文件哈希相同。
- 手工清理清单中的8路径现标为历史记录，不再是当前候选；缺失基线作为归档完整性遗留事项记录。未尝试恢复，不改动 ZiDevTools。

## 2026-10-15 旧主 crate 增量缓存清单

- 只读复核列出47个 target/debug/incremental/zicode_studio_desktop-* 目录，最后写入时间早于本日；合计15,729,409,951逻辑字节、文件数详见技术档案手工清单。最新验证日的7个同名增量目录全部保留，Debug/Release EXE也仍在。
- 删除请求在执行前被自动审批策略拒绝（仅返回 blocked by policy，没有具体原因）；没有删除任何缓存，没有改用其他工具重试。精确绝对路径、字节数和各自最后写入时间已记入技术博客档案 iterations/build-storage-2026-10-09/manual-cleanup-incremental-2026-10-15.md。
- E盘项目存储基线扫描通过：target 45,849,259,029 B / 82,102 files，UnknownEntries=0，卷可用29,166,649,344 B。清理未执行，因此没有清理后扫描或空间释放数据。
