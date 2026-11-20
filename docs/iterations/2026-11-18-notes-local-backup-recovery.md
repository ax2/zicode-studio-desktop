# v0.6.7：本地笔记完整副本与独立备份恢复

关联 [#25](https://github.com/ax2/zicode-studio-desktop/issues/25)，只交付“本地完整副本和独立备份均可恢复，明确同步不是备份”子范围。整项仍开放；对 #24 的依赖保留。

## 实际修复

- 完整导出不再借用界面的容错笔记本／活动笔记列表。合法受管笔记本配置或 UUID 命名的活动／回收站笔记无法读取、解析时，完整导出失败，不静默漏导出。
- 活动与回收站使用同一导出专用文件枚举规则；读取目录或目录项失败会传播。明确非笔记文件／目录仍过滤，普通界面列表保持原容错行为。
- 受管附件枚举／读取失败，或附件为空、不能按既有备份格式恢复时，导出失败。没有提高原导入大小／数量限额。
- 补充[用户可操作的备份和恢复说明](../notes/local-backup-and-recovery.md)：JSON、完整冷副本、恢复码和同步各自的作用与边界。

## Windows 真实入口验证

自动化 `host_server::notes_backup_recovery_tests::local_complete_copy_and_independent_archive_restore_without_cloud_recovery_code` 使用三个真实隔离资料进程，生产 `NotesVault`、`HostServer` 与 `/v2/notes/export-all`、`/v2/notes/import-all-backup` 入口，不用 HTTP 替身。

1. 原资料创建中文／emoji 正文、笔记本父子层级、图标、标签、网页来源及笔记间引用；存储 PNG 与包含 0–255 字节的 PDF 夹具，并删除一篇带附件笔记到回收站。
2. 保存独立 JSON 和另外保管的合成恢复码。关闭原 Host，复制完整资料，再移走原路径并移除恢复码文件。
3. 在新的冷副本资料中打开；在另一全新资料通过真实导入入口恢复 JSON。验证正文、笔记 ID、笔记本层级与引用映射、来源／标签／时间、附件 MIME／字节／SHA-256、回收站元数据和恢复正文。
4. 目标先放一篇已有笔记；损坏 JSON 导入失败，目标已有笔记不变；正常导入后再次核对。独立 JSON 摘要不变。
5. 注入合法笔记／回收站文件非法 UTF-8、目录不可枚举以及损坏／空附件，完整导出拒绝。非笔记文件过滤、普通列表容错仍通过。

原资料仅移到测试拥有的离线路径，测试不读取该路径作为恢复兜底。所有数据合成；未读取日常资料、系统凭据、真实 WebDAV 或调用模型，未打开原生桌面，也未创建定时任务。

## 验收回执（2026-11-18 Windows）

- `cargo check --locked --offline --all-targets`：通过，58.68 秒。
- `cargo clippy --locked --offline --all-targets -- -D warnings`：通过，1 分 18 秒。
- 真实三进程隔离恢复：1 通过、0 失败、0 忽略，0.87 秒；编译 2 分 14 秒，测试并发为 2。
- 同源已编译 Windows 测试程序定向回归：下列 4 项均通过，无重复全应用构建。
  - `notes_vault::tests::full_backup_rejects_a_notebook_missing_from_the_tolerant_list`
  - `notes_vault::tests::exports_every_notebook_as_one_workspace_bundle`
  - `notes_vault::tests::stores_safe_attachments_and_round_trips_readable_backups`
  - `notes_vault::tests::backups_include_trashed_notes_and_their_attachments`
- 当次原生测试程序 SHA-256：`059d7381a98bab6cb0fe950c46e3316b210146f930ee0917c64e2ff8077a8f5f`。
- 差异和用户说明的相对链接检查通过。

保留修复前失败证据：受管附件读取失败旧路径仍成功；合法 UUID 活动和回收站笔记损坏旧路径均仍 HTTP 200（`parse-active` / `parse-trash`）。初次严格 Clippy 的冗余闭包告警及修复后记录也保留。第二轮 Cargo 调用因空运行资源触发重复编译，已停止本任务的编译子进程并复用同源完成的测试程序；未把中断当作通过。

本地原始日志在工作台 `outputs/notes-backup-red.log`、`notes-backup-note-files-red.log`、`notes-backup-clippy-first.log`、`notes-backup-core-pass.log`、`notes-backup-final.log`；失败合成资料按测试拥有记录保留。

## 未覆盖范围

这是同一台 Windows 的三个隔离资料环境，不是两台设备或真实服务同步验收。真实 WebDAV 条件写／ETag、限流、并发冲突、断网／凭据失效与恢复码跨设备仍由 #25 原验收追踪。没有新增云服务承诺，也没有验证所有应用数据的跨设备迁移。JSON 不包含未保存编辑、凭据、同步队列、应用设置或无法识别的自建文件；系统凭据不会随资料复制自动迁移。