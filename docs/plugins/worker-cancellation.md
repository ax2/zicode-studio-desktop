# 插件 Worker 取消：底层候选与 Host 接入要求

更新：2026-10-09。底层、Host HTTP 候选与Pi取消请求已接通；真实HTTP及同一次Pi调用→WASI Worker进程层面的运行中取消/回收已验证，View取消入口仍待验收。没有新冻结交付，也不改变 `compute.wasi.v1`。

## 已实现的底层

`CapabilityBroker::invoke_cancellable` 接受可选独立原子取消信号。原 `invoke` 保留接口并传入无信号；现有工具行为不因此自动获得取消入口。

外部 Worker 启动前和进程监控期间检查信号。运行中取消返回 `worker_cancelled`，执行 kill/wait 回收该子进程，并等待输入输出线程结束后返回。已有五秒执行预算及输出限制不变。底层运行程序是 Studio 自身隔离 Worker，不允许插件创建后代进程或持有外部管道。

取消前已开始的内置写入/网络操作没有即时中止机制，不能将信号视作撤销或回滚。取消与成功完成竞争时，已完成的调用可能返回成功。取消失败不缓存为成功结果；审计只记录原有身份、输入摘要、耗时及错误码。

## 当前真实证据

运行中的真实测试子进程先生成就绪证据，再由另一个线程取消；父进程终止并回收进程/管道线程，后续子进程正常执行。预先取消不会尝试启动不存在的程序。Broker取消审计/缓存/同调用重新执行通过。该证据没有使用真实 DevTools WASI 包，也没有通过 HTTP、Pi 或 UI 发起取消；不得扩大其验收范围。

底层证据见技术博客 `iterations/plugin-worker-cancel-2026-10-08`。完整153项工具的验收计数不变。

## Host HTTP 候选（schemaVersion 1）

`POST /v2/plugin-tools/cancel` 接受 `{schemaVersion:1,runtimeId,sessionId,toolCallId}`，未知字段拒绝。复用现有 Broker Bearer 的实例/会话/有效期/运行存活鉴权；不接受客户端工作区覆盖或其他运行实例凭据。调用标识非空、最多256字节。

返回 `{schemaVersion:1,status,executionFinished}`：`pending` 表示执行前取消记录，`requested` 表示当前调用已收到信号，均为 `executionFinished:false`；`finished` 表示调用生命周期已经结束，为 `true`。请求接受不等于Worker终止，生命周期完成也不等于操作被回滚；实际 invoke 的 `worker_cancelled`（409）与底层回收证据一起用于确认取消生效。

独立调用表按 runtime/session/call 标识隔离。最多2048条、每实例128条、全局64个活动调用；超限明确拒绝，活动调用ID重复为 `plugin_call_in_progress`（409）。提前取消保留60秒，覆盖取消请求先到的竞争；完成记录保留最多60秒，可在容量紧张时淘汰，待取消/活动记录不会因容量被淘汰。完成后的同ID重试仍由既有Broker幂等/身份检查决定；建议新任务使用新调用ID，不能依赖已过期的取消记录。

Pi invoke 的同步部分现放入阻塞工作线程，实际执行前再次核对运行实例鉴权，继续保留目录修订、授权、完整性与幂等规则。取消通道不获取注册表或Broker执行锁；计算本身仍沿用这些锁，因此本阶段没有声称所有目录/工具操作已经并行。调用Lease留在线程中直到执行返回，HTTP断开不会伪造完成。

真实HTTP已验证双执行锁持有期间取消仍可响应、认证拒绝、取消先到拒绝后续调用，以及新调用恢复。测试的活动Lease是受控登记，后续调用为内置Notes；不是实际DevTools WASI运行中取消或Pi/原生界面验收。Host证据见 `iterations/plugin-host-cancel-2026-10-08`。

## Host 下一步必须满足的要求

1. 使用独立的调用生命周期表，绑定 Broker runtimeId、sessionId、toolCallId；取消请求复用 Broker 身份/存活鉴权，不能用桌面或配对设备身份取消其他运行实例的工具。
2. 取消入口不能等待注册表或能力代理的执行锁。同步执行移到阻塞工作线程，避免占用异步请求线程；保持执行时的授权、完整性、目录修订及幂等校验。
3. 覆盖“取消先到、执行请求后到”的竞争；待执行取消记录有数量/有效期限制，不能通过无限登记耗尽内存，不能混淆不同会话或新的调用。
4. 接受取消与完成回收分开表示。只有子进程与管道已回收才确认终止；不要把断开HTTP连接或请求已接受当作终止证明。
5. 内置读写/服务和外部Worker分别声明取消范围；写入不因客户端取消自动回滚，也不自动重试。新调用ID与原调用重试语义明确。
6. Pi客户端在AbortSignal触发时发送独立的有界取消请求，不能复用已经终止的请求signal；超时、旧Host和撤权失败给出可识别结果。
7. 验证真实HTTP并发执行/取消、排队取消、跨实例拒绝、重复取消/调用ID、数量预算、审计及下一次工具执行，再补真实Pi、实际插件WASI、桌面入口和支持OS证据。

上述要求中Host通道与Pi独立取消请求已实现，真实HTTP与Pi同调用运行中WASI Worker回收已验证；原生入口、停止实例期间取消及完整跨平台验证仍需继续。提供方不能据此声明完整运行中取消已支持。`resource.v1`/`service.v1`/`desktop.v1` 仍需各自完整协议与验收。

## Pi 客户端当前接入

