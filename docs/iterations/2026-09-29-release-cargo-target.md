# 2026-09-29 Release Cargo 目标校验

## 目标与发现

- Release 矩阵在下载 Pi、Bun 等内置运行时前检查 runner 系统、进程架构和 `rustc` 主机 triple。
- Cargo 的 `CARGO_BUILD_TARGET` 可以单独改变后续 Tauri 编译目标。若它与矩阵目标不一致，原检查仍会通过，可能把另一架构的应用与内置运行时打在一起。

## 修改与决策

- 发布目标检查现读取显式 `CARGO_BUILD_TARGET`；非空且不等于目标 triple 时立即失败。
- 未设置时仍按当前仓库配置的宿主目标构建；保留 runner 架构与 `rustc` 主机 triple 的既有检查。
- 本轮未改变发布矩阵、产物格式或运行时下载策略。

## 验证与遗留

- 静态核对 Release 工作流的检查顺序和仓库 `.cargo/config.toml`；`node --check scripts/check-release-target.mjs` 与目标文件 `git diff --check` 通过。
- 未运行测试、发布构建或远端矩阵。环境变量之外的本机 Cargo 用户配置仍可能影响实际编译；产物架构与实机启动需发布流程再核对。
- 仅更新本地工作树，未发布。
