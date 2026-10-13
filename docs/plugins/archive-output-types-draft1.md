# 归档输出类型与受控保存 draft1

2026-10-14。Studio 的内部 `resource.wasi.output.draft1` 现在为 18 种归档格式提供固定输出类型。WASI guest 用 `zicode_resource_output_draft1.create` 的 MIME 索引选择类型；原有索引 0–4 保持不变，归档类型从 5 追加。此映射只决定经用户确认后保存/下载的扩展名，**不验证字节是否为该格式，也不代表 ZiFile 算法或完整插件接入**。

| 索引 | 类型后缀（接在 `application/x-zicode-archive-` 后） | 保存扩展名 |
| ---: | --- | --- |
| 5 | zip | `.zip` |
| 6 | sevenzip | `.7z` |
| 7 | tar | `.tar` |
| 8 | targzip | `.tar.gz` |
| 9 | tarzstd | `.tar.zst` |
| 10 | tarxz | `.tar.xz` |
| 11 | tarlzma | `.tar.lzma` |
| 12 | tarbzip2 | `.tar.bz2` |
| 13 | tarlz4 | `.tar.lz4` |
| 14 | gzip | `.gz` |
| 15 | zstandard | `.zst` |
| 16 | xz | `.xz` |
| 17 | lzma | `.lzma` |
| 18 | bzip2 | `.bz2` |
| 19 | lz4 | `.lz4` |
| 20 | brotli | `.br` |
| 21 | rar | `.rar` |
| 22 | cab | `.cab` |

完整 MIME 为 `application/x-zicode-archive-<类型后缀>`。RAR 仅占一个协议类型编号；提供方的 RAR 创建/读取范围与许可证问题仍按 [ZiFile 接入清单](zifile-integration-requirements.md)阻塞。旧的 `application/octet-stream` 继续保存为 `.bin`，绝不根据插件提交的路径或文件名决定目标。

Worker 每次最多四项、合计 32 MiB；Host 校验帧版本、长度、内容 SHA-256、已授权来源和输出类型后才登记临时资源。用户需再次确认，才在当前项目 `.zicode/outputs/<saveId>/` 用固定名称创建新文件与来源收据；不覆盖现有文件。项目文件库按收据核对扩展名、大小和内容哈希，重新分享给其他工具时仍需单独确认。页面只把归档字节显示为有限十六进制预览，下载前再次核对完整哈希。跨工具输出类型通过 `resource-input.schema.json` draft5 表达；提供方不能把这个内部候选写为已稳定支持的 `requiredProfiles`。

当前还没有 ZiFile 插件包、真实归档算法、超过 32 MiB 的流式输出、目标目录写入/覆盖/解压事务、归档内容格式探测或逐平台验收。ZiFile 108 格接受数保持 0。
