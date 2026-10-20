# Host 内置功能按目标插件授权（2026-10-18）

## 目标和发现

Studio 要承载上百项工具，插件管理和搜索可以遍历目录，但单个内置功能请求不应在全局注册表锁内生成整个插件列表。此前 Notes、证件照、图像、文档、剪贴板、习惯、翻译、监测、文章、OCR 的入口，以及 Notes 网络授权和 Artifacts 来源检查，均通过 `list(scene)` 后按插件 ID 寻找目标。上一轮列表已缓存签名元数据，所以本轮节省的是无关插件清单、授权和版本字段的内存投影，不是新的磁盘读取。

## 修改与语义

十二处授权查询改为 `execution_plugin(scene, id)`。保留原有启用、`storage.plugin`、`network.fetch` 授权及错误码；Artifacts 只查自身与可选来源插件。真正列出应用的 `/v2/plugins` 和工具目录的全量搜索仍遍历插件。本轮不改变插件协议、用户配置、UI、版本号或运行目录。用户暂不启用隔离配置中的 ZiDevTools JSON 对象插件；其真实执行与结果接力仍待验收。

## 验证与遗留问题

`bun run check:rust:static` 退出 0，Cargo check、严格 Clippy 通过；整仓 fmt 保留既有 advisory。三个现有真实 Host HTTP 用例各 1/1 通过：`manages_scene_specific_plugin_state_through_the_host_api`、`manages_markdown_notes_with_optimistic_versions_through_the_host_api`、`manages_scene_scoped_artifacts_with_opaque_handles_through_the_host_api`。它们覆盖插件启用/权限、Notes 与 Artifacts 的代表性链路，未逐项验收其他内置功能 UI。`git diff --check -- src-tauri/src/host_server.rs` 无空白错误。无 UI 改动，因此本轮不产生新截图。

前后只读扫描完整、`UnknownEntries=0`：`target` 30,032,055,543 → 30,032,044,279、`task-scratch` 均为 1,258,318,024 逻辑字节，E 盘空闲 8,329,105,408 → 8,393,080,832 字节。退出 1 为容量建议，卷空闲差额不能归因于本轮；未清理缓存。

未测百插件负载下的锁占用、当前源码跨平台 CI 与正式 JSON 对象插件运行；这些结果不能由本轮单插件授权验证推断。
