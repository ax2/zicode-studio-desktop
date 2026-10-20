# 文本结果发送候选 v1

结构化对象接力采用单独的显式 [`result.json.v1` 候选协议](result-json-profile.md)：JSON 对象只映射到接收方 object 字段，不把 JSON 隐式转为文本。本文的默认文本 `resultRef`、string 字段映射及冻结提供方行为保持 v1。

2026-10-17：普通文本结果的接收目录查询现在由可信父界面传 `AbortSignal`；新搜索、离开目录、取消或卸载会中止旧请求，序号检查仍阻止迟到数据回填。Host 的 `/v2/plugin-results/targets` 请求体及分页格式不变，同一工具可作为下一轮文本计算的接收方。此行为与资源输出接力目录的源工具排除分属不同接口；见[阶段记录](../iterations/2026-10-17-text-result-receiver-search-cancel.md)。

2026-10-11：[预览输入修改、接收工具重选与原生View验证](transfer-reselection.md)。
这是Studio可信界面改进；候选Host请求格式与冻结提供方契约保持不变。

状态：候选，Studio 内部桌面接口；不授权 resource.v1 或提供方新增 SDK 方法。

POST /v2/plugin-results/prepare-transfer：{scope,resultId,target:{pluginId,capabilityId},field}。Host 只从来源记录读取文本，映射到声明的顶层 string 字段；其他必填字段导致拒绝。来源和目标只能同工作区/场景，双方必须当前授权且为隔离 WASI 计算。预览返回版本、字节数、文本、字段和有效期120秒的 grantId。

POST /v2/plugin-results/commit-transfer：{scope,grantId,confirmed:true}。桌面身份、来源/目标完整性和授权修订再次核对。执行读取 Host 保存的映射，不接受客户端替换输入/目标。grant 绑定来源及目标版本、schema、权限和操作；工作区不能改变。相同 grant 返回同一结果，不重复执行；预算/失效/确认缺失明确报错。成功文本可生成新 resultRef，继续链路或显式保存。

单次输出缓存最多64KiB，最多32个grant/合计2MiB；不记录原输入文本到审计。不自动发送给模型或远端，不自动保存。执行后切换页面不撤销已经确认的计算。

2026-10-17 后续原生复验：两份独立 DevTools 无签名开发候选 Text 0.1.0 与 Trace 0.1.0 已在当前 Windows Debug 窗口完成 Text Base64 解码 → Trace Java 异常链的一次预览、明确确认、接收执行及展示；两份安装目录分别以包外收据核对 13/13、346/346 文件，见[阶段记录](../iterations/2026-10-17-text-to-trace-native-transfer.md)。此前同包与派生身份测试的边界继续保留。正式签名提供方包、长时取消/恢复、通用资源及其他操作系统仍未验收。

2026-10-18：冻结 Diagnostics 0.1.4 的真实 Windows Worker 报告已在隔离 Host HTTP 中经预览、明确 `confirmed:true` 转交独立 Text 开发候选，再经保存预览与确认生成单一成果；无效诊断报告不产生结果引用且不影响 Text。详见[接收与续验记录](../iterations/2026-10-18-devtools-catalog-d084-diagnostics-014-intake.md)。测试客户端的确认字段不等于原生 UI 用户点击证据；签名包、完整业务范围和跨平台仍待。

## 接收方计算取消扩展（2026-10-17，Studio 本地候选）

`POST /v2/plugin-results/cancel-transfer` 接受 `{scope,grantId}`，仅限桌面身份；未知字段和错误作用域拒绝。响应 `{schemaVersion:1,status}`，其中 `cancelled` 表示尚未执行的 grant 已撤销，`cancellation_requested` 表示运行中的 Worker 收到停止请求，`completed` 表示响应已经缓存、取消未生效。请求取消不是计算已停止的证明，调用方须等待原 `commit-transfer` 的最终响应；成功结果可能在取消请求前完成。Worker 停止后返回 `error.code=worker_cancelled`，不生成结果引用；同一 grant 不再启动计算。若请求取消后的提交连接失败、最终结果未知，可信界面禁止直接重试该 grant。

