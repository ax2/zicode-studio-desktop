# 自动化后台登录启动（2026-10-01）

## 目标与发现

独立 worker 已能在桌面窗口关闭后运行，但用户需要每次手动启动。最初接入 Tauri v2 的 autostart 插件；检查其依赖 `auto-launch 0.5.0` 的实现后发现，Windows 注册表命令和 Linux `.desktop` 的 `Exec` 直接拼接未经引用的可执行路径，含空格的安装位置会无法正确启动。macOS LaunchAgent 还直接插入未经 XML 转义的路径。Linux AppImage 的资源目录位于临时挂载点，不能把本次挂载路径写进下次登录使用的启动参数。

## 修改与决策

- 桌面自动化中心新增“登录系统后启动后台自动化”开关；默认不注册登录项。读取和修改只接受原生工作区窗口及当前桌面 Host 来源，写入后重新读取系统状态确认。开启前检查当前安装资源完整。
- 改用独立的平台登录项模块：Windows 的 Run 命令引用可执行路径并维护系统启动许可，缺失的 Run 键在用户开启时创建；Linux 的 `.desktop` 对 `Exec` 路径引用与转义，macOS LaunchAgent 对路径进行 XML 转义。三平台继续使用同一个登录项名称，已有插件生成的登录项可以识别和更新；用户级文件锁串行化本应用多进程的读取、修改与路径修复。
- 登录项只向当前可执行文件传 `--zicode-automation-worker`。worker 每次启动时根据当前安装环境解析 `public` 资源目录；开发调用仍支持显式 `--public-dir`。避免将 AppImage 临时挂载路径持久化。
- 桌面 Host 成功启动后，只对已启用且仍带 worker 参数的登录项刷新可执行路径，以适应更新后 AppImage 文件名或安装位置变化；没有开启的登录项不会被自动创建。
- 开发构建不能读取或修改系统登录项，也不执行路径修复，避免运行临时 `target/debug` 可执行文件时覆盖已安装版本的登录配置；登录项开关只在安装构建中可用。
- Linux 登录项遵循绝对路径的 `XDG_CONFIG_HOME/autostart`；未设置或设置为相对路径时回退到 `~/.config/autostart`。本地三平台工作流配置了各系统 Cargo check 与 Clippy，但尚未对当前工作树产生远端运行证据，也不会模拟图形会话登录或安装更新。
- 登录开关从下次登录生效；当前会话的主动启动与停止按钮仍分别控制本次 worker。worker 使用原有用户级单实例锁与自动化执行锁，多个桌面进程不会因此并行派发同一规则。
- 同步中英文帮助页：桌面 Host 扫描所有已注册工作区；独立 worker 可在窗口关闭后继续运行；登录启动是用户可选项。

## 验证与遗留

`bun run build:react`、`bun run bundle-css`、`bun run typecheck`、`bun run check` 与编辑文件的 Biome lint 在前端实现后退出 0。仓库检查报告现有警告，无阻断诊断。替换登录项实现后的 `bun run check:rust:static` 最终退出 0，包含 Windows Cargo check 与以警告为错误的 Clippy；新增模块经 `rustfmt` 格式化，仓库级 `cargo fmt --check` 仍提示其他格式漂移。未运行测试、实际登录启动或安装包验收。Windows 登录项、macOS LaunchAgent、Linux 桌面环境及 AppImage 的真实路径与进程生命周期需分别验收；关闭桌面窗口后的持续执行与系统重启后的恢复尚无实机证据。

静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,967 个文件、约 3.3 GiB；源码与打包资源保留。

替换登录项实现并再次检查后又执行一次 `cargo clean`，移除 18,945 个文件、约 3.3 GiB。当前不保留 Rust 构建缓存。

补齐 `XDG_CONFIG_HOME` 目录选择后，`bun run check:rust:static` 再次退出 0；该结果仅覆盖本机 Windows 编译目标。随后 `cargo clean` 再次移除 18,945 个文件、约 3.3 GiB，构建缓存未保留。Linux/macOS 条件代码仍需在各自平台的真实运行中验收。
