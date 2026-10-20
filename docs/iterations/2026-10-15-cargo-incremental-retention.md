# Cargo 增量编译缓存增长控制（2026-10-15）

## 目标

减少持续开发时反复生成的 Rust 增量编译缓存；保留现有 `target`、Debug/Release 运行产物和依赖缓存，不改变本地版本号及发布配置。

## 现状与决策

修改前只读空间扫描完整，`target` 为 28,711,448,811 字节 / 72,238 个文件，`.cache` 为 310,353,261 字节，`task-scratch` 为 748,164,366 字节，`site` 为 29,644,753 字节，所有 `UnknownEntries=0`；E 盘可用 61,227,941,888 字节。

对 `target/debug/incremental` 独立遍历发现 24 个目录，共 2,790,120,589 字节。较大的主 crate 缓存分布于多个会话目录。当前未见命令行指向本项目的 cargo/rustc/bun/tauri 构建进程。

将 `[profile.dev].incremental` 从 `true` 改为 `false`。测试继续继承 dev profile；Release profile 保持原配置。这个变更限制新增增量状态，不会删除已存在缓存，也不保证立即释放空间；Rust 修改后的本地编译可能耗时更长。

## 修改与验证

- 修改 `src-tauri/Cargo.toml` 的 dev profile。
- 更新 `docs/agents/disk-budget.md`，记录新策略及其成本。
- 使用现有项目 `target` 运行 Rust 静态检查，不运行测试、不执行清理。
- `bun run check:rust:static` 通过：所有目标 `cargo check` 与 warnings-as-errors Clippy 通过；`cargo fmt --check` 仍报告既有格式漂移 advisory。检查期间重编主 crate，Debug 版本号仍为 0.4.2。
- 检查前后 storage budget 扫描均完整、`UnknownEntries=0`。前后 `target` 分别为 28,711,448,811 B / 72,238 files 与 28,799,455,997 B / 73,278 files；`target/debug/incremental` 保持 24 个目录、2,790,120,589 B。E 盘可用空间从 61,227,941,888 B 变为 61,192,638,464 B。空间变化受其他进程影响，不据此归因或声称节省/增加了相同物理字节。

## 遗留

当前静态检查验证配置可用于本项目；检查前后增量目录数量和逻辑大小没有变化。连续编辑后的目录增长趋势与编译耗时尚未测量；已有缓存由用户另行决定是否清理，本轮没有删除文件或执行 `cargo clean`。
