# Host 文本结果原生另存 result.export.text.draft1

本接口只由当前工作区的可信父窗口通过本地 Tauri 命令使用；不提供 HTTP 路径写入接口，不向插件或 iframe 提供路径、文件系统权限或保存句柄。提供方只生成纯文本，不因生成而获得保存权限。实现开发与本机验收记录见 2026-10-30 校验清单迭代记录。

输入 `source={scope:{workspaceId,sceneId,pluginId,capabilityId},resultId}` 指向 Host 已捕获的成功 `text/plain` 结果。结果沿用捕获池限制：单项64KiB、共64项/2MiB、有效15分钟。创建授权时及写入前均复核结果与启用插件的版本/权限证明；不能由前端传入或替换原文。工作区关闭、窗口或路由改变、结果过期、插件停用/修改均拒绝新的写入。已明确生成的结果是其独立快照；文件摘要面板在生成前后及选址/保存前另外复核原文件授权，撤销时清除显示与待保存入口。

命令：

- `select_result_text_export(workspaceId,source)`：复核来源后显示系统另存窗口；取消返回null。选择位置后准备60秒有效的授权，最多16项；返回 `schemaVersion=1`、`profile=result.export.text.draft1`、`operation=create_new_file`、`requiresConfirmation=true`、`saved=false`、grantId及preview。
- preview含grantId、destination、resultId、mimeType、byteLength、contentVersion（完整UTF-8内容SHA-256）。尚未创建目标文件。
- `commit_result_text_export(workspaceId,source,grantId,confirmed)`：必须明确confirmed=true。绑定原窗口、工作区、路由、来源与结果证明；由Host原始快照写入，不接受路径或原文参数。原子发布前持有工作区写入门、插件注册表和结果池锁并再次检查；拒绝重复写入。
- `cancel_result_text_export(workspaceId,source,grantId)`：只撤销当前调用者匹配的未完成授权。未知授权幂等，不删除文件。
- `verify_result_text_export(workspaceId,source,grantId)`：只读取本授权已完成文件，复核长度及完整SHA-256；写入后有效15分钟。允许在插件后来停用时核对已保存副本；不执行第二次写入。

写入复用 resource.export.file.draft1 的 Destination/Staged：普通本地盘、父目录身份复核和防重解析、随机同目录临时文件、全量摘要与刷盘、拒绝覆盖的最终发布、失败清理临时文件。没有保存到目录、网络盘、覆盖、追加、自动重试或自动删除已保存结果。Windows FILE_RENAME_INFO 显式分配末尾UTF-16 NUL，FileNameLength仍只计算路径字节；避免路径长度恰好对齐时读到缓冲区外。已有文件只返回冲突，其他原生写入失败不再误报“文件已存在”。

前端复用同一另存确认与不确定响应恢复界面：系统选址、可见目的地/长度预览、独立确认，取消不写；响应不确定时只提供只读核对，禁止盲目重放。结果和目的地回执必须与原Host描述符一致。校验清单当前父入口仍使用1–4文件/合计32MiB的实际摘要，提供方纯计算协议最多64项/32KiB；这不等同于完整目录批量生成和验证。

入口例外：`main.rs` 超过500行，本批只添加模块导入和四个命令注册；实现均在独立picker、Host结果导出和前端模块中。

Windows结构定义：[Microsoft FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)。
