# 模块与资源快照输入候选 draft.2

日期2026-10-09。内部标识resource.wasi.input.draft2；尚不是发布的Host/manifest profile。它补齐draft.1按可变模块路径加载的前置问题，Host可信父窗调用接线见[接口候选](resource-worker-host-candidate.md)，不代表完整资源协议已验收。

2026-10-10补充：当前Host已增加[授权生命周期监视](resource-worker-lifecycle.md)，下述未完成项为原阶段记录；主动失效和进程回收的新验证须单独查阅阶段证据。二进制输出、真实图片工具及完整资源profile仍未完成。

帧magic为ZIRW 00 00 00 02；4字节小端JSON头长度、JSON头后先放模块原始字节，再按resources顺序放资源原始字节并EOF。头仍最多256KiB，新增module对象仅含byteLength/sha256。模块单独限1至2MiB，资源仍1至4项/合计32MiB，原始帧负载最多34MiB。module和每个资源摘要都核对，magic/profile/module有无必须一致，未知字段/尾随/截断/错误摘要拒绝。draft.1原格式与旧compute保持可读取。

Worker对draft.2使用模块字节创建Wasmtime Module，不读取workerPath；WASI调用stdin标识draft.2，既有只读imports zicode_resource_input_draft1保持原ABI。模块不作为文件资源公开，不提供目录/网络/环境/写入权限。guest内存256MiB、栈2MiB、fuel1000万、stdout1MiB/stderr64KiB与现有父进程5秒预算不扩大，以上不是总进程resident memory硬限制。

Store新增内部snapshot原语，只有与Owner/证明/contentVersion一致且已确认的记录才能复制出资源。已复制材料不会被撤销操作自动收回；后续Host必须先取得实际工作配额，导出当前运行身份/凭据代次/包与能力证明，核对schema和显式profile，锁内取得模块与材料快照，执行前后复核并接取消/撤权/停止/更新及审计。不能把用户提交的摘要或Owner字符串本身当成授权，也不能将长任务放在注册表锁下。

源码真实Wasmtime专项验证取得模块快照后删除源文件仍得到同一结果，以及模块独立预算/摘要/版本和Store确认/证明/会话/撤销边界。Host新增可信父窗invoke/cancel与128条内存审计；两项计算配额在复制前取得，释放目录锁后执行，返回前复核身份及资源状态。当前调试EXE已重建为draft2，完整门槛411通过/16ignored、严格Clippy通过；实际环境专项需单独核对，不能计入普通全套通过数。终态证据见技术博客iterations/host-resource-worker-invoke-2026-10-09。

SDK/Pi/原生计算入口、真实DevTools包与图片算法、输出/保存、撤权/停止/更新主动终止、其他OS及新冻结交付仍待完成。当前Host只消费一个资源，结果是JSON；不代表帧中最多四项资源已对界面开放或持久审计完善。
