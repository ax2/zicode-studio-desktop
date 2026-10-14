# 文档与数据库输出类型候选

2026-10-14。Studio 的内部 `resource.wasi.output.draft1` 追加四种输出类型，服务于 DevTools 的 CSV、Markdown、HTML 和 SQLite 交付。Worker 的既有 MIME 索引 0–22 不变，新索引依次为 23–26。类型声明只确定保存后缀和有限预览方式，**不检验文件内容、执行 HTML/SQL，也不代表 DevTools 实包或完整工具已接入**。

索引 5–26 的使用现需由插件清单声明 [resource.output.types.v1 预览版](resource-output-types-profile.md)；Host 在登记资源前拒绝未协商的扩展类型。原有 0–4 类型保持兼容。

| 索引 | MIME | 固定保存后缀 | 可信预览 |
| ---: | --- | --- | --- |
| 23 | `text/csv` | `.csv` | 最多 128 KiB 严格 UTF-8 文字 |
| 24 | `text/markdown` | `.md` | 最多 128 KiB 严格 UTF-8 文字 |
| 25 | `text/html` | `.html` | 最多 128 KiB 严格 UTF-8 文字，不渲染 |
| 26 | `application/x-zicode-sqlite` | `.sqlite` | 最多 8 MiB 读取并核对哈希，只展示前 256 字节十六进制 |

输出仍受每次最多四项、合计 32 MiB、SHA-256 校验、来源授权、确认保存及项目文件库无覆盖规则约束。下载一律用 `application/octet-stream` 和生成的附件文件名；页面没有 iframe、`innerHTML` 或可执行预览。扩展名来自 Host 固定白名单，不接受插件指定保存路径或文件名。跨工具接力仍需接收方授权和用户确认。

2026-10-14 原生 Worker 后续验收：Studio 自制 WASI 生产者通过实际 HTTP Host 输出 HTML 与 SQLite；两项分别在未确认时拒绝保存、确认后按固定后缀保存并出现在项目文件库。新增独立 WASI 接收插件后，Host 对每项输出均先生成接力预览；未确认提交被拒，确认后接收方读取并逐字节核对原始内容，返回对应结果。完整专项 1/1 通过，结构化收据见技术博客 `iterations/typed-output-transfer-2026-10-14/native-receipt.json`。此项证明两种类型在 Studio 当前 Windows debug EXE 的受控跨插件传递，不证明提供方算法、原生 UI 或其他系统。

提供方若要声明这些类型，须交付版本化插件包及正反例：CSV 的编码/列结构，Markdown 的安全渲染范围，HTML 的静态交付与资源引用边界，SQLite 的文件完整性/事务与只读检查。Studio 后续还需提供方各能力实际 Worker→Host→页面→保存或接力的证据及跨平台验收。在此之前 DevTools 154 项完整接受仍为 0。
