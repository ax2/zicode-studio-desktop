# 文档与数据库输出类型候选

2026-10-14。Studio 的内部 `resource.wasi.output.draft1` 追加四种输出类型，服务于 DevTools 的 CSV、Markdown、HTML 和 SQLite 交付。Worker 的既有 MIME 索引 0–22 不变，新索引依次为 23–26。类型声明只确定保存后缀和有限预览方式，**不检验文件内容、执行 HTML/SQL，也不代表 DevTools 实包或完整工具已接入**。

| 索引 | MIME | 固定保存后缀 | 可信预览 |
| ---: | --- | --- | --- |
| 23 | `text/csv` | `.csv` | 最多 128 KiB 严格 UTF-8 文字 |
| 24 | `text/markdown` | `.md` | 最多 128 KiB 严格 UTF-8 文字 |
| 25 | `text/html` | `.html` | 最多 128 KiB 严格 UTF-8 文字，不渲染 |
| 26 | `application/x-zicode-sqlite` | `.sqlite` | 最多 8 MiB 读取并核对哈希，只展示前 256 字节十六进制 |

输出仍受每次最多四项、合计 32 MiB、SHA-256 校验、来源授权、确认保存及项目文件库无覆盖规则约束。下载一律用 `application/octet-stream` 和生成的附件文件名；页面没有 iframe、`innerHTML` 或可执行预览。扩展名来自 Host 固定白名单，不接受插件指定保存路径或文件名。跨工具接力仍需接收方授权和用户确认。

提供方若要声明这些类型，须交付版本化插件包及正反例：CSV 的编码/列结构，Markdown 的安全渲染范围，HTML 的静态交付与资源引用边界，SQLite 的文件完整性/事务与只读检查。Studio 后续还需各能力实际 Worker→Host→页面→保存或接力的证据及跨平台验收。在此之前 DevTools 154 项完整接受仍为 0。