取消不改变源/目标授权、输入映射或保存权限，也不要求提供方新增 SDK。它只作用于该 grant 的接收方计算。Windows Host/Worker 测试进程已验证实际停止；新版隔离 Debug EXE 已看到原生确认后的可用取消入口和普通接收结果，但接收工具完成过快，原生点击未证明停止 Worker。两家独立提供方、其他系统和崩溃后的结果查询仍待验收。

## 同一 Host 生命周期内的结果恢复（2026-10-17）

`POST /v2/plugin-results/transfer-status` 接受 `{scope,grantId}`，仅限桌面身份；查询不执行、不取消、不保存。Host 重新核对来源记录、来源及目标当前授权、安装内容 proof 和请求作用域。状态为 `ready`、`running`、`cancellation_requested`、`cancelled` 或 `completed`；仅 `completed` 带原缓存的 `response`，其中可能是成功结果或 Worker 错误。失效、跨工作区、撤权和内容变动不会借此暴露旧输出。可信父界面在提交连接中断后自动查询一次，并提供手动再查；同一 grant 的确认按钮保持禁用，找回成功结果时仍交由已有结果展示入口处理。

grant 只保留 120 秒且在 Host 内存中。进程重启、grant 过期或状态查询连接也失败时，结果仍可能未知；查询失败不等于未执行，不能自动重放或自动保存。恢复接口不改变提供方 SDK、输出协议或签名要求。


## 精确边界
接口仅接受桌面身份；未知字段拒绝。prepare 不执行目标或保存文件。commit 的计算失败、业务失败和超限会缓存为响应；HTTP 200 的 error/result.ok=false 不能当成功，UI 必须检查。传输 grant 最多32条，序列化最终缓存响应单条64KiB，因此响应缓存最多2MiB；另有既有结果文本预算2MiB。
当前工作区只由请求 scope 绑定，Host 不把所有窗口视为唯一活动工作区；切换页面清除旧确认属于后续父页面职责。新工作区scope不能使用旧grant。
冻结 DevTools 包的 request.schema 固定 pluginId，不能仅修改清单重命名包。本轮测试接收包是Studio临时派生副本，同步修改等长身份常量；原候选和DevTools代码不变。这个测试证明实际两包授权与执行机制，不证明独立提供方的第二个实现完成。


## 桌面父页面与有界目标搜索（2026-10-08）
POST /v2/plugin-results/targets：{scope,resultId,query?:string,offset?:number,revision?:string|null}。桌面身份、来源作用域/版本/预算检查；每页20个当前可映射的WASI字段摘要，返回items/total/revision/nextOffset。query最多256 UTF8字节，offset最多1000000；页面响应32KiB，超限明确拒绝。包含pluginId/capabilityId/title/field/packageVersion，不包含完整schema或原文。按插件/能力/字段排序；多词匹配名称、插件ID、标题和字段。修订改变拒绝旧分页，修改查询重新从第一页搜索；分页偏移不授予执行权限，prepare/commit仍核对双端。
搜索复用本地schema验证，不为每个字段重新构造全量能力目录。根据单个字符串字段和必填约束过滤，其他字段/图片/文件/有副作用操作不在此候选入口中。枚举可能显示包磁盘损坏的摘要，prepare时实时完整性检查拒绝；搜索结果不是执行授权。
可信父页面已实现发送到→搜索/分页→目标字段映射预览→确认执行→结果展示→继续发送或保存；插件iframe仍只收到原能力结果。取消预览零执行，迟到搜索/预览不能替换新结果，工作区切换移除旧界面。计算失败的HTTP200/error或业务ok=false不可显示为成功结果。
实际Chrome/Host/WASI验证：210个映射（10个来自两个包，200个合成元数据仅规模测试），每页20项；跨包JSON→Base64编码→原包解码→精确文本保存；取消零执行；桌面1280x900/窄屏390x844截图已读。接收包仍为派生身份测试包，不代表第二个独立提供方已交付。
完整原生桌面壳、模型自主互通、发送目标收藏/最近接入、图片/文件资源、多字段映射、异步取消和其他OS仍待验收。新Windows候选交付为release/devtools-results-2026-10-08-02bd955-dirty，完整目录和EXE已冻结；同源码测试Host使用新EXE Worker完成真实浏览器、保存/发送及内置Pi验证，不能代替完整原生壳验收。详细记录见技术博客档案iterations/plugin-result-delivery-2026-10-08。
