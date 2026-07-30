# Windows 打包

## 1. 安装内容

```text
PiWindowsDesktop\
├── pi-windows-desktop.exe
├── pi\
│   └── pi.exe
├── extensions\
├── public\
├── portable-git\
│   ├── bin\bash.exe
│   ├── cmd\git.exe
│   └── usr\
├── NOTICE
└── THIRD_PARTY_NOTICES.md
```

## 2. Portable Git

- 版本和 SHA-256 固定在仓库配置中。
- 构建脚本只从 Git for Windows 官方 Release 下载。
- 校验失败立即终止构建。
- Rust 启动进程时优先使用内置路径，不读取用户 PATH 中的 Git/Bash。
- 安装包保留上游许可证。

## 3. WebView2

构建脚本下载并校验固定 SHA-256 的微软 Evergreen Standalone Installer，将其
作为 NSIS 资源写入安装包。Tauri 自身设为 `skip`，由
`windows/hooks.nsh` 在目标机没有 WebView2 时静默安装，因此安装阶段不依赖网络，
构建阶段也不依赖微软的动态跳转地址。

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
当前私有仓库发布不启用 Tauri 自动更新签名产物；安装包由有权限的 GitHub
协作者从 Release 下载。
