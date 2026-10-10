# CMake 预设任务工作日志

## 目标与发现

固定的 `build/zicode-studio` 命令无法遵循项目声明的生成器、工具链和构建目录。CMake 项目通常将这些设置写在根目录 `CMakePresets.json`；直接拼接来自界面的预设名会失去现有任务目录指纹与服务端重新确认机制。

## 修改与决策

- 在已有 `CMakeLists.txt` 的所选目录读取根 `CMakePresets.json`，从其配置、构建和测试数组发现有名称的预设；每类至多 32 个，总计至多 64 个。
- 忽略隐藏预设与字面值 `condition: false`。其他条件、继承和包含文件留给 CMake 运行时解析；只在根预设中发现任务。
- 使用固定的 `--preset` 参数序列与从清单读取的预设名。用户界面不提交自由形式命令；启动前仍重新读取目录并校验目录指纹。
- 指纹包含根预设和存在时的 `CMakeUserPresets.json` 原始字节，不展示其内容。单个清单仍受 256 KiB 上限与普通文件路径边界约束。
- 预设输出目录由 CMake 决定，可能位于项目外；已有固定 CMake 任务仍使用受检查的 `build/zicode-studio`。界面和帮助文档分别说明两种边界。

## 验证

已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2537 个中文词条，缺失 0）、`bun run build:react`、Rust `cargo check --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。`bun run check:rust` 在 `cargo check` 通过后进入测试编译，已中止，未运行测试。全仓 `cargo fmt --check` 报告其他既有工作区文件的格式差异。未执行项目 CMake 命令或运行时测试。

## 遗留问题与风险

- 未读取包含文件中的预设，也未单独发现用户预设；修改包含文件不会改变目录指纹。
- 条件表达式和继承链由 CMake 判定；列表出现不代表在当前操作系统可运行。
- 预设可选择项目外构建目录、调用外部程序或下载依赖，运行前需检查清单及相关包含文件。
- 尚缺 Windows、macOS、Linux 项目预设的实机验收。

## 2026-09-27 接续：Windows 批处理参数边界

复查发现，项目预设名虽然作为独立参数交给 EXE，但 Windows `.cmd` 工具包装器会经由 `cmd.exe` 接收拼接后的参数文本。现对所有 `.cmd` 管理器参数统一施加 ASCII 字面值白名单，拒绝空格、引号、百分号、感叹号和其他批处理元字符；预设名若不符合规则，显示专门错误并要求改用 EXE 或重命名。Linux/macOS 和 Windows EXE 仍可接受正常的带空格或 Unicode 预设名。该检查位于公共命令构造边界，不依赖前端限制。

开发环境页同时标出根 `CMakePresets.json` 与 `CMakeUserPresets.json` 是否存在；只读报告不解析或展示用户预设内容。

本次接续已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2540 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未运行项目命令或测试，Windows `.cmd` 与预设名组合仍待实机验收。

## 发布结果

本阶段仅更新本地工作区，没有发布或打包。
