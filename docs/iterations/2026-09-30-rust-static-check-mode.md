# Rust 静态检查入口（2026-09-30）

## 发现

仓库 `AGENTS.md` 把 `bun run check:rust` 描述为 check、Clippy、fmt，但实际 `scripts/check-rust.sh` 在 check 后还会执行 `cargo test`。上一轮 uv 开发中已在测试编译阶段中断，未执行测试用例；完整模式同时被 Release 工作流使用，不能直接移除其测试门槛。

## 修改

- Shell 脚本新增 `--static-only`：保留 `cargo check --all-targets`、`cargo clippy --all-targets -- -D warnings`、建议性质的格式检查，跳过 `cargo test`。
- Node 包装器透传命令参数，`package.json` 新增 `check:rust:static`；不带参数的 `check:rust` 与 Release 工作流继续执行原完整流程。
- `AGENTS.md` 更新日常 Rust 编辑命令、完整模式用途和真实步骤，避免把日常编译检查误当作测试授权。

## 验证与边界

`node --check scripts/check-rust.mjs`、Portable Git Bash 的 `bash -n scripts/check-rust.sh`、`bun run check` 和相关文件的 `git diff --check` 通过。实际执行 `bun run check:rust:static` 退出码为 0，输出依次为 `cargo check`、`cargo clippy`、建议性质的 `cargo fmt --check`，没有进入 `cargo test`；格式检查提示仓库存在格式漂移。`bun run check` 报告 123 条警告、7 条提示与一条设计警告，退出码为 0。随后 `cargo clean` 清理本轮 3.2 GiB 编译产物。本轮未运行 Rust 测试。完整 Release 工作流是否继续通过，仍以远程运行证据为准。
