# Java 项目任务工作日志

## 目标与发现

项目运行器已支持 JavaScript、Rust、Go、Python 和 CMake，却未识别 Maven/Gradle 项目。Maven 和 Gradle 通常通过项目 wrapper 固定工具版本；只调用宿主工具会偏离项目要求。

## 修改与决策

- `pom.xml` 提供固定的 `validate`、`test`、`package` 阶段；Gradle 构建或设置清单提供 `tasks`、`test`、`build`。支持仅有 settings 文件的多项目仓库根目录。
- 优先选择当前目录的操作系统对应 wrapper；没有 wrapper 才查项目工具目录和宿主工具。wrapper 存在但无效时拒绝降级使用系统版本。
- Windows `.cmd` 与 `.bat` 经同一受限批处理参数路径执行；这批任务的参数均是固定 ASCII 阶段名。
- 目录指纹读取根构建/设置文件、`gradle.properties`、wrapper 脚本和存在时的 wrapper properties。任务由 Host 在启动前重新读取和匹配。
- 环境页只对配置或宿主的 Java/Maven/Gradle 执行版本查询，不在只读诊断中运行项目 wrapper。

## 验证

已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2543 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未运行 Maven、Gradle 项目命令或测试。

## 遗留问题与风险

- 未解析 Java 版本声明、Gradle 插件任务、Maven profile、项目模块及依赖图；目录清单存在不保证固定任务可用。
- 未追踪 wrapper JAR、Gradle 插件、Maven 扩展或远程依赖；执行前需检查项目清单及 wrapper 来源。
- wrapper 与构建脚本可执行代码、下载内容并写入文件。Windows、macOS、Linux 的实际构建和打包尚待实机验收。

## 发布结果

本阶段仅更新本地工作区，没有发布或打包。
