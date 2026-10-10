# 资源Worker输入承载候选 draft.1

日期2026-10-09。内部标识 `resource.wasi.input.draft1`。这是Studio Worker的输入传输候选，不是已发布plugin profile或完整resource.v1；manifest/目录不应声明Host支持。Host授权快照和实际调用尚待接线；本阶段证据以技术博客iterations/resource-worker-frame-2026-10-09终态为准。

## 输入帧

stdin为8字节 `ZIRW 00 00 00 01`，接4字节小端无符号JSON头长度，再接UTF-8 JSON头，最后按resources顺序接原始字节并EOF。JSON头最多256KiB，无Base64；非该magic仍走原有256KiB JSON通道。未知版本、截断、尾随字节和畸形头拒绝。

头对象仅有profile/request/resources。profile必须是上述精确候选标识；request为Studio已有Worker请求，workerKind必须wasi。resources为1至4个描述符，字段仅resourceId/contentVersion/mimeType/byteLength；ID是UUID且不重复，contentVersion是64位小写SHA-256，类型限定octet-stream/text/plain/PNG/JPEG/WebP。总原始字节不超过32MiB（不是每项32MiB）；所有描述符预算在载入内容前验证，完整内容逐项核对摘要，标签不等于安全图片解码证明。

不含本机资源路径、Bearer凭据、文件读写授权或共享目录。帧中的ID和摘要不构成授权；Host以后必须从活跃运行实例、正式会话、插件包/能力/版本、resource.read权限及凭据代次导出当前证明，并仅快照已经明确确认的材料。禁止让插件或Pi构造任意文件路径、替代Owner或未授权描述符进入此帧。

## WASI只读接口

命名空间 `zicode_resource_input_draft1`：

- `size(index:i32)->i64`：返回快照原始长度，未知索引返回-1。
- `read(index:i32,offset:i64,destination:i32,length:i32)->i32`：向guest导出的memory写入原始字节，返回实际数量；EOF为0；负数是错误：-1索引/范围/分块无效，-2目标内存无效，-3读取预算耗尽。

单次最多64KiB，累计成功交付最多64MiB，最多4096次读取尝试（包括错误）。超过限制不读取。每次只额外复制一个有界块；源快照不修改。只能读本次帧的数组索引，不按其他资源ID搜索，也无目录预打开/网络/保存权限。

WASI stdin的原有调用对象新增resourceInputProfile和resources元数据列表（index/resourceId/contentVersion/mimeType/byteLength）。只有该内部帧路径注册上述imports；原JSON compute路径不提供它们。源材料在父进程撤销前已复制进子进程后，不能靠删除句柄收回这些字节；Host仍需信号取消并等待进程/管道终态。

## 预算与未完成内容

候选输入路径guest线性内存最多256MiB；原compute路径仍64MiB。模块2MiB、栈2MiB、fuel一千万、stdout1MiB/stderr64KiB不变。现有父进程5秒预算没有扩大；新资源Host路由尚未存在，不能宣称已经获得更长图片任务预算或完整图片兼容性。内存上限是guardrail，未证明实际编码器峰值、像素/动画/方向范围适配。

Host还需有界快照/同时执行配额（覆盖父子复制、输入及输出）、调用取消/撤权/停止/更新、失败隔离和审计。资源结果目前仍是有界JSON；二进制输出、可信预览、跨工具确认接力、确认保存/覆盖恢复、真实DevTools消费包、实际Pi/View/原生/各OS及新冻结Windows交付均待完成。不要把Worker输入基础当成全部工具接入验收。

## 实际子进程补充验证（2026-10-09）

Studio当前调试EXE通过共享有界stdio transport接收编码器生成的300,000字节资源帧，实际WASI读取尾部内容并输出正确JSON；篡改帧摘要拒绝，旧JSON通道无法获得资源imports。取消观察到同PID56416 started/cancel_live/reaped/pipes_closed；已耗尽的1纳秒测试截止使PID11124超时并回收/关闭管道，随后正常资源调用恢复。取消/超时发生在Worker启动阶段，不声称算法指令级中断。

完整Rust407通过/15ignored及严格Clippy通过；新增环境专项显式单独运行1项通过（普通全套不计其ignored为通过）。实际测试EXE SHA-256为2e8e673c175b2b52f757ef7b3447fd88ee14c3ddd9516d6725b3bd8f60bb4917，运行前后摘要一致，仍是可变源码调试产物而非冻结发布。证据见技术博客iterations/resource-worker-process-2026-10-09。

编码器与解码器共用元数据验证，头编码在写入阶段限制256KiB并覆盖转义放大；API仅crate内部供后续可信Host快照，尚无生产Host调用。当前未接Host资源授权/调用路由、真实DevTools图片包、二进制输出、Pi/View/原生UI/其他OS；这次通过不能改变全工具完整验收计数或声明公开资源profile可用。
