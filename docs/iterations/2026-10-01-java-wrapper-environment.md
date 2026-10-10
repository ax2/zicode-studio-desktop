# Java 项目 wrapper 与环境诊断工作日志（2026-10-01）

## 目标与发现

项目任务在有 Maven/Gradle wrapper 时优先使用它；环境页却只探测宿主 CLI。宿主未安装 `mvn` 或 `gradle` 时，页面会提示安装，即使当前项目可通过 wrapper 运行固定任务。

## 修改与决策

- Host 在当前命令目录只读检查对应 Java 清单和平台 wrapper 文件。复用任务目录已有的文件边界与大小校验；Unix 还要求可执行位。检查过程会有界读取 wrapper 文件用于既有摘要逻辑，但报告只包含确认可用的 `mvn`/`gradle` 标识，不返回或执行文件内容。
- 环境页保留宿主 CLI 的真实探测结果，同时说明当前目录已有可用的项目 wrapper；有可用 wrapper 时不再对缺失的宿主 CLI 给出安装提示。旧 Host 没有新字段时按空列表兼容。任务清单其他错误仍可能阻止运行。
- 不改变固定任务选择、执行或权限边界。若 wrapper 无效，任务原有的拒绝行为仍有效。

## 验证与遗留

TypeScript、前端静态检查、i18n 覆盖和 React 构建通过。Rust 首轮检查发现 Windows 条件编译下的未使用变量，修正后 `bun run check:rust:static` 通过；全仓库格式检查仍提示既有其他文件的漂移，本轮 Rust 文件的独立格式检查通过。检查后执行 `cargo clean`，清理了约 3.2 GiB 再生构建缓存。没有运行测试。Windows、macOS、Linux 的真实 wrapper 启动与界面验收仍待补。
