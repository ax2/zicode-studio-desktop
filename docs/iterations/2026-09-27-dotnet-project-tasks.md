# .NET 项目任务工作日志

## 目标与发现

既有项目目录发现依赖固定清单文件名，不能把名称任意的 .NET 解决方案和项目文件作为独立目标。直接在多目标目录运行 `dotnet build` 会把目标选择交给工具，结果可能与界面所选不一致。

## 修改与决策

- 在所选目录扫描 `.sln`、`.slnx`、`.csproj`、`.fsproj`、`.vbproj`；单目录最多检查 2048 个条目、列出 16 个目标，按文件名稳定排序。
- 每个目标提供固定还原、构建、测试任务；项目文件另提供发布任务。启动参数包含 `./文件名`，不接受界面提交的自由形式目标路径。
- 目标文件内容加入任务目录指纹；Host 启动前重新读取目标清单和指纹。
- 子目录发现、环境清单和 dotnet CLI 版本诊断接入同一目标范围；只读环境报告不执行 MSBuild 目标。
- Windows `.cmd`/`.bat` 包装器沿用 ASCII 参数保护；带空格或特殊字符的目标应通过 dotnet EXE 启动。

## 验证

已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2545 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未运行 .NET 项目命令或测试。

## 遗留问题与风险

- 本阶段未解析 `global.json`、SDK 选择、MSBuild 导入、NuGet 配置或多目标依赖图；后续已将工作区内最近的 `global.json` 纳入指纹并展示 SDK 声明，详见[.NET SDK 选择日志](2026-09-27-dotnet-sdk-selection.md)。清单存在仍不等于本机 SDK 满足要求。
- 超出扫描/目标数量或单清单 256 KiB 上限时任务目录会报错；大型仓库需要更细的子项目选择或后续分页发现。
- .NET 任务可能执行自定义目标、下载包并写入任意项目配置的位置；Windows、macOS、Linux 的真实构建验收仍待完成。

## 发布结果

本阶段仅更新本地工作区，没有发布或打包。
