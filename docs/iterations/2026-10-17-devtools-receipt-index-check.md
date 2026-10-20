# DevTools 外部收据目录索引复算（2026-10-17）

## 目标与决策

Studio 接收大量独立插件候选时，需要复用一条只读、无复制的完整性核对命令。检查现有仓库发现 `scripts/verify-devtools-package.mjs` 已覆盖外部收据、路径、普通文件、逐文件大小和 SHA-256；因此沿用该命令，不另造验证器。此轮增加对提供方**明确声明编码**的目录索引复算，同时保留旧收据兼容。

## 修改

当外部收据的 `directoryIndexEncoding` 明确为 SHA-256、UTF-8、按原顺序排列的 `files` JSON 数组、键顺序 `path,size,sha256`、紧凑逗号/冒号、非 ASCII 原样和无尾随换行时，接收端按这些规则独立序列化并重算 `directoryIndexSha256`；不匹配时拒绝。若仅有目录索引摘要而没有编码描述，结果标为 `encoding-unverified`，只保留逐文件完整性结论，绝不宣称索引已复算。没有索引摘要则标为 `absent`。验证输出仍明确 `signatureVerified:false`、`runtimeAccepted:false`、`fullToolAcceptance:false`。

## 验证

- `bun run vitest run scripts/verify-devtools-package.test.js`：32/32，通过正例、索引不匹配拒绝、未知编码不冒称及既有路径/链接/摘要负例。
- 两份改动脚本的 Biome check 通过。首次定向检查报 3 项格式问题，已仅格式化这两份脚本并复查通过。
- 真实提供方 Inspect 0.1.1 外部收据：606/606 文件、2,319,279 字节通过；收据 SHA-256 `911fee46bea37bf0078c84f852ddf15f43c08330d3c5079bc06b0119bed6b0b`，目录索引复算 `81488c9f1fc9a5d737efdb551b3aa59757053c5586baf304aaca324470cc75fa` 匹配。
- 兼容核对旧候选：Diagnostics 0.1.3 的 503 文件、4,287,534 字节和 Image Resize 0.1.1 的 7 文件、1,036,667 字节逐项通过；两份收据均未给索引编码，故结果为 `encoding-unverified`。没有运行提供方代码或 Studio Worker。
- 前后只读扫描完整：`target` 均为 29,423,948,875 逻辑字节，task-scratch 均为 932,850,915 字节；未复制候选、构建 EXE、生成 ZIP 或删除缓存。E 卷可用 36,087,525,376 → 36,353,015,808 字节，卷级变化不能归因于本轮。

## 遗留

目录收据只是可变外部目录的一次观察；运行前需重查。`encoding-unverified` 不等于目录索引摘要错误，也不应按已核验处理。正式提供方签名容器仍缺，DevTools 完整 154 工具接受保持 0/154；ZiFile 108 格不变。本轮无界面改动或截图、无版本发布。
