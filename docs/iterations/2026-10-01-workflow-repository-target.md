# 2026-10-01 工作流 GitHub 目标仓库

状态：工作流修改及本地静态检查完成；远端运行待验收。

## 目标与发现

- 当前克隆同时有 ZiCode `origin` 和 Picot `upstream`，本地 `gh` 曾默认选中上游。已有发布仓库身份门槛检查 `GITHUB_REPOSITORY`，但草稿 Release 的查看与创建仍依赖 `gh` 默认仓库。
- Pi 更新工作流的已有 PR 查询和新 PR 创建也未显式指定仓库，且此前没有调用项目的仓库身份门槛。

## 修改与决策

- Release 工作流在查看、复用和创建草稿时全部传入 `--repo "$GITHUB_REPOSITORY"`；其他上传、核对和公开步骤原本已显式指定目标。
- Pi 更新工作流在 checkout 后先执行现有的仓库身份检查，并在 PR 查询与创建时显式传入 `--repo "$GITHUB_REPOSITORY"`。任务仍由 GitHub 提供的当前仓库决定，身份门槛要求它等于项目配置。
- 本轮仅修改本地工作流和档案，不创建 PR、tag、Release，也不触发 CI。

## 验证与风险

- 两份工作流通过 Python `yaml.safe_load` 语法解析与 `git diff --check`；定向搜索确认草稿 Release 查看/创建及 Pi 更新 PR 查询/创建均显式传入目标仓库。本轮不运行测试。
- 本地静态检查不能证明 GitHub Actions 实际求值；当前 `developer-platform.yml` 尚未在远端默认分支出现，三平台 CI 和真实发版仍待验收。
