# 插件任务重启后的确认状态（2026-10-17）

## 目标与发现

Studio 任务存储已有 `queued`/`running` 重启中断规则，但 `awaiting_confirmation` 在数据库重开后仍保持活动状态。当前没有确认步骤的恢复处理器，旧确认既不能安全继续，也会占用活动任务额度。

## 修改与验证

- `src-tauri/src/plugin_task_store.rs` 在数据库打开事务中把旧 `awaiting_confirmation` 与 `queued`、`running` 一并置为 `interrupted`，追加递增事件；原记录继续按终态保留，供任务中心查看。
- 持久化测试增加确认中任务重开的状态、序号和事件断言。首次定向编译因夹具插入相邻测试而报变量未定义，修正后专项 1/1 通过。
- `bun run check:rust:static` 通过 Cargo check 与严格 Clippy；rustfmt 报已有 advisory。
- 前后只读空间扫描完整且未知项 0：`target` 从 29,421,496,959 B 变为 29,418,858,111 B，task-scratch 均为 852,978,182 B；E 盘可用从 48,512,008,192 B 变为 48,412,913,664 B。未执行清理，不能把卷余量变化归因于本次修改。

## 遗留

这只处理内部任务记录；没有发布 `plugin.task.lifecycle.v1`，没有 View 提交/确认/取消处理器，也没有真实提供方任务。正常 Host 关闭、工作区关闭、签名升级/回退的任务协调和跨平台运行仍需实现与验收。DevTools 154 项完整接受仍为 0。
