# 金融核心类型门槛工作日志（2026-10-01）

## 目标与发现

根扩展 TypeScript 配置仍受内嵌 Pi 缺失声明和其他错误阻碍。金融确定性模块不依赖 Pi SDK，适合独立实施严格类型检查。原模拟交易盯市有报价与无报价两个持仓分支；无报价分支缺少 `stale` 字段，根检查报告读取该字段时的类型错误。

## 修改与决策

- 无报价持仓显式返回 `stale: null`。风险汇总只统计 `stale === true`；缺失报价另由 `missingQuoteCount` 记录。
- 新建 `tsconfig.finance-core.json`，严格检查回测、市场数据、行情归一化、模拟交易和筛选源码，不依赖 Pi SDK 声明，也不包含测试文件。
- `typecheck:finance-core` 纳入 PR 检查和三平台平台检查入口。扩展入口 `extension.ts` 仍需要 Pi 声明，不在本门槛内。

## 验证与遗留

`bun run typecheck:finance-core`、`bun run check` 和 `bun run build:extensions` 均退出 0；工作流 YAML 已静态解析，目标差异空白检查通过。仓库静态检查仍报告既有警告。本轮未运行测试。根扩展类型检查、真实行情数据和三平台运行仍待验收。
