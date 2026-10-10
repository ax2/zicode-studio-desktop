# 资源结果确认保存候选：resource.save.draft1

仅供 Studio 可信桌面父级使用的内部扩展，尚非正式 resource.v1。独立 DevTools 插件不接收路径、存储凭据或此接口权限；仅交付资源 ABI 输出。现有交付物JSON接口及冻结提供方包保持兼容。

## 当前目标与存储

将 PNG/JPEG/WebP、纯文本和二进制资源原始字节保存到当前已注册项目的 `.zicode/outputs/<saveId>/result.<固定扩展名>`，同时写入 `receipt.json` 来源记录。项目由当前运行会话推导，客户端不能传项目ID、路径、文件名或覆盖选项；无工作区映射时拒绝保存。这里是受管文件导出，不是原有1MiB JSON交付物存储的二进制索引扩展。

资源读权限、当前插件/能力/模块证明、完整祖先授权链、活跃运行会话/凭据、项目规范路径、交付物核心插件的 `storage.plugin` 权限均参与校验。保存票据绑定资源/内容版本、原owner、项目位置和存储授权世代；来源或存储权限撤销后重授不能复用旧票据。只保存快照，不给算法文件系统权限。

## 两步接口

### POST /v2/plugin-resources/prepare-save

请求：`{schemaVersion:1,source:Access}`。Access 沿用资源协议 `{schemaVersion:1,owner:{runtimeId,sessionId,pluginId,capabilityId},resourceId,contentVersion}`。

响应：`{schemaVersion:1,profile:"resource.save.draft1",grantId,expiresInSeconds:60,requiresConfirmation:true,saved:false,operation:"create_new_file",preview:Receipt}`。

Receipt 包含 schemaVersion/profile、saveId、workspaceId、relativePath、mimeType、byteLength、contentVersion、preparedAt，以及 source 的 pluginId/capabilityId/resourceId/packageVersion。不包含字节、桌面令牌、Broker凭据或模块路径。preparedAt 是准备时间，不冒称实际落盘时间。准备/取消仅使用有界内存票据，不建立输出目录或写磁盘。

### POST /v2/plugin-resources/commit-save

请求：`{schemaVersion:1,source:Access,grantId,confirmed:true}`；严格拒绝未知字段和目标覆盖。仅桌面凭据可调用，Broker不能代替用户批准。

响应：`{schemaVersion:1,profile:"resource.save.draft1",status:"saved",saved:true,replayed:boolean,receipt:Receipt}`。同一未过期票据完成后重复确认返回原收据，核对原文件字节/SHA-256及收据，不重复创建；文件被用户修改或删除后拒绝重放，不自动重建或覆盖。请求中断/超时不能直接推断未写入，客户端显示固定复核提示，不自动重试。

## 发布与预算

最多16张/60秒票据；每资源最多32MiB，项目输出目录最多128个受管导出目录、总计256MiB（包括未发布目录）。扫描有界，未知文件结构、符号链接/目录重解析、非目录组件拒绝；配额是拒绝新保存的预算，不是删除用户文件的依据。

仅确认后以独占新建方式声明生成的输出目录，并写一次原始资源字节。不可变Arc分块引用在资源锁外复制/散列/刷盘，避免Base64与全量JSON放大。完整来源收据是最终发布标记；发布前再次复核来源/祖先、票据期限、项目位置、存储授权与配额。优先用不会替换文件的硬链接发布小型收据；不支持硬链接的文件系统使用独占新建的有界收据拷贝，原始二进制不重复拷贝。失败只清理本次明确创建的未发布文件，不递归清理或替换已有输出。

成功保存的副本是用户批准的持久数据，资源撤权/过期、关闭预览或插件卸载不会删除它。确认之后切换页面也不会撤回已经执行的写入，完成或不确定结果需通知用户检查原项目。文件数据和收据分别刷盘，但这不是所有操作系统/断电情况下的目录事务保证。进程崩溃可能留下无完整收据的未发布目录；尚不自动恢复或清理。Host会在发布前复核当前授权，但不宣称阻止有同等文件系统权限的外部进程在最后检查后替换路径。

固定拒绝分类包括 resource_save_workspace_unavailable、resource_save_directory_unavailable/unsafe、resource_save_quota_exceeded、resource_save_busy、resource_save_grant_invalid、resource_save_conflict、resource_save_write_failed、resource_authorization_changed，及已有授权/资源错误。客户端展示固定提示，不透传服务端原始消息。

## 界面和验证

每项输出的“预览保存”打开独立可信对话框，展示当前项目内精确相对位置、MIME、字节数、60秒期限和持久副本说明；取消/Escape不写入，确认按钮单独执行。运行中的保存不提供虚假的取消，迟到结果不自动删文件；接收工具产生的资源输出也可使用同一保存入口。

本阶段证据：`C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-save-2026-10-10/`。以最终收据和已实看的截图为准。Studio复制夹具只证明传输/授权/保存，不证明DevTools图片算法。

待验收：完整原生WebView/人类文件体验、真实提供方资源算法包和完整工具子功能、二进制交付物索引与备份/导入、用户自选文件名/目的地、覆盖冲突恢复、多跳工作流、跨重启幂等与崩溃恢复、最大预算/并发/低端性能、macOS/Linux及其他文件系统。完整154工具范围与未接入原因持续维护，不因此提升完整工具接受数。

## 2026-10-10 当前验证证据

本轮40项前端与31项资源域测试通过；ignored真实环境专项单独显式执行通过。actual-host-resource-save-attempt3.json记录生产Worker派生300000字节原始输出、两类发布前撤权/清理、编辑保留、票据重放、目标项目改变和恢复；browser-result-2026-10-09T21-57-53-384Z.json记录实际HTTP/Worker与生产父级UI的发现/加载/执行/精确PNG保存及撤权回归。桌面1280×900明亮确认和390×844深色成功截图已实看。两次测试恢复/顺序失败保留，修正后重跑。源码Host测试进程、生产Worker和隔离Edge页面不能代表原生GUI或提供方算法。EXE0.1.0 SHA256:5718a655be11cd311c0c78d0ddda5105e39a03ebb4f9a0b88ac4cde32d363b1a；完整工具验收数仍0。
