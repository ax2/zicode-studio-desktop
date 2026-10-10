# 已保存插件文件库：resource.library.draft1

Studio 可信桌面内部候选接口，非正式 resource.v1，也不给插件或 Broker 文件读取权限。文件库位于既有交付物页面，不增加工具侧栏图标。持久来源仍是用户确认写入的 `.zicode/outputs/<saveId>/result.<ext>` 与 `receipt.json`，直接读取原文件；不复制二进制、不维护第二份索引或扩大现有 JSON 交付物接口。

## 使用流程

确认保存插件输出 → 打开交付物中的“已保存的插件文件” → 按项目搜索/分页 → 点击后校验并预览或下载。列表仅读取来源记录和文件属性，明确显示“打开时才校验文件内容”；同长度内容修改不会在列表扫描时被冒称已验证。选中预览显示在列表上方，关闭/项目切换/离开界面回收读取和 Blob URL。下载是明确用户操作，使用生成文件名并交给浏览器/WebView 下载机制，不默默写入另一个项目路径。

文件已是用户批准的持久副本，源资源过期/撤销/会话停止不删除它，也不要求重新启用原算法插件才能查找。当前项目必须已注册，交付物核心插件必须启用并具备当前场景的 `storage.plugin` 权限；撤权后不能读库，界面每5秒在上次检查完成后再次检查并清除旧预览。恢复权限后仍需手动搜索/打开，不自动执行或传给其他工具、聊天或 AI。

## GET /v2/plugin-resources/saved-outputs

严格查询参数：`schemaVersion=1, sceneId, workspaceId, query?, offset?`。仅桌面凭据；未知 path 等参数拒绝。project root 从已注册工作区查表推导并规范化，调用方不能指定文件系统位置。

返回 `{schemaVersion:1,profile:"resource.library.draft1",workspaceId,items,total,offset,pageSize:40,hasMore,skippedEntries,payloadsRead:false}`。每项为 `{receipt,receiptVersion,integrity:"not_checked"}`；Receipt 沿用 resource.save.draft1，receiptVersion 是当前来源记录原始字节的 SHA-256。记录 `preparedAt` 是保存确认的准备时间，不冒称落盘时间。来源版本是本地收据中的记录，不是独立提供方签名或算法验收证明。

最多扫描128项，每份收据最多8KiB；搜索最多120字符，偏移最多128。缺目录返回空集合且不建目录。无完整发布收据、字段/版本不符、跨项目收据、非固定扩展名、大小变化或危险结构计入 skippedEntries，不删除原文件；超出目录预算拒绝本次扫描，不截断后声称完整。UUID、摘要、当前项目及精确相对路径校验；目录与文件拒绝符号链接和 Windows 重解析点。列表不读取资源原始内容。

## GET /v2/plugin-resources/saved-output

严格查询参数：`schemaVersion=1,sceneId,workspaceId,saveId,receiptVersion`。只接受规范 UUID，不能传路径、文件名或资源 owner。读取前后复核当前存储授权世代和注册项目位置；固定生成路径的原始字节最多32MiB，核对长度、内容SHA-256及来源记录版本，读取后再次核对来源记录。文件或收据变化返回 `saved_output_changed`，文件保持原样，不自动覆盖、重建或恢复。

成功响应使用 `application/octet-stream`、`Content-Disposition: attachment`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。客户端按描述符精确分配最多32MiB并逐块读取，过长/过短/MIME不符拒绝，关闭/超时取消读取；核对完整SHA后才显示或下载。不透传 Host 原始错误消息。

预览复用静态 PNG/JPEG/WebP 头部/像素/解码检查，只显示重编码PNG；图像/二进制预览8MiB、纯文本128KiB，二进制只显示前256字节十六进制，HTML外观文本使用只读文本控件。大文件仍可在32MiB预算内明确下载原始字节。JSON交付物导入/导出不包含本库文件，界面明确提示单独下载。

## 隔离和验证边界

文件读取复用现有八槽阻塞任务预算；没有资源库锁内全量复制或自动执行。八槽约束实际阻塞工作，不宣称覆盖HTTP响应在慢客户端中的完整存活期。相同文件系统权限的外部进程在最后路径/授权复核之后替换路径、撤权与响应发送之间的窗口、断电事务及多客户端压力仍需专项评估。只读接口不自动修复或清理崩溃遗留目录。

当前阶段：`C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/saved-output-library-2026-10-10/`。最终证据以 verification-summary.json、最终实际收据和实看截图为准；早期失败与中间截图保留。复制类 Studio 夹具证明通用承载链路，不证明任何 DevTools 图片算法或完整工具范围。

仍待：正式 resource.v1/签名来源链、二进制交付物备份/导入与统一 ArtifactDescriptor、直接从持久副本向其他工具签发新的用户确认资源授权、全项目统一搜索、用户命名/目的地与覆盖冲突恢复、崩溃/跨重启幂等、原生 WebView 下载行为、真实 DevTools 包/完整scope、最大预算/慢客户端并发性能、其他操作系统和文件系统。154项工具和逐项阻塞清单继续完整维护，通用候选通过不提升完整工具验收数。


## 当前接受证据

最终28前端/36资源测试及显式实际专项通过，源码Host/生产Worker/Edge于http://127.0.0.1:18508验证，截图已实看；当前EXE SHA256 5ea0dfe82bc8fef11409472ef6856c41977c21eaa6c9dd0f49f2ad842f268e67。最终verification-summary.json和actual-host-library-attempt3.json见阶段目录；与早期失败/中间截图分开，不提升完整154工具接受数。


## 2026-10-10 可信父界面重用输入

已实现主视图资源选择区直接从本项目文件库选择，确认后校验原始字节并通过既有上传流程重新签发接收方临时快照。见 [输入候选说明](saved-output-input-candidate.md) 和 saved-output-input-2026-10-10 阶段证据。上文“直接从持久副本签发”剩余项现在指正式Host导入/签名来源链、无主视图统一入口；不能把可信父界面重传冒称正式Host协议。
