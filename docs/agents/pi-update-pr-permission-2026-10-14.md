# Pi 更新任务的 PR 权限失败恢复

2026-10-14 只读核对：GitHub 仓库 `ax2/zicode-studio-desktop` 的 Actions 设置 `can_approve_pull_request_reviews=false`。公开主线的 [`Check pi updates` 运行 38431646940](https://github.com/ax2/zicode-studio-desktop/actions/runs/38431646940) 先推送 `chore/bump-pi-1.2.0`，再因 `createPullRequest` 权限被拒而失败。工作流文件已经声明 `contents: write` 和 `pull-requests: write`；仓库级创建 PR 开关仍会阻止 Actions 建 PR。

[GitHub 官方 REST 文档](https://docs.github.com/en/rest/actions/permissions#get-default-workflow-permissions-for-a-repository)规定，读取仓库 Actions 默认工作流权限的接口需要仓库管理读取权限；不能假定工作流自身的 `GITHUB_TOKEN` 可用于这个预检。因此在 `gh pr create` 失败后重新查询是否已有并发创建的 PR；查询失败则保留分支并报错，不能冒险删除已创建的 PR 分支。确认没有 PR 时，只对本次推送的确切远端提交执行带租约回滚。原来不存在的分支被删除；原已存在的工作流分支恢复到运行前提交。远端被其他进程改动时租约使回滚失败并报告警告，不覆盖其他人的工作。工作流仍以错误终止并提示检查仓库设置。已有更新 PR 或当前版本已是最新版时，原有跳过路径不变；此逻辑不修改仓库设置或自动批准 PR。

本地 Studio 已锁定 Pi 1.2.0，应用版本仍为 0.4.2。YAML 已解析，回滚仅在建 PR 失败且没有现成 PR 时执行；尚未在 GitHub Actions 运行当前未推送修订。是否启用仓库级 Actions 创建 PR，由仓库所有者决定；启用后仍需人工审查 Pi 升级 PR 和实际桌面运行结果。
