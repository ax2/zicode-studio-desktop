# 2026-10-18 提供方工具目录漂移检查

## 目标与发现

Zi DevTools 全目录接入需要逐项追踪。此前 `scripts/compare-provider-catalog.mjs` 默认只比较 ID、版本和状态；仅显式传 `--baseline` 才比较 `scope` 和 `discovery`。同版本变更可能因此漏报。矩阵还保留了 Django/Java Trace 两项后来观察到的版本，与冻结的 dev.105 目录有已记录差异。

## 修改

- 默认读取矩阵指向的冻结 `tools.json`，先核对它与矩阵记录的 SHA-256；仍支持显式 `--baseline`。
- 默认比较用途范围与发现元数据。矩阵行的 `sourceScope` 也参与逐项比较。
- 两项已记录的历史版本差异单列为 `knownHistoricalVersionDifferences`；冻结目录自身不再被误判为新漂移。新版本、状态、范围或发现元数据的变化仍报出。
- 在矩阵定向检查中加入同版本范围及发现元数据漂移、冻结目录自检的回归用例。临时目录位于项目 `.cache/task-scratch`，测试后移除自身文件。

## 验证与遗留

`bun run vitest run scripts/devtools-integration-matrix.test.js` 4/4 通过；`bun run check` 通过。冻结 dev.105 目录作为输入时 `--fail-on-drift` 退出 0，报告 `drift=false`，已知历史差异为 `django-trace`、`java-trace`。该检查只保证目录变动能被发现，不能证明任何工具已安装或执行。

用户选择暂不启用隔离 ZiDevTools JSON 对象插件；其真实工具执行与结果接力仍待验收，`pi.tools.register` 未修改。完整 Zi DevTools 工具接受仍为 0/154。未修改 DevTools 仓库或发布版本。

前后磁盘扫描完整且未知项为 0；`target` 30,030,550,875 B、`.cache` 355,458,670 B、`task-scratch` 1,258,318,024 B 和 `site` 29,644,753 B 均未变化。扫描因容量 advisory 退出 1；未删除有用缓存或生成新运行目录。
