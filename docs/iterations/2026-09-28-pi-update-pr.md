# Pi 自动更新 PR 故障（2026-09-28）

## 现场证据

私有仓库 `ax2/zicode-studio-desktop` 的最近 15 次 `Check pi updates` 运行均为失败，运行于同一旧提交 `02bd95521cbd2219287bcd3af85a5ebf23325fcc`。最近一次运行 `36325775316`（2026-09-27）中，读取版本、更新完整 Pi 锁、下载与 RPC 验证均成功；`Create PR` 已推送 `chore/bump-pi-0.87.1`，随后报错 `could not add label: 'dependencies' not found`。远端标签列表没有 `dependencies`，该分支目前没有 open 或 closed PR。

## 修改

- 移除创建 PR 时非必要的 `dependencies` 标签参数，让 PR 创建不依赖仓库标签配置。
- 将已在运行日志中显示 Node 20 弃用警告的 `actions/checkout@v4` 更新为 `@v6`。
- 重试已有孤儿分支时，先核对远端提交作者与主题符合本工作流，再使用指向已读取提交的 `--force-with-lease`；新分支使用普通推送。远端分支在读取后被并发更新时推送会失败，不会覆盖新提交。

## 验证与后续

本地 YAML 解析、以原始 LF 字节送入 Bash 的 `Create PR` 脚本语法检查、严格 MkDocs 构建和 `git diff --check` 均通过。Windows 文本模式向 WSL Bash 传入脚本时会把换行转为 CRLF，曾造成一次误报；二进制传输复核后确认脚本语法正常。未手动创建 PR、重跑工作流或更新 Pi 版本。当前工作树未发布到远端，因此远端连续失败不会因本地修改立即停止；需在后续提交后观察下一次运行是否创建 PR，并检查 PR 的 Pi 锁和 RPC 证据。

只读查询仓库 Actions 权限返回 `default_workflow_permissions: read` 和 `can_approve_pull_request_reviews: false`；工作流自身声明 `contents: write` 与 `pull-requests: write`。该 API 没有单独返回可确认“允许 Actions 创建 PR”的字段，不能据此断言创建会成功或失败。移除缺失标签后仍需通过真实工作流运行确认这一权限边界。
