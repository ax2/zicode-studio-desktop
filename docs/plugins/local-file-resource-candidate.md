# 本地项目文件 → 资源快照（候选）

2026-10-11，Studio 可信桌面内部接口 `resource.local-file.draft1`。为 Explorer 文件入口及 ZiFile 读取能力建设文件交接通道；不是正式 resource.v1 或 native runtime，不授权提供方新增声明。

## 约束与生命周期

仅桌面身份可以调用三个入口；插件 bearer token、远程调用和插件 iframe 不可调用。输入不接受 workspaceId、sceneId 或绝对路径，项目与场景来自实时 runtime/session。接收者必须是启用并授予 resource.read 的 WASI draft2 能力；绑定当前包/模块、权限、Broker 凭据代际及注册项目根目录。

1. **准备**：打开注册项目内的单个常规文件，只核对身份、长度和时间戳，不读内容、不创建资源、不运行工具。立即关闭句柄，不在等待确认时阻止用户编辑文件。返回供可信桌面展示的项目相对名称及长度。
2. **确认**：一次性消费凭据，重新打开并核对同一文件身份、长度及时间戳；读取有界字节后再次核对。文件替换、变化、权限/包/会话/项目根变化拒绝。成功时以实际字节 SHA-256 建立现有只读资源快照，后续编辑原文件不影响快照。
3. **取消**：移除尚未消费的凭据，不读内容；权限撤销或实例停止后仍可取消。已经消费的凭据不能取消正在进行的系统文件读取。

凭据准备后120秒过期；32个全局、每runtime8个，按请求惰性清理；不持有文件句柄或内容。确认拒绝/读取失败后也不能重放同一凭据；需用户重新准备并确认。不自动重试，丢失成功响应不恢复结果。

单文件最大32MiB，沿用资源Store的32条/128MiB预留总量、64KiB分块和900秒确认资源寿命。文件读取受既有最多8个实际资源操作约束；在途读取和Store记录是独立预算，系统进程resident memory没有新增硬限。配额不足可能在读取后拒绝入库，失败不留半上传资源或写入磁盘。没有扩大 Worker 执行预算或资源大小。

## 路径与系统边界

采用 `/` 分隔的项目相对路径；禁止空段、`.`、`..`、绝对路径、反斜杠、冒号/ADS、控制符、通配符及常见Windows设备名、末尾点/空格。最多4096字节、64段、每段255字节。

Windows仅本地盘：检查路径重解析点，并核对实际打开句柄解析后的路径仍在项目根内；读取句柄只允许共享读，禁止同时写入/替换。Unix逐层openat + O_NOFOLLOW，非末层必须是目录；O_NONBLOCK避免FIFO等待，最终只接收常规文件。符号链接/重解析点与设备不作为输入。两平台文件身份和修改信息在读取前后检查，实际交给工具的版本始终是快照字节摘要。这不是原文件的跨平台事务快照或原生插件沙箱。

## API

全部 POST，JSON body最大16KiB，未知字段拒绝。

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

`/v2/plugin-resources/cancel-local-file` 使用同一owner/grantId，confirmed可省略。取消返回cancelled=true/contentRead=false；已消费/不存在/过期返回resource_file_grant_unavailable，不解释为正在读取已经结束。

固定错误码包括 resource_file_path_invalid、resource_file_unavailable、resource_file_not_regular、resource_file_changed、resource_file_grant_budget_exceeded、resource_file_grant_unavailable，以及现有授权/资源限额错误。原始路径和OS错误不回显到插件或日志。

## 验收与待办

本阶段增加接口边界、文件身份替换、限额、确认/取消/重放与已有资源撤销测试；实际HTTP/WASI专项与最终结果见技术博客 `iterations/local-file-resource-2026-10-11/`。本轮没有添加UI，不代表Explorer文件入口或ZiFile算法已验收。

仍需可信文件选择/确认界面、Explorer文件意图接线、目录/多文件授权、大于32MiB的流式文件通道、读取取消与系统IO截止、丢失响应恢复、跨重启记录，以及macOS/Linux实际运行与文件系统验收。ZiFile原生隔离和归档写入协议继续按完整矩阵推进；此接口不允许降低矩阵接受门槛。
