# v0.7.9 · SQLite 浏览器

在插件管理安装冻结候选并确认文件读取权限。在工具中心搜索「SQLite 浏览器」，选择并确认一份本机 SQLite 数据库。表名留空可查看目录，填入目录中的普通表名可查看数据。选择「生成此页 CSV」并执行后，再通过预览明确确认保存到 Studio 文件。

支持最多 128 KiB 的 UTF-8 静态独立数据库。目录最多 64 个对象，页码 1–16，每页最多 16 项或 16 行，普通表最多 16 列。目录显示视图和虚拟表名称。数据读取适用于无生成列的普通表。WAL 数据库、虚拟表辅助表及以同一虚拟表名称加下划线开头的同前缀表保留为限制。长文本或 BLOB 只显示有界预览。空页、含截断或不可完整表示的数据页不生成 CSV。可导出的 CSV 使用与原生浏览器相同的字段及电子表格公式保护。原数据库以只读方式处理。

源工具 `sqlite` 1.5.1 的数据库备份、编辑、撤销和任意 SQL 继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。已有 [表格另存 SQLite](2026-11-26-table-sqlite-export.md) 用于从表格生成独立数据库。

## Windows 验收

- 提供方源码 `d4acd309897466bdaba94cf93ad1f4bf76eaafd7`。Windows Worker 和普通权限原生适配器 40 项逐一通过，包括多页读取与空页、两个 CSV 的逐字节对照、视图和虚拟表拒绝、64/65 项目录边界。原生浏览器既有 25 项和表格生成 SQLite 既有 9 项通过。[提供方 PR #37](https://github.com/ax2/zi-devtools/pull/37)
- 冻结包 8 件、1,071,676 字节，目录索引 SHA-256 `2fb9c440ec4288fd07f3c9935cd03c4ba28b9eae6e6d7ff3bdfcb81648c808f6`，WASM SHA-256 `ccc46ca96623d9c18c2819f58b53f7c47d636db8c4f39c391c72598e6888267c`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/sqlite-browser-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/sqlite-browser-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 使用真实工具中心、Host 和 Worker。明确分享数据库后可读目录和第 2、3 页。取消保存无文件，确认保存第 3 页得到 375 字节 CSV。独立只读 SQLite 查询核对 CSV 的 16 行，包括 33–48 号记录、中文、表情及空值。重启后保存文件和源数据库的摘要均一致，挂起的读取授权可撤销并清空结果。重新进入工具可按次授权再次读取。
- 首装和重启回执 SHA-256 分别为 `37b4bf652323c5b8155edc5b534144ae4a10fe530a727bdf646426aa3273bae6`、`f7b848a21dd64b913238d17f2831a6bc440b3b4a56d36eff990d5a469c0f7050`。原生系统选取与自选保存位置留集中验收。
