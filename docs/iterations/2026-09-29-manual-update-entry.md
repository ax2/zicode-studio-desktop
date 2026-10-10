# 2026-09-29 手动更新入口

状态：界面、文档与静态检查完成；桌面点击验收待记录。

## 发现与目标

- `createUpdaterArtifacts` 当前关闭，应用默认不请求签名更新源，而是显示“使用 GitHub Releases”手动下载按钮。
- 按钮原先打开仓库首页，且注释断言 Release 列表不存在。2026-09-29 通过 GitHub REST Release 列表读取到公开 `v0.1.0`；该断言已过期。
- 自动更新文档开头仍称发布流程只生成 NSIS，与当前三平台构建矩阵不符。

## 修改与决策

- 未启用自动更新时，按钮指向仓库的 Releases 列表；保留用户浏览器中的 GitHub 授权边界。对应既有界面断言与自动更新文档同步更新。
- 不启用签名自动更新，也不把 Release 列表元数据当作三个系统安装包已经可用的证据。

## 验证与遗留

- `bun run typecheck`、`bun run check`、`bun run build:react` 与差异空白检查通过；Biome 与设计检查仍显示仓库其他现存的非阻断提示。本轮只更新既有界面断言，没有新增或运行测试。
- 尚未在真实桌面窗口点击该按钮，也未验收各系统安装或升级。初期 GraphQL、Release 详情及列表 REST 请求曾出现 TLS 握手超时；随后列表 REST 成功返回四种安装包的大小与 GitHub 报告的 SHA-256。版本与提交边界见[远端 Release 证据](2026-09-29-remote-release-evidence.md)。
