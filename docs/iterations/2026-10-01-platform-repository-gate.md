# 平台验证的仓库身份门槛（2026-10-01）

## 目标与发现

三平台验证报告已核对触发 SHA、检出 HEAD 和干净工作区，但 `GITHUB_REPOSITORY` 只要求非空。同一脚本若在其他仓库运行，报告仍可能标记 CI 来源已验证，不能作为 ZiCode 目标仓库的交付证据。

## 修改与决策

- 复用 `scripts/release-repository.json` 的仓库身份作为目标，报告记录目标仓库及匹配结果；报告格式升为第 3 版。
- CI 中仓库不符、触发源码不符、工作区非干净或缺少运行身份时，先保存失败报告并停止后续耗时检查。本地运行仍允许脏工作区并继续记录逐项结果。
- 仓库核对区分大小写差异以外的名称变化；未来迁移目标仓库时需同步修改同一配置。

## 验证与遗留

`node --check scripts/developer-platform-checks.mjs`、`bun run check` 和修改文档的 `git diff --check` 均退出 0。仓库检查仍报告既有非阻断警告。本轮未新增或运行测试，也未运行耗时的 `check:platform`。真实 GitHub Actions 运行、三平台结果及安装启动验收仍待完成。