`plugin-invoke-client.ts` 在已发出的调用AbortSignal或15秒请求超时后，向Host发送独立cancel请求，不复用已经终止的signal。cancel从请求到读完响应最多2秒，流式响应限8KiB，严格检查schema/status/executionFinished。原调用最多15秒，取消确认可能额外等待最多2秒；它不是延长Worker预算。预先取消不会发送invoke/cancel，成功调用不发送cancel，无自动重试。

提示区分Host已登记/已请求取消、原调用已结束以及Host未确认。旧Host404、鉴权拒绝、传输/超时、超大/畸形响应分别用固定原因码；不透传原始服务消息、输入或凭据。`worker_cancelled`等已知Host码继续可识别。请求接受始终提示“终止未确认”，不会说操作已撤销。

真实本地HTTP检查验证原连接取消、独立cancel身份、请求超时后cancel和后续调用恢复；真实捆绑Pi SDK→源码Host→冻结DevTools WASI Worker的验收适配器新增一次取消探针，再继续五能力/撤权/恢复回归。探针确认AbortSignal已到Host并且下一调用成功，但没有观测取消瞬间的Worker PID/执行阶段，不能当作运行中WASI回收验收。适配器仅用于受控验收，未替换实际SDK注册/激活/执行。证据见技术博客 `iterations/pi-plugin-cancel-2026-10-08`。

## 真实WASI进程取消证据（2026-10-09）

`wasi_cancel_tests` 验证冻结Studio EXE与dev57包全部文件摘要，在专属Host目录安装该真实WASI候选，等待实际Worker进程启动后经HTTP取消。必须同时观察同一PID的 `started`、`cancel_live`（child.try_wait确认尚存活）、`reaped`（kill后wait成功）、`pipes_closed`（两条IO线程结束），以及HTTP invoke的409/worker_cancelled和生命周期完成。之后Base64编码真实执行成功。用测试进程替身或预先取消不能满足这些条件。

观察器只在测试Broker中配置；生产调用不提供观察器，不增加插件权限或把PID/输入/凭据交给插件。生产传输仍使用相同取消/回收实现；无法确认wait成功时返回 `worker_cleanup_failed`，不伪装已终止。

源码静态/严格Clippy与完整Rust394项通过、14项全套跳过；本新增环境专项在完整套中标记ignored，随后/此前独立设置冻结EXE运行，1项真实检查通过，不能把全套ignored冒充通过。证据为技术博客 `iterations/wasi-running-cancel-2026-10-09/actual-wasi-cancel-result.json`。

此HTTP证据覆盖WASI Worker进程在其启动/编译/计算执行预算内的终止，不区分 `_start` 内部指令位置，不代表算法指令级中断。原生界面和其他OS也未验收。完整工具/全部目录的验收计数保持不变。

## 同一次Pi取消与进程回收（2026-10-09）

技术博客 `iterations/pi-wasi-cancel-2026-10-09` 保存实际捆绑Pi SDK→源码Host→冻结Studio Worker/dev57 WASI包的专项。验收适配器先调用真实动态工具，等待测试观察器记录进程启动，再触发该调用的AbortSignal。记录同一PID 7296的 `started → cancel_live → reaped → pipes_closed`，客户端提示Host已请求取消，随后原工具正常执行；五能力、撤权拒绝和恢复阶段也通过。

`worker_test_observer` 仅在cfg(test)注册，显式环境路径启用；create_new拒绝覆盖旧证据，JSONL只记事件/PID。生产Broker没有观察器。适配器只增加受控调用/信号，不替换SDK、Host或WASI执行。Rust静态/严格Clippy及该专项1项通过；专项日志包含383项过滤，不是完整Rust全套。旧Windows交付未重新冻结。

此用例关联了同一次Pi操作和实际存活Worker的回收，但仍不区分启动、编译和算法指令阶段，也不证明模型自主取消、原生View取消、运行实例停止/撤权竞争或其他OS。先前未观测PID的Pi探针保留为历史证据；最新结论以本节为准。

## 会话绑定期间的取消身份（2026-10-09）

Pi携带启动时的Broker环境，而同一ManagedRuntime可能一次性绑定正式会话。invoke和cancel仍必须通过Bearer、实际实例、有效期及启动/正式会话鉴权；调用方不能提交额外Owner或工作区来替代这些检查。

内部调用记录使用该实际ManagedRuntime不可变启动目标，避免临时/正式会话分别登记同一toolCallId，也避免调用已经运行后绑定正式会话使取消丢失。工具执行及资源Owner继续使用实际当前会话；内部稳定身份不进入插件输入/输出，不授权跨实例或未知会话。停止实例后的新取消请求仍拒绝，这个修复不是停止时主动终止全部任务的实现。

当前验证状态与最终证据见技术博客iterations/plugin-cancel-session-binding-2026-10-09。必须区分受控活动Lease的真实HTTP验证和实际WASI进程专项；不得将前者单独报告为原生View运行中回收。View入口、撤权/更新/停止的全生命周期、其他OS、新冻结交付仍待完成。

本阶段新增实际WASI证据：真实HTTP invoke使用启动会话，观察Worker启动后再绑定正式会话，随后正式会话cancel命中同一调用。actual-wasi-binding-result.json显示PID49924在取消时存活，随后回收/管道关闭、executionFinished及下一工具均true；专项1项通过，390 filtered。生产修正完整Rust401通过/14ignored；增强环境专项后另跑最终静态门槛，以阶段日志终态为准。它不是实际原生View或图片算法验收，亦不区分Worker启动/编译/算法指令阶段。
