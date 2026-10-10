# 资源 Worker 原始二进制输出候选 draft.1

2026-10-10，内部标识 `resource.wasi.output.draft1`。这是 Worker 输出承载基础，不是公开 Host profile、完整 resource.v1 或 DevTools 图片工具验收。不得据此声明生产 Host 已支持资源结果。

## 显式选择与兼容

只有已经使用 `resource.wasi.input.draft2` 模块快照帧、含至少一个输入资源的调用，可在帧内 request 增加精确字段 `resourceOutputProfile: "resource.wasi.output.draft1"`。其他值、普通 JSON 通道或未捕获模块的 draft1 输入帧拒绝该选择。

未声明时仍输出原 Worker JSON 响应，不注册输出 imports，不改变原 compute 64MiB 内存、首批文本字段或旧输入 ABI。此选择目前仅限 Studio 内部一致性调用；生产资源 Host 尚未组装该选择或登记其输出，提供方不能仅添加 manifest 字段就获得支持。

## WASI 输出接口

命名空间 `zicode_resource_output_draft1`，仅访问本次 guest 的输出缓冲区：

| 函数 | 行为 |
| --- | --- |
| `create(mime:i32, byteLength:i64)->i32` | 按声明总长预留缓冲，返回本次输出索引。 |
| `write(index:i32, source:i32, length:i32)->i32` | 从导出的 guest memory 追加 1–65536 字节，返回成功数量。 |
| `finish(index:i32)->i32` | 实际长等于声明长才封存，成功 0；重复封存为 0。 |

MIME 索引：0 octet-stream、1 PNG、2 JPEG、3 WebP、4 text/plain。它们是内容标签，不是图片解码/像素或 UTF-8 安全证明。可以创建零字节输出，但仍必须明确封存。

错误：-1 参数/索引/范围/状态不符，-2 guest memory 不可读，-3 次数或总预算耗尽，-4 预留失败。每次 create/write/finish 尝试都计数，最多4096次，包含错误；最多四项、累计声明32MiB。封存后不允许写入，不提供覆盖、删除、资源搜索、文件路径、网络或用户存储权限。

guest 正常结束且 stdout 为一项有界 JSON 后，所有创建输出必须已封存。未封存、WASI trap/非零退出或结果 JSON 失败，整次调用失败，不发送任何部分资源。父进程取消/超时或管道清理失败不能作为成功结果。

## 原始输出帧

成功输出为8字节 `ZIWO 00 00 00 01`，接4字节小端无符号头长度、UTF-8 JSON 头，再接 resources 顺序的原始字节直到 EOF。没有 Base64，也不将图片数据塞进 text 字段。

头严格包含 schemaVersion=1、profile、result 和 resources。resources 为0–4项，各项严格为 index、mimeType、byteLength、contentVersion（Host Worker 计算的小写 SHA-256）。index 必须与数组位置一致。头最多1MiB+4096，资源合计32MiB，完整帧最多两者加12字节；解码先验证描述符和总长，再分配各输出。拒绝未知字段/版本/MIME、摘要不符、截断和尾随数据。

失败保持原 Worker JSON 错误响应和非零退出；消费者不得将失败 JSON 或不完整帧作为资源登记。旧消费者无法解析新帧，因此可信调用方必须显式选择并提供相应 stdout 预算，不能私自扩大原 compute 通道。

## 配额与未完成事项

guest 仍使用资源路径256MiB线性内存、模块2MiB、栈2MiB、一千万fuel及父进程五秒预算。输出缓冲总长32MiB，单块暂存64KiB；输入、guest、输出帧和父子副本的合计峰值不等于上述任一预算，尚未实测低端设备峰值或真实图片编码器。

当前缺失：可信 Host 对输出的原子登记及来源/有效期/撤权绑定、共享并发与总存储预算、媒体验证与可信预览、结果映射/接力的单独确认、用户确认保存/冲突/覆盖恢复、实际 DevTools 图片算法包、Pi/View/原生 GUI及逐OS验收。不能把输出承载通过视作这些功能通过；全部154工具完整接受计数不变。

本轮验证终态、源码/EXE摘要和日志见技术博客 `iterations/binary-worker-output-2026-10-10`。此目录中的 Studio WAT 仅验证传输与隔离，不是图片处理实现，也不需要 DevTools 独立 EXE 或共享数据。

## Host接入后续

2026-10-10：生产资源调用已增加manifest显式选择和严格输出登记分支，参见[Host输出候选](resource-host-output-candidate.md)。仅承载和原owner资源链路；正式profile、媒体预览、跨工具授权及保存仍未完成。真实环境终态以host-binary-output-2026-10-10日志为准。
