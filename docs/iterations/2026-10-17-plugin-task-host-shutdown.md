# 插件任务在 Host 关闭时中断（2026-10-17）

## 目标与修改

Studio 正常关闭时已有运行时与项目任务停止动作，但已打开的插件任务 Store 没有同步写入终态。现于 `request_shutdown` 停止运行时之后，将 `queued`、`running`、`awaiting_confirmation` 原子地转为 `interrupted`，各追加一条事件；重复关闭不追加重复终态。数据库尚不存在时不创建空库。异常崩溃仍由下次打开数据库时收敛。

## 验证

- Store 定向测试 1/1：三种活动状态各中断一次，已完成任务不变，重复调用返回 0。
- 接收端测试签名包的隔离 Host 专项 1/1：签名升级/回退后新建运行任务，实际调用 `request_shutdown` 两次，任务转为 `interrupted` 且事件序号不再变化。
- 首次编译因 SQLite 查询迭代器的临时借用超过 statement 生命周期失败；修正局部收集后两项均通过。`bun run check:rust:static` 退出 0，Cargo check 和严格 Clippy 通过；rustfmt 仍有既有 advisory。
- 前后只读存储扫描完整、未知项 0：`target` 29,419,049,087 → 29,419,166,335 B；task-scratch 均为 852,978,182 B；E 盘可用 48,417,406,976 → 48,376,774,656 B。没有清理文件，不把卷余量变化归因于本阶段。

## 遗留

正常关闭的元数据仍为 best effort，失败时记有界日志并继续关闭；尚无真实插件后台操作可取消。批量重载、发布者撤销、工作区关闭、Store 写入失败的一致性、View 生命周期路由和提供方任务仍待。`plugin.task.lifecycle.v1` 未发布，DevTools 154 项完整接受仍为 0。
