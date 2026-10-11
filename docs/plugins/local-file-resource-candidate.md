# 本地项目文件 → 资源快照（候选）

2026-10-11，Studio 可信桌面内部接口 `resource.local-file.draft1`。为 Explorer 文件入口及 ZiFile 读取能力建设文件交接通道；不是正式 resource.v1 或 native runtime，不授权提供方新增声明。

## 约束与生命周期

仅桌面身份可以调用四个入口；插件 bearer token、远程调用和插件 iframe 不可调用。输入不接受 workspaceId、sceneId 或绝对路径，准备/读取的项目与场景来自实时 runtime/session。接收者必须是启用并授予 resource.read 的 WASI draft2 能力；绑定当前包/模块、权限、Broker 凭据代际及注册项目根目录。历史状态查询和取消按原owner精确匹配，实例停止/撤权后仍可使用，但不恢复任何读取或执行授权。

1. **准备**：打开注册项目内的单个常规文件，只核对身份、长度和时间戳，不读内容、不创建资源、不运行工具。立即关闭句柄，不在等待确认时阻止用户编辑文件。返回供可信桌面展示的项目相对名称及长度。
2. **确认**：一次性消费凭据，重新打开并核对同一文件身份、长度及时间戳；读取有界字节后再次核对。文件替换、变化、权限/包/会话/项目根变化拒绝。成功时以实际字节 SHA-256 建立现有只读资源快照，后续编辑原文件不影响快照。
3. **取消**：移除尚未消费的凭据，不读内容；在途读取则请求合作式取消，权限撤销或实例停止后仍可提交取消。读取以64KiB块为检查点，取消后不发布部分资源。系统调用尚未返回时不能确认它已经结束。

凭据准备后120秒过期；待确认和在途读取合计32个全局、每runtime8个。待确认凭据按请求惰性清理，不持有文件句柄或内容；在途记录必须等实际任务结束再释放，不能因取消/超时请求或HTTP断开提前归还配额。确认拒绝/读取失败后也不能重放同一凭据；需用户重新准备并确认。不自动重试，丢失成功响应不恢复结果。

确认读取期限为开始读取后30秒与原凭据过期时间中的较早者。打开文件前、每块读取前后、文件版本复核后和资源发布前检查取消/期限；发布与取消由同一Store锁确定先后。期限是合作式检查，不是OS调用硬截止，挂起的open/read/metadata仍需系统级中断方案。实际任务持有读取配额和清理lease，正常错误/取消/失败均回收在途记录。

单文件最大32MiB，沿用资源Store的32条/128MiB预留总量、64KiB分块和900秒确认资源寿命。文件读取受既有最多8个实际资源操作约束；在途读取和Store记录是独立预算，系统进程resident memory没有新增硬限。配额不足可能在读取后拒绝入库，失败不留半上传资源或写入磁盘。没有扩大 Worker 执行预算或资源大小。

## 路径与系统边界

采用 `/` 分隔的项目相对路径；禁止空段、`.`、`..`、绝对路径、反斜杠、冒号/ADS、控制符、通配符及常见Windows设备名、末尾点/空格。最多4096字节、64段、每段255字节。

Windows仅本地盘：检查路径重解析点，并核对实际打开句柄解析后的路径仍在项目根内；读取句柄只允许共享读，禁止同时写入/替换。Unix逐层openat + O_NOFOLLOW，非末层必须是目录；O_NONBLOCK避免FIFO等待，最终只接收常规文件。符号链接/重解析点与设备不作为输入。两平台文件身份和修改信息在读取前后检查，实际交给工具的版本始终是快照字节摘要。这不是原文件的跨平台事务快照或原生插件沙箱。

## API

全部 POST，JSON body最大16KiB，未知字段拒绝。

当前增加第四个只读入口`/v2/plugin-resources/status-local-file`，请求为同一schemaVersion/owner/grantId，`confirmed`可省略且不产生授权。仅可信桌面调用，插件bearer/iframe/远程客户端不能查询；错误owner与未知ID不区分。不读取文件、不占8个阻塞操作槽位、不运行工具。

返回`phase`：`prepared`（尚未读取，contentRead=false）；`reading`（实际任务仍存在，contentRead=null、executionFinished=false，cancellationRequested只是请求标记）；`ended`（实际任务lease结束，executionFinished=true、outcome为published/cancelled/timedOut/failed）。published仅证明当时建立过快照，contentRead=true，不表示资源仍存在或当前授权有效；其余已读取字节可能不确定，contentRead=null。读取前取消的结束回执contentRead=false。状态不返回access/resourceId、路径、字节或模块摘要，不能用来重放确认、执行或恢复资源。

结束回执仅当前Host内存保留120秒、最多128项，满时淘汰最早回执，不淘汰在途工作；未知/过期/被淘汰/Host重启返回resource_file_grant_unavailable，**不是已结束的证明**。待确认/在途原32全局与每runtime8的配额独立保持。桌面gateway提供`projectFiles.status(owner,grantId)`；UI自动状态恢复、丢失成功响应的资源恢复与持久记录尚未接入。仍属内部draft1增量，不能根据应用版本号0.4.2推断旧EXE包含该入口。

`/v2/plugin-resources/prepare-local-file`

```json
{"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"relativePath":"input/example.zip"}
```

响应含profile、grantId、owner、relativePath、byteLength、expiresInSeconds=120、contentRead=false、confirmed=false。名称只给可信桌面显示，不进入 Worker。

