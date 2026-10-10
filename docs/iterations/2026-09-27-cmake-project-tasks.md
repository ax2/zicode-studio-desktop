# 2026-09-27 CMake 项目命令

状态：本轮实现与静态检查完成；跨平台 CMake 实际运行待办。

## 发现与决策

- 环境页此前只识别 `CMakeLists.txt` 的存在；目录发现与项目命令没有 CMake 路径。CMake 是 Windows、macOS 和 Linux 常见的跨平台项目构建入口。
- 为当前选中目录的根 `CMakeLists.txt` 提供固定配置、构建和测试命令。输出用项目内 `build/zicode-studio`，避免复用用户其他构建目录；不从前端接收可执行路径或任意参数。
- 启动前检查固定构建目录及父级：文件、链接和 Windows 重解析点都拒绝。工具从已配置的项目工具目录或宿主路径选择，命令仍由 Host 管理生命周期、输出与停止。
- 环境页分别探测 CMake、CTest。清单指纹包含根文件内容，不解析 include 的完整依赖图；配置命令可能执行项目代码，需明确告知用户。

## 工作记录

- 共享目录发现加入 `CMakeLists.txt`。新模块 `cmake_tasks.rs` 在所选目录提供固定 `configure`、`build`、`test` 任务，分别调用 CMake、CMake 与 CTest；任务目录指纹包含根清单内容。
- 启动前校验 `build` 和 `build/zicode-studio`，拒绝文件、链接、Windows 重解析点或越界目录；输出目录不存在时由 CMake 配置命令创建。继续使用已有工具目录优先级、Host 进程回收、有界输出和运行历史。
- 环境页增加 CMake 与 CTest 版本探测；命令列表显示配置先于构建/测试的提示和项目代码执行边界。中英文帮助、平台计划与导航同步。

## 验证记录

- `bun run typecheck`：通过。
- `bun run check`：通过；现有 111 条 warning、7 条 info，以及生成终端包的内联高度提示。
- `bun scripts/check-i18n-coverage.mjs`：通过；2535 个键，缺失 0。
- `bun run build:react`：通过；保留项目和既有金融工作台生成包，恢复其他原本干净的生成包。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets` 与 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；旧页面未列入导航的提示仍存在。
- 本轮未新增或运行测试，也未调用真实 CMake/CTest、验证生成器选择、安装器或 macOS/Linux 运行。

## 遗留与发布

- 任务目录指纹只覆盖根 `CMakeLists.txt`，未解析 include、子目录或 presets；修改引用文件后应重新配置。未处理跨平台生成器、工具链文件或构建变体选择。
- `ctest --test-dir` 需要支持此参数的 CTest；工具版本探测仅展示版本，不自动保证项目最低版本满足。
- 本轮只保留本地代码、构建产物和文档；未提交、推送或发布。
