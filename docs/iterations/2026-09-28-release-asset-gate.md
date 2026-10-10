# 跨平台发布资产门槛（2026-09-28）

## 发现

Release workflow 在三个平台的 Tauri 构建 job 成功后公开草稿 Release，但没有逐平台核对实际生成的安装包及其上传结果。若打包或上传步骤未产出预期格式，单靠 job 成功状态不足以证明 Release 可供三个系统下载。

## 修改

- 每个平台在结束 build job 前检查本地 `target/release/bundle` 中恰好存在对应格式的非空文件：Windows NSIS EXE、macOS DMG、Linux AppImage 和 DEB。
- 使用带工作流令牌的 GitHub Release API 读取当前 tag 的草稿资产，核对文件名和大小；API 提供 SHA-256 digest 时直接核对哈希，否则下载对应资产到系统临时文件并与本地 SHA-256 比对。临时文件在每次尝试后清除，下载限时十分钟。允许短暂上传可见性延迟，最多重读六次。
- 任一格式缺失或资产不匹配会使该平台 job 失败，从而阻止依赖整个 build 矩阵的公开发布 job。

## 验证与限制

`node --check`、定向 Biome 检查、Release YAML 解析、`bun run check`、离线 MkDocs 严格构建和 `git diff --check` 均通过；全局检查保留现有告警。本轮未运行测试，也未制作或发布安装包。API 缺少 digest 时会增加一次完整资产下载，真实 CI 耗时和 `gh release download --output` 行为仍待验收；复用旧草稿 Release 时仍需清理过时资产。
