# 插件 Worker 并发隔离（2026-10-14）

Studio 的外部 WASI 工具执行不占用 Host Broker 锁，但准备阶段仍有活动 Worker 名额。现将全局上限 64 与单插件上限 8 同时执行；同一插件占满自己的名额时，其他插件仍可取得余下名额。调用结束或被取消后，弱引用失效并在下次准备时回收。重复调用仍按现有幂等键检查。超额返回 `plugin_call_budget_exceeded`，不启动新的 Worker。

这解决单个插件占满所有 64 个名额的问题。八个插件仍能合计占满全局名额，且本规则不覆盖 CPU、内存或全部 Host 请求的公平调度。它不代表 ZiFile 原生插件已可安装，也不改变 DevTools 154 项和 ZiFile 108 格的完整接受计数。

验证记录见技术博客档案 `iterations/plugin-worker-fairness-2026-10-14/work-log.md`。
