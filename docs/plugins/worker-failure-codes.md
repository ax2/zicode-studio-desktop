# Worker执行失败分类

日期2026-10-09。通用Host固定错误分类扩展；不修改资源权限、计算fuel/内存或执行截止。原worker_timeout与worker_cancelled继续由父进程传输处理。

| 固定码 | 可确认的原因 |
| --- | --- |
| worker_fuel_exhausted | Wasmtime明确返回OutOfFuel |
| worker_memory_trap | Wasmtime明确返回MemoryOutOfBounds；不等于已测总进程峰值 |
| worker_stack_exhausted | Wasmtime明确返回StackOverflow |
| worker_trapped | 其他可识别Wasmtime Trap；不转发guest堆栈 |
| worker_exit_failed | WASI非零proc_exit |
| worker_failed | 未分类Worker错误；固定通用消息，不转发原文 |

Worker进程根据结构化Wasmtime错误生成固定内部消息，Host只接受精确的已知消息映射；未知字符串不成为新公开错误码或客户端消息。普通能力Broker与可信资源计算路由复用同一映射。Pi调用客户端和资源View允许这五个新码，其余未知Host码继续脱敏。

这些码用于说明执行失败，不能证明取消回收、写入回滚、内存总量硬上限或算法正确。内存配置/编译/实例化失败没有可靠Trap证据时保留worker_failed，不能把它们一律判为内存耗尽。

普通测试覆盖结构化Trap/I32Exit映射及未知消息脱敏；另有真实WASI循环耗fuel、越界读、递归栈和非零退出专项。诊断候选的源码引擎观察测试为ignored并单独运行，只记录编译/执行时间及fuel剩余，不记录原报告、解析错误、堆栈或凭据。普通全套忽略该观察测试不能当成候选算法验收。

WASI在Worker进程内使用固定8MiB原生线程栈；WASM栈仍限2MiB。两者不相等：原生执行器也使用栈空间，若原生栈更小，会先导致进程栈溢出而无法返回guest trap。父进程独立子进程隔离保持，资源帧和普通WASI均采用此线程入口，join等待真实执行完成；这不是无限加内存或关闭WASM限制，也不是整个进程resident memory硬上限。首次真实递归专项暴露Windows线程栈溢出，日志保留。随后exit专项因测试WAT未导出memory未触发预期WASI退出，补正fixture后重新执行门槛。

当前生产错误分类的源码门槛及实际引擎证据见技术博客 `iterations/devtools-diagnostics-receive-2026-10-09`。更新后的EXE验证须单独记录；旧冻结EXE不包含此分类扩展，不以其返回worker_failed推定具体Trap类型。

后续终态：完整Rust413通过/17ignored、严格Clippy通过，前端1594通过。更新后的调试EXE SHA256 `e5e0c45336ea24c88717a4c7b1c52bc3219082fb54cc682ce3c203cabf5ac0ac` 已独立验证普通JSON与资源draft2通道各四类真实失败，全部得到固定消息、正常退出及下一调用恢复（共八失败/八恢复）。真实HTTP资源Host+当前EXE的配额/取消/撤权与后续恢复专项单独1项通过。证据failure-process-result与resource-host-new-stack-result；这些自有WAT/资源fixture不是DevTools诊断算法验收或原生UI截图。
