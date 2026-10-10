# 2026-10-01 GitHub 仓库上下文与跨平台 CI 证据

状态：本地 `gh` 仓库选择已修正；远端跨平台矩阵尚无运行证据。

## 发现

- 当前克隆的 `origin` 是 `ax2/zicode-studio-desktop`，另有只读 `upstream` 指向 `shixin-guo/picot`。未指定 `-R` 的 `gh repo view` 实际返回上游仓库；因此不能假定 `gh` 总会选择 `origin`。
- 显式查询 ZiCode 仓库时，远端默认分支找不到 `developer-platform.yml` 工作流。当前本地工作树的跨平台矩阵尚未推送，不能据此声称三平台 CI 已运行。
- ZiCode 仓库最新可见的 Release 工作流运行是 `32643318555`，2026-08-23 13:45 UTC、提交 `02bd95521cbd2219287bcd3af85a5ebf23325fcc`，结论 `failure`，Job 清单为空。该结果不代表当前未提交工作树。

## 修改与决策

- 在本地克隆执行 `gh repo set-default ax2/zicode-studio-desktop`；随后未带 `-R` 的 `gh repo view` 和 Release 运行查询均返回 ZiCode 仓库。
- 纠正 Issue Tracker 指引，所有示例显式指定 `-R ax2/zicode-studio-desktop`，`gh api` 使用完整仓库路径；不再依赖多 remote 克隆的默认推断。
- 本轮只做只读远端查询及本地仓库选择、档案更新，未触发工作流、创建 Issue、推送或发布。

## 验证与风险

- 已核对 `gh repo view` 的 `nameWithOwner` 为 `ax2/zicode-studio-desktop`；`gh run list --workflow release.yml` 返回该仓库上述运行。
- `gh repo set-default` 是当前克隆的本地设置；其他克隆或环境仍应显式传 `-R`。最新 Release 运行无 Job，不能推断失败发生于哪一步。
- 尚无当前工作树的 Windows、macOS、Linux 远端 CI 与交付验收证据。
