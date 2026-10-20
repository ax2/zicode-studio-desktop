# 旧 Debug 增量目录消失的只读复核（2026-10-18）

用户表示将手动清理 `E:\zicode-studio-desktop\target\debug\incremental`。此前 Studio 代理对该路径的删除被自动审批拒绝，本轮没有再次申请、删除或换工具绕过。

清理前完整只读预算：`target` 30,041,815,353 逻辑字节、75,961 文件，`UnknownEntries=0`；该增量目录此前独立清单为 1,799 文件、2,790,120,589 逻辑字节。清理过程与一次预算扫描重叠，该次结果不可作为稳定后态。随后核对增量目录不存在，Debug EXE 125,336,576 字节、Release EXE 52,701,184 字节仍在，Studio 进程未运行。稳定后完整扫描：`target` 27,251,694,764 逻辑字节、74,162 文件，`UnknownEntries=0`；差值恰好是上述目录的 2,790,120,589 字节和 1,799 文件。`.cache`、task-scratch、`site` 在两次完整扫描中均保持各自原逻辑量。

E: 卷可用空间在并行活动期间一度显示 0，稳定后扫描为 11,711,250,432 字节。卷余量变化大于本项目 `target` 的逻辑差值，来源不能仅归于此目录。逻辑大小也不等于实际释放的物理空间；不声明本轮代理释放了磁盘。本记录只证明后态和可复用 EXE，不能由目录名推断其他缓存可删。

后续继续复用当前 Debug/Release 运行目录与剩余 Cargo 缓存。空间仍低于 20 GiB 建议储备，任何大型 Rust 构建前重新预算。无应用版本或发布产物变化。

## 同日后续复核

只读预算重新扫描：`target` 22,547,934,120 逻辑字节、53,213 文件，`.cache`（不含 task-scratch）355,458,670 字节、156 文件，`task-scratch` 1,411,021,038 字节、36,500 文件，`site` 29,644,753 字节、431 文件；未知条目均为 0，E: 可用 36,717,391,872 字节，预算脚本退出 0。`target/debug/incremental` 存在但为 0 文件。`target/debug` 的 `deps` 占 17,884,025,302 字节、`build` 占 3,266,316,357 字节；这两项仍是当前 Rust 编译缓存，未按容量阈值删除。

本次观察到 Debug EXE 仍在、Release EXE 已不在 `target/release`，与上文较早时点的“Release EXE 仍在”不矛盾。两次扫描间还有其他活动，不能把 4.70 GB 的 `target` 差额或卷空闲增长归因于本会话。保留一个 Release 完整运行目录的要求目前未在项目 `target/release` 达成；未为了填补它而临时发起大型 Release 构建。当前没有 Studio 进程运行。

同时经官方 GitHub Releases API 核对，`earendil-works/pi` 最新非草稿、非预发布正式版为 `v1.3.0`，发布于 2026-10-15T19:17:33Z；`scripts/pi-version.json` 与 `package.json` 中两个 Pi 开发依赖均固定 `1.3.0`。本轮无需升级 Pi 或改变应用开发版号 `0.4.2`。这只是版本一致性复核，不代表重新运行 Pi RPC、重建 Studio 或验收 DevTools/ZiFile。DevTools 完整接受仍为 0/154，ZiFile 为 0/108。
