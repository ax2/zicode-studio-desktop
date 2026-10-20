# Stage：文本结果接力 Worker 并发隔离（2026-10-17）

## 目标与发现

Studio 的 `commit-transfer` 已要求桌面令牌和用户明确确认，但旧路径在持有
插件注册表、Capability Broker、结果存储三个锁时同步执行接收方 WASI。
慢插件会卡住工具目录、其他工具调用和同一结果的重复提交检查。

## 修改

- 将确认提交的计算放入 `spawn_blocking`；在短锁区完成来源/目标 proof、
  输入映射及 Worker 预备，执行 Worker 时释放三个共享锁，结束后重新核对
  来源、目标和结果引用的当前权限，再捕获并缓存结果。
- grant 增加运行中状态；同一 grant 的并发提交返回 `plugin_call_in_progress`，
  已完成响应继续按原规则重放，业务错误也只缓存一次。
- 真实 HTTP + stdin 观察型 WASI 用例在首个接力 Worker 暂停时，同时查询
  接收工具目录、调用另一插件工具并提交同一 grant，随后释放 Worker，
  核查成功响应和重放。测试夹具最初在暂停时错误持有事件门锁，导致
  第二个 Worker 超时；单独取出 receiver 后再阻塞，重跑通过。

## 验证与边界

`bun run check:rust:static` 完成 Cargo check / Clippy；全仓 `cargo fmt --check`
仍报告既有格式漂移。定向 transfer 组 7/7 通过、2 个 ignored；另用保留的
`target/debug/zicode-studio-desktop.exe` 作 Worker，显式运行真实 HTTP/Worker
并发用例 1/1 通过。`git diff --check` 返回 0，仅有本机 LF/CRLF 警告。
隔离 Debug EXE 正在用于原生 Inspect 验收，本轮没有覆盖重建该 EXE；
Cargo 复用已有 `target`，未产生第二套 target 或完整发布目录。

只读存储复扫：`target` 从 29,909,881,426 增至 29,985,406,764 字节
（增量 75,525,338，复用原 target 的测试/检查产物）；task-scratch 从
1,020,546,541 增至 1,022,700,912 字节。`.cache` 非 scratch
355,458,670 字节不变，未知项 0，E 盘可用 29,037,416,448 字节。
三次本轮 `multi-input-http-*` 夹具各约 0.33 MiB，其中一次失败夹具无
回执，另两次有回执；精确路径可由时间/前缀定位。未因固定容量门槛删除
复用中的 Cargo 缓存，也未触碰此前被审批拒绝的清理路径。
原生同包接力后的最终复扫为 `target` 29,985,406,780 字节、
task-scratch 1,022,719,014 字节，未知项仍 0；E 盘可用
29,896,572,928 字节。卷空闲变化包含其他进程，不归因于本轮操作。

本次证明文本接力期间 Host 可服务目录和另一工具，不证明接力独立取消、
进程崩溃恢复或新源码在原生窗口中的转交点击。Inspect 0.1.1 的原生 8 工具
执行使用旧 Debug EXE，与本次 Host 源码修正是两条不同证据。正式 DevTools
完整接受仍为 0/154。未修改 DevTools 或应用版本，未发布、生成 ZIP 或清理缓存。
