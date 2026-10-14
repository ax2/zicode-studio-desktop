# Host 派生输出资源候选 draft.1

2026-10-10。配合内部 `resource.wasi.output.draft1`，仅 Studio 候选资源调用；不是公开 resource.v1，也不是全部 DevTools 图片工具接受。

## 选择与响应

现有 `resource.wasi.input.draft2` WASI 插件在 manifest.runtime 显式声明 `resourceOutputProfile: "resource.wasi.output.draft1"`。缺省保持旧 JSON 输出；未知值拒绝，不降级。客户端不能传路径或覆盖 profile。Host 从已校验插件生成 Worker 请求，并仅为此调用启用相应输出预算。

现有桌面父级 `POST /v2/plugin-resources/invoke-view` 请求保持 `{access,toolCallId,input}`，仍需本地桌面凭据、有效运行会话/授权输入/插件权限/输入 schema。成功响应保留 result/source/operationId，额外返回 outputProfile 和 resources 数组。每项：index、resourceId、contentVersion、小写 SHA-256、mimeType、byteLength、expiresInSeconds=900、origin=worker-output、saved=false、derivedFrom（输入 resourceId/contentVersion）。contentVersion 字段本身即为摘要，不另设 SHA 字段。

资源不含文件路径、访问令牌或字节内联。消费者用原 owner 与新 resourceId/contentVersion 组成原 access，再经既有授权 read/read-view 分块读取，或同 owner 调用资源 Worker。这里的同 owner 包括 runtime、session、plugin、capability 全元组；这不是跨工具/跨插件转授权。read-view 仍仅桌面父级且每块最多32KiB；Broker read 仍每块最多64KiB。HTTP小块读取沿用已有Base64，Worker大数据传输为原始二进制帧，两者不可混称。

## 原子性、来源与配额

Worker 成功退出、完整严格帧/摘要/结果 JSON 验证、父进程和管道清理、当前来源证明/授权输入/取消标志检查后，才登记。整组先验证全部 MIME/数量/长度/共享配额，再插入；任一失败不发布部分资源。失败仍为固定公共错误，不回传 Worker 路径或内容。JSON结果最多1MiB。Worker最多4项合计32MiB，Host与未上传完输入共享总共32条/128MiB预留预算；两个资源Worker和五秒预算保持。无后台等待队列。

每条输出与原 owner 和权限/插件/模块/会话证明绑定，并记录父资源 id/version。源资源撤销、过期或已消失时派生资源及其后代一起清除，释放存储配额；访问时同样清理过期链。正常上传没有父依赖。插件撤权/升级、凭据世代或会话停止使旧证明失效，不能通过重授恢复旧结果访问；内存记录可以留到撤销/过期，不能声称立刻回收全部旧授权字节。已复制到消费者的字节不能撤回。

输出已通过传输完整性验证，可在原授权范围内读取；库内部 confirmed=true 表示可读取，**不代表用户批准保存、媒体安全认证或跨插件授权**。输出是本次用户已授权输入计算的派生结果。MIME仅标签，Host不执行媒体解码或HTML渲染。

## 验证与剩余工作

真实HTTP Host测试使用源码Host进程和当前交付EXE、自有WAT：2MiB输入复制到输出，两次同owner链式执行、完整分块读回、错误owner/桌面凭据拒绝、祖先撤销级联、封存后trap不登记、进程回收和旧通道回归。详见技术博客 iterations/host-binary-output-2026-10-10；测试终态以日志与收据为准。

待完成：受控预览及媒体检查；目标工具映射与用户单独同意的跨owner传递；确认保存、目标路径/冲突/覆盖恢复；资源结果幂等与持久审计；原生GUI/Pi实际交互；真实提供方图片/文件算法包、全源scope及其他OS验证。内存峰值、低端设备压力和外部文件原子性仍未接受。消费者不得因本候选文档自行宣称正式profile或改动冻结包。全部154条接受状态仍单列。

### 输出结构校验

二进制资源候选对声明的 capability.outputSchema 校验 result JSON；不符合时固定 invalid_output，整组输出均不登记。未声明schema时仍执行JSON大小和严格帧检查。真实Host专项追加“合法原始帧、已封存2MiB输出、JSON字段类型错误”场景，收据单列 invalidOutputSchemaRegisteredNothing；原旧JSON资源路径暂未追加此schema行为，仍待统一协议评估。

统一校验：Host二进制分支复用既有 output.schema.v1 校验器，执行 capability.maxResultBytes（同时受全局上限约束）、oneOf及嵌套类型/约束，不另写较弱的schema解析器。验证错误映射为固定invalid_output，字节预算错误为result_too_large。当前资源调用仍要求非null JSON结果；纯null结果加资源输出需要后续协议评估，不能静默宣称支持。声明输出契约须manifest schemaVersion=2并requiredProfiles指定output.schema.v1兼容版本；runtime 中的资源输出标识仍为内部 draft1。当前源码另有 [resource.output.types.v1 预览版](resource-output-types-profile.md) 协商扩展 MIME 索引；这不是正式稳定 resource.v1。

## 发布实现修正

后续能力分别见[可信预览](resource-output-preview.md)与[跨工具授权候选](resource-transfer-candidate.md)。跨owner共享必须另走桌面确认接口；原始输出引用本身仍不能越过owner读取边界。

2026-10-10：摘要/记录准备移到库锁外，准备后复核授权、源资源、当前共享配额与取消，再整组发布。详见[输出发布边界](resource-output-publication.md)。准备完成并不等于登记成功，取消仍可丢弃未发布输出；不新增客户端字段或正式profile声明。
