# 发布目标架构核对（2026-09-28）

## 目标与发现

Release 矩阵按系统指定 `PI_TARGET_PLATFORM`，内置 Pi 和 Bun 下载脚本据此选择二进制。工作流此前没有在打包前核对 runner、Rust host triple 与该目标一致。目标配置或 runner 类型变化时，可能下载错误架构的运行时，等到后续执行或安装才暴露问题。

## 修改

- 新增只读发布检查，根据 release 矩阵的三个目标分别核对当前系统、进程架构和 `rustc -vV` 的 host triple。
- 在获取缓存和运行时之前执行检查；不一致即中止该平台构建，其他平台因矩阵 `fail-fast: false` 继续报告结果。
- 不改变目标平台、签名配置、更新产物开关或发布权限。

## 验证与限制

`node --check`、定向 Biome 检查、Release YAML 解析、`bun run check`、离线 MkDocs 严格构建及 `git diff --check` 均通过。全局检查保留现有告警。本轮未运行测试、触发发布或运行跨平台 CI。静态核对不能替代三个 runner 上的实际检查，也不能证明安装包能在目标系统启动。
