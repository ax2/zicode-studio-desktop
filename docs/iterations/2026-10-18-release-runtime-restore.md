# Windows Release 运行目录恢复准备（2026-10-18）

## 目标与发现

项目约定只保留一份 Debug 与一份最新 Release 完整运行目录。本轮只读复核发现 `target/debug/zicode-studio-desktop.exe` 仍在，`target/release` 已缺失；没有用当前大量未提交的开发改动重新发布或修改 0.4.2 版本号。

GitHub 已发布的 v0.4.2 Windows x64 安装包资产为 `ZiCode.Studio.Desktop_0.4.2_x64-setup.exe`，API 报 350,392,303 字节、SHA-256 `c6e0357ae249935f3f370d1cf88b73c32a526de262b209d732d5274c84bc615b`。本轮下载到项目自有 `.cache/task-scratch/release-restore-v042/`，大小与摘要均吻合；Windows Authenticode 状态为 `NotSigned`。7-Zip 完整提取报告 `Everything is Ok`、10,229 文件、896,770,407 逻辑字节。

提取目录 `E:\zicode-studio-desktop\.cache\task-scratch\release-restore-v042\extracted` 当前包含 EXE（SHA-256 `dab1c79d0365fcba36a72ae336589af82c3383ff17d0316ad525144516b7bd33`）、`public/`、`extensions/`、`pi/pi.exe`、`portable-git/bin/git.exe`、`webview2/`、`bun/` 及声明文件。内含 Pi `.version` 为 Windows x64 `1.1.0`，这是已发布 v0.4.2 产物的固定运行时，不应与当前开发工作树固定的 Pi `1.3.0` 混为同一构建。安装器辅助目录 `$PLUGINSDIR` 只有 5 个文件、90,494 字节，不属于运行时。

只读组件烟测从提取目录直接调用 `pi/pi.exe --version`、`portable-git/bin/git.exe --version`、`bun/bun.exe --version`，分别得到 `1.1.0`、`git version 2.55.0.windows.3`、`1.3.14`，退出码均为 0。这只证明三个随附 CLI 可启动，不证明 Studio 主 EXE 或 UI 能运行。

## 审批边界与当前状态

尝试用单条 PowerShell 命令校验项目内路径、删除提取目录中的 `$PLUGINSDIR`、再将提取目录移至 `target/release`，执行前被自动审批策略拒绝；**该命令没有运行**。本会话不换工具或命令绕过拒绝，提取目录和原安装包均保留原状。目前 `target/release` 仍不存在，不能称 Release 目录已恢复，也不能称真实 EXE 已启动验收。E: 可用空间在提取后观察为 35,421,667,328 字节；本轮新增约 1.25 GB 暂存内容，尚未按项目短期 scratch 规则清理。

如用户手动处理，精确范围是：先移除上述 `extracted\$PLUGINSDIR`，再将同一 `extracted` 目录移动为 `E:\zicode-studio-desktop\target\release`；确认 EXE 与七个运行资源仍在后，删除项目自有 scratch 中剩余的 350,392,303 字节安装包和空目录。无需删除 Debug 或其他缓存。完成后还需只读核验目录、摘要和可运行性；当前仅证明资产和解包结构，没有执行安装器或 Release EXE。

本轮未改 DevTools/ZiFile 插件状态，完整接受分别仍为 0/154 与 0/108；用户暂不启用的 JSON Object 插件保持禁用。
