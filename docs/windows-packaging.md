# Windows 打包

## 1. 安装内容

```text
ZiCodeStudioDesktop\
├── zicode-studio-desktop.exe
├── zicode_studio_shell.dll  (Windows Explorer 多选 COM 入口；实际资源位置按安装包布局)
├── pi\
│   └── pi.exe
├── extensions\
├── public\
├── portable-git\
│   ├── bin\bash.exe
│   ├── cmd\git.exe
│   └── usr\
├── NOTICE
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

## 2. Portable Git

- 版本和 SHA-256 固定在仓库配置中。
- 构建脚本只从 Git for Windows 官方 Release 下载。
- 校验失败立即终止构建。
- 下载有超时与大小上限，先写 `.part`，完整接收后才进入缓存；失败清理临时文件。
- Rust 启动进程时优先使用内置路径，不读取用户 PATH 中的 Git/Bash。
- 安装包保留上游许可证。

## 3. WebView2

构建脚本下载并校验固定 SHA-256 的微软 Evergreen Standalone Installer，将其
作为 NSIS 资源写入安装包。Tauri 自身设为 `skip`，由
`windows/hooks.nsh` 在目标机没有 WebView2 时静默安装，因此安装阶段不依赖网络，
构建阶段也不依赖微软的动态跳转地址。
下载同样经过有时限的临时文件写入，最终缓存仍须通过锁定 SHA-256 校验。

## 4. 控制台窗口

发布构建使用 Windows GUI subsystem。所有 `Command` 子进程必须统一设置 `CREATE_NO_WINDOW`，包括：

- `pi.exe`
- `git.exe`
- `bash.exe`
- `cmd.exe`
- 诊断命令
- 包管理器

任何新增子进程调用必须经过公共 Windows Command 配置函数和自动化检查。

## 5. Release

推送 `v*` tag 后：

1. 安装锁定 Bun 和 Rust。
2. 安装前端依赖。
3. 下载并校验 Pi Runtime。
4. 下载并校验 Portable Git。
5. 构建扩展。
6. 运行测试和 Rust 检查。
7. 构建 NSIS EXE。
8. 创建 GitHub Release。

正式分发还需要 Windows Authenticode 代码签名，以减少 SmartScreen 警告。
仓库已公开，安装包可从 GitHub Releases 下载。当前尚未启用 Tauri 自动更新
签名产物，新版本需要手动安装。

2026-10-14：Windows 构建脚本在同一 Cargo target 中生成 Studio 自有多选 Shell DLL，并通过 `tauri.shell.windows.conf.json` 纳入 NSIS 资源。可选的当前用户 Explorer 菜单仍由用户在应用中安装；NSIS 预卸载钩子仅调用专用的当前安装路径清理入口，保留指向其他 Studio 安装位置的菜单。隔离注册表与 CLI 专项已验证精确清理，**尚未生成或卸载新的 NSIS 包**；安装目录中的 DLL 位置、真实卸载和升级后菜单保留行为仍需实包验收。
