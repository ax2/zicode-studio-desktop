# AppImage 后台 worker 稳定启动路径（2026-10-01）

状态：本地源码已修改；Linux AppImage 实机验收待完成。

## 目标与发现

Linux 登录启动条目已经保存原始 `.AppImage` 文件路径，但桌面内的“启动后台自动化”和更新后恢复共用 `current_exe()`，并把当前 `public` 目录作为参数传入。AppImage 运行时的当前可执行文件与资源目录通常位于临时挂载点；窗口进程退出后，该路径不适合作为独立 worker 的长期资源位置。

## 修改与决策

- Linux 上仅当当前可执行文件位于绝对 `APPDIR` 挂载目录内时，读取绝对且仍存在的 `APPIMAGE` 文件作为子进程入口。缺少或失效的原始文件会明确报错，不在已识别的 AppImage 场景退回临时挂载路径。
- 由原始 AppImage 重新启动的 worker 不接收父进程的 `--public-dir`；它按已有无参数入口在自己的运行环境解析内置资源。普通 Linux 安装、Windows、macOS 和开发构建继续使用当前可执行文件与显式资源目录。
- 启动、单实例锁、停止、更新独占锁和状态确认仍沿用原有路径。用户没有开启 worker 时不产生新进程。

## 验证与遗留

`bun run check:rust:static` 退出 0，含 Windows Cargo check 与以 warning 为错误的 Clippy；仓库级 rustfmt 仍有既有 advisory 漂移，目标 `launcher.rs` 格式检查及修改文件的 `git diff --check` 通过。随后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,951 个文件、约 3.3 GiB 本轮编译产物。未新增或运行测试。Windows 上的静态编译不能证明 Linux AppImage 运行时的 `APPDIR`、`APPIMAGE`、FUSE 挂载及子进程资源解析；需在安装后的 AppImage 中真实启动、关闭桌面窗口、停止和更新恢复。

## 2026-10-02 资源路径复核

当前 `Cargo.lock` 锁定 `tauri-utils 2.9.2`。本机 Cargo registry 中该版本的 `Env::default()` 从进程环境读取 `APPDIR` 和 `APPIMAGE`；Linux `resource_dir()` 优先把当前可执行文件旁的 `../lib/<package_name>` 规范化为资源目录，若该位置不存在，再使用 `APPDIR/usr/lib/<package_name>`。worker 的无 `--public-dir` 入口调用这两个 API，并在最终的 `public` 目录核对 `index.html`；`PiLaunchResolver` 则从 `public` 的父目录找 `pi`。Tauri 资源映射同时把 `../public` 与 `./resources/pi` 放入包资源目录。由此，源码中的无参数资源解析链条已闭合，当前不需要另写 AppImage 专用路径拼接。此结论仅覆盖锁定源码和配置，仍须用真实 AppImage 核对打包布局、环境变量及窗口退出后的 worker 生命周期。

同轮把 Pi 缺失提示中的 macOS 专属 `.app bundle` 改为通用的安装资源目录描述，使 Windows、Linux 和 macOS 的错误信息都指向实际检查位置。

`bun run check:rust:static` 再次通过（Windows 全目标 Cargo check、Clippy 警告即错误）；目标 `pi_launch.rs` 的 rustfmt 检查和修改文件的 `git diff --check` 通过。仓库级 rustfmt 仍提示既有格式漂移，属于 advisory。随后 `cargo clean --manifest-path src-tauri/Cargo.toml` 移除本轮生成的 18,951 个文件、约 3.3 GiB。未新增或运行测试，也未执行 Linux AppImage 实机验收。
