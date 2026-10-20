# 插件任务状态撤权联动（2026-10-17）

## 目标与实现

当前 Studio 的独立插件任务 Store 已能持久保存活动状态，但停用插件、撤销权限或卸载时，任务中心仍可能显示任务可继续运行。新增 `Store::revoke_plugin`：在单个 SQLite 事务内筛选指定插件及可选场景的 `queued`、`running`、`awaiting_confirmation` 记录，写入终态 `revoked`，逐任务增加事件序号并保持 256 条事件上限；重复调用不修改终态。Host 在现有停用、撤权和卸载处理器完成注册表变更、撤销模型及 HTTP grant 后执行此更新。数据库尚不存在时不创建空库；已有库按需打开。Store 故障只记录稳定错误码，不阻断主界面或注册表操作。

权限撤销目前按同插件、同场景保守终止所有活动任务，因为内部任务还未持久绑定各操作的精确权限。卸载跨场景撤权；其他插件和已有终态不受影响。插件 reload、签名升级/回滚、发布者撤销、工作区关闭、Host 关闭及 Store 更新失败后的状态补偿仍待实现；在这些边界和实际操作处理器完成前，`plugin.task.lifecycle.v1` 不广告给提供方。

## 验证

- `plugin_task_store::tests`：9/9 通过，覆盖场景隔离、递增撤权事件、重复调用和终态不可变。
- 隔离真实 Host HTTP 用例 `host_overview_requires_desktop_token_and_registered_workspace`：1/1 通过，现增加 `/v2/plugins/enablement`、`/permission`、`/uninstall` 对 Store 的撤权联动，以及另一个插件任务不受影响；测试目录自行移除。
- `bun run check:rust:static` 退出 0。全仓库格式检查仍报告既有 advisory；本轮两个新 Rust 文件独立 `rustfmt --check` 通过，`git diff --check` 退出 0（既有换行提示）。无界面改动，不以测试代替原生截图或签名包运行验收。

## 存储和范围

前后只读 `scripts/storage-budget.ps1` 扫描均退出 0、`UnknownEntries=0`：target 29,421,116,893 → 29,421,397,119 B；task-scratch 均 852,978,182 B。E 盘可用量 48,605,958,144 → 48,174,067,712 B，卷差值不能归因于本轮。未运行 Release、未生成 ZIP、未清理共享缓存或重试此前被自动策略拒绝的目录；实际删除 0 字节。

Studio 仍无可信 View 生命周期 submit/snapshot/events/confirm/cancel、固定任务处理器及可安装的完整签名 DevTools 包。全工具完整接受仍为 0/154，ZiFile 为 0/108。本轮只改 Studio；已向独立 DevTools 会话发出签名包、包外收据、完整工具范围和精确 Host 能力需求的接口消息。
