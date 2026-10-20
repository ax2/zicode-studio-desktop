# 工作区关闭时的插件写入屏障（2026-10-17）

## 目标与发现

资源保存会先把文件暂存到工作区，再发布正式文件和回执。已有资源 Store 锁只覆盖发布步骤；结果保存持有自身 Store 锁，但关闭后重新进入保存入口仍需要明确拒绝。关闭工作区必须与这些提交形成可观察的先后顺序。

## 修改

- Host 为每个工作区维护独立写入门闩。关闭入口持有门闩，标记关闭，再完成运行时、授权、任务和资源状态收敛；重新注册同一工作区时解除关闭标记。
- 资源保存的 prepare/commit 和插件结果保存的 prepare/commit 在执行写入前进入对应工作区门闩。已进入的提交先完成，关闭等待它退出；关闭返回后不再接受新的提交。其他工作区使用不同门闩。
- 没有修改 DevTools 工程、插件协议、界面或应用版本。

## 验证

- 真实 Host HTTP 资源保存并发专项 `workspace_close_waits_for_staged_export_and_blocks_later_writes`：1/1。测试在文件暂存后、正式发布前暂停提交；关闭线程在提交恢复前不能返回，恢复后文件与回执完整，关闭后新请求因运行时停止而被拒绝。
- 真实 Host HTTP 结果保存专项 `actual_http_save_requires_confirmation_scope_current_source_and_is_idempotent`：1/1，并确认关闭后 prepare/commit 返回 `result_workspace_closed`。
- 工作区隔离专项 `closing_workspace_stops_only_its_plugin_runtime_and_task_state`：1/1，重注册解除关闭标记。
- `bun run check:rust:static` 退出 0：Cargo check 与严格 Clippy 通过；rustfmt 仅提示已有格式漂移。
- 第一次测试夹具缺 `views/main.html`，第二次末尾断言预期 `resource_workspace_closed` 而实际为更早的 `runtime_stopped`。修正夹具和断言后目标专项通过。这两个失败没有证明功能故障。

## 磁盘与审批

前置只读扫描完整，未知项 0：target 29,420,251,049 B；task-scratch 852,978,182 B；E 盘可用 43,117,072,384 B。两次失败留下的本任务夹具已核对 owner 标记、PID 不活动和路径归属；精确删除命令被自动策略拒绝，没有改用其他手段重试。以下为手工候选，合计 839,051 逻辑字节；本轮实际释放 0 字节：

后置扫描也完整、未知项 0：target 29,420,789,673 B；task-scratch 853,817,233 B；E 盘可用 43,109,122,048 B。扫描差值包含本轮编译与失败夹具，不能用卷空间变化反推清理结果。

- `E:\zicode-studio-desktop\.cache\task-scratch\save-workspace-close-1e92829e-7c77-4be1-8793-f4df98228e18`：541,211 B。
- `E:\zicode-studio-desktop\.cache\task-scratch\save-workspace-close-5e467d3c-9176-4da7-b469-a572e73dd8a4`：297,840 B。

## 遗留

已覆盖资源原始文件保存和插件结果保存的提交顺序；其他未来的后台写入入口仍需沿用该门闩。原生窗口关闭的人机验收、正式 DevTools 签名包及四平台完整流程未完成；154 项工具完整接受仍为 0/154。本阶段无界面改动，无新截图。
