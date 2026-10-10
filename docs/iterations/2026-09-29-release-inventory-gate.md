# 2026-09-29 发布草稿资产清单门槛

状态：工作流修改与静态检查完成；远端运行结果待记录。

## 目标与发现

- 三个平台构建 job 已分别核对本地安装包与草稿 Release 中对应资产的哈希，但不会检查草稿中多出来的旧资产。
- 工作流允许复用已有草稿；旧安装包或已停用的更新清单可能与本次四个合格安装包一同公开。

## 修改与决策

- `publish-release` 在公开前读取草稿状态和完整资产名称列表。当前发布配置仅交付四个安装包，因此要求恰好一个 Windows EXE、一个 macOS DMG、一个 Linux AppImage、一个 Debian 包，且没有其他资产。
- 检查失败时保留草稿并阻止发布。每个平台的已有大小与 SHA-256 门槛仍负责确认这四个资产确实对应本次本地构建。
- 当前 `createUpdaterArtifacts` 为关闭状态；将来启用更新签名时必须明确扩展这份资产契约，再允许 `.sig` 和 `latest.json`。

## 验证与遗留

- Python PyYAML `BaseLoader` 解析了完整 Release YAML，并核对 `publish-release` 的两个步骤；新增 Bash 脚本经内置 Git Bash `bash -n` 语法检查通过，差异空白检查通过。本轮不新增或运行测试，不触发远端发布。
- 仍需在真实草稿 Release 中验收 GitHub CLI 返回的资产列表、复用草稿和多余资产阻断效果；工作流代码不能证明三个系统安装包已实际可用。

## 接续：更新产物配置前置门槛

- 复核当前工作流发现：四安装包清单只在所有平台上传后检查，而 `createUpdaterArtifacts` 将来若打开，签名资产可能先上传，再因清单多出文件而失败。
- `prepare-release` 现在读取 Tauri 配置，要求 `createUpdaterArtifacts` 明确为 `false`；否则在创建草稿前报错，要求先扩展清单和签名校验。
- GitHub runner-images 当前文档确认 `macos-15` 是 arm64 标签；现有 `check-release-target.mjs` 同时检查进程架构和 Rust host，本轮未改变矩阵。
- 本轮仅检查工作流与文档差异；未运行测试、构建或远端发布。真实 GitHub Actions 和 updater 产物仍待验收。
