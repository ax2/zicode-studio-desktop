每次公开发行在已有功能与升级说明后追加「已完成 Issue」和「已知问题」。冻结前准备同名的 vX.Y.Z.issues.json，milestones 包含本次首次公开交付的编号版本，extraCompleted 补入迁移过版本但在本版交付的已关闭项，exclude 为不在该产物内的事项注明理由。known 列出影响本版的已知问题与未验证边界；v0.0.0 所有开放已知问题自动纳入。没有事项时仍保留标题并明确写无。发布负责人需将已有充分证据的 Issue 及时关闭，以实际合入范围复核生成列表。

Windows 升级验收使用目标版本之前最近的已验证公开 x64 安装包。准备正式版时，从 GitHub Release 核对前一版本的安装包名称与 SHA-256。自 v0.7.8 起，把前版号写入本版 `vX.Y.Z.issues.json` 的 `windowsUpgradeFrom.version`，把 由 64 个小写十六进制字符组成的摘要写入 `windowsUpgradeFrom.sha256`。版号形如 `0.7.7`。本地发布入口和 GitHub 都会在构建前读取该记录。旧版本的摘要保留在[发布工作流](../../.github/workflows/release.yml)，供重新构建。
