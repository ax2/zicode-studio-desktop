# 资源计算授权生命周期候选

2026-10-10，内部Worker输入仍为 `resource.wasi.input.draft2`，可信父窗接口不变。本扩展不会发布完整resource.v1，也不会给插件新的文件、网络、输出或保存权限。

后续同日增加[有界模块快照读取](bounded-module-snapshots.md)：证明复核和资源模块捕获共用固定缓冲区，避免依赖路径metadata之后的无界读取。专项证据另见iterations/bounded-module-proof-2026-10-10，原生命周期阶段六项记录保留。

## 主动失效

资源计算在现有两项配额内，每个活动计算最多一个作用域监视线程。监视器每次复核当前运行实例/会话、Broker凭据代次、插件启用和resource.read授权、包/能力/模块身份，以及原资源确认、版本、有效期和撤销状态。

任一证明失败，或证明检查出现panic，均设置本次调用已有的取消标志。既有Worker传输负责终止、回收子进程和结束管道线程；调用仍持有配额，直到传输清理和监视线程结束。调用正常或异常退出均通知监视器退出，作用域保证线程不越过调用寿命。没有无限后台线程或队列。

监视器采用100ms轮询间隔，证明读取和锁等待可能增加延迟；它不是100ms取消SLA，也不是实时系统。每次检查可能重新核验模块摘要，当前尚无低端设备CPU/IO压力与峰值内存测量。原两项资源计算配额、五秒Worker预算、32MiB输入快照和其他预算均不扩大。

不依赖插件主动发cancel。字节已复制到Worker后无法撤回；主动终止只能缩短继续执行窗口。结果交付前仍再次检查身份与资源，不能以取消标志取代授权复核。进程清理失败优先返回worker_cleanup_failed，不能用授权错误暗示进程已经结束。

## 错误与日志

保持既有固定错误码：permission_denied、resource_plugin_unavailable、resource_authorization_changed、resource_unavailable、runtime_stopped、worker_cancelled等。监视线程不记录输入、资源字节、文件路径或凭据，不增加持久日志；仍沿用最多128条内存执行审计。

用户取消的ACK与Worker终态继续分开。监视器是宿主内部生命周期机制，不提供新HTTP取消权限，也不允许已停止实例发起新读操作。

## 验收边界

源码验证必须包含：证明失效自动设置取消、证明panic失败关闭、执行panic时线程退出，以及真实HTTP Host/当前Studio Worker的资源撤销、resource.read撤销、插件停用、凭据轮换、模块内容变化、实例停止；检查同PID cancel_live/reaped/pipes_closed、配额释放、无旧结果，以及可恢复情形的新资源新调用成功。

Host专项运行实例为测试内存登记，算法为Studio自有WAT夹具，Worker在启动观察点暂挂；这证明失效被主动发现并触发真实进程回收，不证明原生操作中的算法指令级中断、真实DevTools图片解码、签名升级/回滚或所有平台。具体终态以技术博客iterations/resource-worker-lifecycle-2026-10-10日志为准。

仍待：原生运行中撤权/停止验证、正式包升级回滚、图片/文件实包、二进制结果登记和预览、跨工具资源接力、显式保存、持久审计与逐OS验收。154项完整工具接受计数不变。

### 2026-10-10 修订隔离后续

此前全局 result_epoch 的跨插件失效范围已由插件包/场景授权世代替代；目录仍保留全局修订。实现与验证边界见 [插件执行修订隔离](scoped-execution-revisions.md) 和技术博客 scoped-plugin-revisions-2026-10-10 阶段；不改变本文件当时验证记录或完整工具接受计数。
