# 便携快捷配置预览执行档案

`resource.wasi.shortcuts.profile.v1@=1.0.0-preview.1` 仅供插件
`com.zicode.devtools.shortcut-profile` 的手动能力
`devtools.shortcuts.profile.merge` 使用。它复用既有文件输入和结果保存协议，
允许工具在两份分别选择并确认共享的 v1 配置之间预览合并或替换。
可用表单指明哪份是导入文件，默认列表中第二份。原文件与正在使用的快捷键配置保持原样。

- 两份只读输入各至多 16 KiB、32 条绑定。文件 MIME 使用
  `application/octet-stream` 或 `text/plain`。包只要求 `resource.read`。
- 结果至多一个 48 KiB 的 JSON。宿主按两份原始快照、顺序和模式独立验证
  响应计数、快捷序列冲突及有序的规范配置。存在冲突或输入错误时没有可保存文件。
- 保存使用现有“预览保存 → 确认保存文件”流程，生成新的
  `.zicode/outputs/<id>/result.json`。该文件可供独立版 v1 导入。
- 此档案保持 Windows Worker 的既有 5 秒、10M fuel、64 MiB 限额。
  普通 Draft1 及已有比较、格式化档案仍各按其原有约束运行。
