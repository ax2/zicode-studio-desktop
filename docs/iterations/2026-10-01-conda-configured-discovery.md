# Conda 配置目录与当前激活环境发现（2026-10-01）

## 目标与发现

原有只读发现仅覆盖 `~/.conda/environments.txt` 与 `~/.conda/envs`。安装在其他位置且未写入登记文件的环境需要手动输入完整 prefix；Conda 支持通过 `CONDA_ENVS_PATH` 指定额外环境目录。

## 修改与决策

- 桌面 Host 额外读取继承的 `CONDA_PREFIX` 与 `CONDA_ENVS_PATH`，只接收绝对路径。当前激活 prefix 作为单个候选，配置环境目录最多 16 个，合计最多枚举 256 项；达到上限明确标记截断。
- 所有候选继续通过原有 Conda prefix 结构与解释器校验，按规范化路径去重。来源标识在环境页区分登记文件、用户目录、宿主激活和配置目录；选择只填草稿，保存后再由 Host 校验并应用。
- 不执行 Conda、Python 或激活脚本，也不从继承的 `CONDA_PREFIX` 自动决定项目解释器。缺失的配置目录跳过，其他读取错误显式报错。
- 中英文帮助同步来源与上限。未设置这些变量的其他安装位置仍可用文件夹选择器或绝对路径手动添加。

## 验证与遗留

`bun run typecheck`、`bun run check`、中文词条覆盖、`bun run build:react`、修改模块的 `rustfmt --check` 与 `bun run check:rust:static` 均通过；全仓库 Rust 格式检查仍报告既有 advisory 漂移。`cargo clean --manifest-path src-tauri/Cargo.toml` 随后移除本轮约 3.3 GiB 构建文件，仓库根目录 `target` 已消失。本轮不新增或运行测试。Windows、macOS、Linux 的真实 Conda 配置、路径分隔符、文件权限和界面验收仍待完成。