`/v2/plugin-resources/commit-local-file`

```json
{"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"grantId":"UUID","confirmed":true}
```

返回现有资源描述、access、confirmed=true、saved=false。只读快照不保存原文件，不授权目录、写入或执行。执行仍需独立操作并走原有资源调用准入、权限、schema、超时与取消检查。

`/v2/plugin-resources/cancel-local-file` 使用同一owner/grantId，confirmed可省略。未开始时返回cancelled=true/cancellationRequested=true/executionFinished=true/contentRead=false；在途返回cancelled=false/cancellationRequested=true/executionFinished=false/contentRead=null（可能已经读取部分字节）。在途重复取消保持相同含义；错误owner不能取消。该控制入口不占用8个阻塞资源操作槽位，避免繁忙时无法取消；仍校验桌面身份和schema。

取消入口在实际任务结束、资源已发布、凭据不存在或未开始时已过期后返回resource_file_grant_unavailable，不能据此判断历史操作成功或失败；可另用只读状态入口查询尚未过期的回执。已经发布的资源须使用现有resource revoke接口撤销；前端保留在途grant，Cancel/destroy会请求取消，迟到的成功响应仍会撤销资源。没有持久恢复，不把“请求已提交”显示为Host读取已终止。

固定错误码包括 resource_file_path_invalid、resource_file_unavailable、resource_file_not_regular、resource_file_changed、resource_file_grant_budget_exceeded、resource_file_grant_unavailable、resource_file_read_cancelled、resource_file_read_timeout，以及现有授权/资源限额错误。原始路径和OS错误不回显到插件或日志。

## 验收与待办

本阶段增加接口边界、文件身份替换、限额、确认/取消/重放与已有资源撤销测试；实际HTTP/WASI专项与最终结果见技术博客 `iterations/local-file-resource-2026-10-11/`。本轮没有添加UI，不代表Explorer文件入口或ZiFile算法已验收。

仍需可信文件选择/确认界面、Explorer文件意图接线、目录/多文件授权、大于32MiB的流式文件通道、读取取消与系统IO截止、丢失响应恢复、跨重启记录，以及macOS/Linux实际运行与文件系统验收。ZiFile原生隔离和归档写入协议继续按完整矩阵推进；此接口不允许降低矩阵接受门槛。

2026-10-11 后续：[项目文件选择入口](project-file-picker.md)已增加原生选择命令及可信资源选择界面，生成当前debug EXE。实际浏览器/Host/WASI确认与执行通过；系统文件选择交互在该专项以固定选择代替，不能计为原生弹窗或完整WebView验收。上述目录/大文件、Explorer文件意图及其他边界继续保留。

## 2026-10-11 合作式读取取消与迟到响应

本页生命周期与取消响应已按当前实现更新。读取控制、分块检查和任务清理在独立模块；前端确认期间保留grant，取消后显示等待准备结束，输入分配控件在实际请求完成前保持禁用。

资源子系统默认回归55通过/2ignored；其中本地文件实际HTTP→确认快照→WASI专项另行启用，通过1项，所属Worker启动/回收/管道关闭一致。真实HTTP取消测试在8个实际操作槽位占满时通过；用例在读取边界人为暂留一个已开始任务，证明控制路由、取消检查和配额生命周期，不证明OS调用可强制中断。前端12项相关测试通过。

当前Windows debug EXE SHA-256 `0559813021C5BD5F5D7646EB46B2D02DF8BE46227B02B99C815BEF18C59327BF`。实际WebView将真实成功commit响应暂留后点击取消：Host已发布所以按定义返回409；交付响应后前端撤销迟到资源成功，取消阶段无工具执行，重新明确确认后真实WASI显示abcd。这里仅注入交付延迟，不伪造Host响应或模拟OS读取。console有该竞态预期409一条，pageerror/AI请求0。

1440×900取消等待与390×844重试结果截图已检查。技术博客证据在`iterations/local-file-cancellation-2026-10-11/`。复用debug、版本保持0.4.2，无新发布/ZIP；保留其他项目和冻结提供方包。

仍需验证真实慢盘/挂起IO、系统级中断、状态查询的UI恢复与跨重启恢复、撤销失败/丢失响应恢复、其他OS；目录、多文件、大文件流、原生隔离与归档写入仍未实现。DevTools/ZiFile真实功能接受不因本轮增加。

## 2026-10-11 只读状态查询验收

新增独立状态/回执模块；默认资源子系统58通过/2ignored，实际本地文件HTTP→确认快照→WASI专项另行1通过，前端gateway/文件交接29通过，最终Rust静态检查和前端check退出0。真实HTTP在8个实际操作槽位占满时查询reading，取消后仍reading且executionFinished=false；实际任务lease结束后才ended/cancelled。实际成功commit后查询ended/published；查询不返回资源凭据且不允许重放commit。准备状态、接收者隔离、超时/失败回执、128条淘汰和120秒过期由专项覆盖。

复用当前debug EXE，SHA-256 `874BDF6491A90579EA13739E15807361010CA2B3EFA9EC0BB185CF34A8FEC70C`，版本0.4.2。真实WASI Worker启动/回收/管道关闭一致。证据在技术博客`iterations/local-file-status-2026-10-11/`；本轮新增状态接口及gateway能力，未新增界面状态恢复交互，不用旧截图充当新UI验证。其他OS和提供方实包仍待。
