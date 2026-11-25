# v0.7.9 · 表格另存 SQLite

在插件管理安装冻结候选并确认文件读取权限。在工具中心搜索「表格另存 SQLite」，选择一份 UTF-8 表格并确认共享。选 CSV、TSV 或 JSON，按需填写表名后执行。省略或清空表名时使用 data。检查行列后点击「预览保存」，确认把新的 SQLite 文件保存到当前 Studio 工作区。保存回执给出文件位置，可用 SQLite 单独打开。源文件保留。

CSV 和 TSV 按首行识别列名，保留文本中的前导零。JSON 接受对象数组和 headers/rows 表格，缺失字段为 NULL。整数、浮点和文本按原类型写入，布尔值转为 0 或 1，超出 i64 的无符号整数按十进制文本保存，数组和对象保留为 JSON 文本。

每次一份表格，输入最多 16 KiB、128 行、16 列。SQLite 文件最多 128 KiB，表名和列名最多 512 个 UTF-8 字节。空表头、重复列名和不规则表格会得到明确提示。源工具 data-sqlite-export 1.1.0 的大表、原生工作台筛选/选区、工作实例继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 525ed11a8137123926488318b7cc1f18b453dae1。原生适配器和真实 Worker 各通过 29 项，成功文件逐字节一致。独立 SQLite 只读重开，核对列名、单元格类型和值与完整性。独立版原导出测试 9/9。
- 冻结候选 8 件、1,051,230 字节。目录索引 SHA-256 edf7b238b14c30d7dc4d6f358701bfc3b6faddceda51223696905c3342fd2d36，WASM 44f67d958e548d18e84a2d15673c46cfb45b05474163f2b618d26c51d6f347a0。[候选目录](../../tests/fixtures/devtools-windows-file-tools/table-sqlite-0.1.0-candidate-02) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/table-sqlite-0.1.0-candidate-02-verification.json)
- Windows 隔离 Studio 实际选择并确认读取 CSV、TSV、JSON。先取消时无文件，然后明确确认保存三份 8,192 字节的 SQLite 文件，与独立版输出逐字节一致。清空 TSV 表名后读回默认 data，源文件保持。超列和非法 UTF-8 均未产生保存入口。
- 同一隔离资料重启后三份数据库保持，工具可重新按次授权执行。独立 SQLite 3.53.1 只读核对实际保存文件、行列与类型，三份完整性均为 ok。首装、重启、读回回执 SHA-256 分别为 2dc760dae1954f2d4d76cd49f1620254065df1fa41ec846eeb693864c3bf8b29、f8ba2e1305f0ac6b4c94be205a57c23eeba4ae8ced073fd3dc2393d90d87bdc4、0e55ec1fd721fcc92335411da74db985304bee481148dfdc2d9b2266e4c85177。系统选择任意保存位置的窗口留集中验收。
- 候选 01 清空表名后会被拒绝，候选 02 使用默认 data，并保留对纯空白与非法表名的拒绝。[提供方 PR #36](https://github.com/ax2/zi-devtools/pull/36)
