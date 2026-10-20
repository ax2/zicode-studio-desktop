# DevTools 7d0c 不可变目录修订接收（2026-10-18）

## 目标与来源

Studio 只读接收 DevTools 新交付的 `devtools-catalog-2026-10-18-7d0c6461b1a64c19`，解决此前三份修订中 Text 七项操作的迁移表/包映射收据引用不一致。提供方与 Studio 继续保持独立；本轮未修改 DevTools、安装或启用候选，也未更改插件权限。用户决定暂不启用的 JSON Object 仍禁用。

## 修改与独立核验

- 从提供方交付目录按原字节复制 11 个文件及外置收据到新的 `tests/fixtures/devtools-catalog-2026-10-18-7d0c6461b1a64c19/`；旧 `3c7c...` 冻结夹具保留不变。Studio 重新计算逐文件、目录索引和语义映射：11 文件、2,110,242 逻辑字节，修订 SHA-256 `7d0c6461b1a64c19fa12e7938de92d3bc6f14a9f6f7a14c2b62e3bc4d82488f8`，目录索引 `matched`。
- 154 个源工具 ID 与迁移、包映射一致；状态为已实现 92、进行中 35、计划 27。六个无签名包映射到 31 个不同源工具；六包合计 53 项 manifest 能力。六包的实际文件清单、版本、提供方收据摘要和目录索引均匹配。Text 0.4.1 七项操作现均引用所属包的修订收据，空引用为 0。
- `scripts/render-devtools-catalog-gaps.mjs` 新增显式 `--revision`，从已验证的新夹具生成[154 项逐项缺口文档](../plugins/devtools-catalog-revision-gaps-devtools-catalog-2026-10-18-7d0c6461b1a64c19.md)。历史缺口文档和默认检查继续保留，不将提供方当前活动文件覆盖旧快照。

## 仍未完成

Diagnostics 0.1.3 宣称 `output.schema.v1`，但能力级缺 `outputSchema` 和 `maxResultBytes`，Studio 静态预检报 `declared_without_output_contract`。Diagnostics 11、JSON Object 2、Trace 2、Transforms 23 合计 38 项能力缺 `tool.directory.v1` 发现元数据。`spring-actuator` 虽有候选标签，本批六包仍无它的操作映射。没有正式签名 `.zicode-plugin`；所有候选仍需安装/权限/Host/Worker/Pi、真实界面、结果接力及跨平台的独立验收。上述具体接口需求已回传获授权的 DevTools 原会话。

本轮不重建或发布 Windows EXE，不生成 ZIP；没有把六包的清单匹配计作完整工具接入。DevTools 完整接受 **0/154**，ZiFile **0/108**。

## 验证

- `node scripts/verify-devtools-catalog-revision.mjs <Studio冻结目录> <外置收据>` 退出 0，11/11 文件及语义通过。
- `node scripts/audit-devtools-catalog-candidates.mjs --provider-root E:\zi-devtools --catalog-directory <7d0c目录> --catalog-receipt <外置收据>` 退出 0，六包逐文件对账；该命令明确传入提供方路径，仅用于只读接收，不构成运行依赖。
- 新修订的缺口文档 `--check --revision ...` 以及旧修订默认 `--check` 均退出 0；Node 语法、Biome 对生成脚本检查通过。
- 测试/生成前只读空间扫描：`target` 22,547,558,533 逻辑字节、53,195 文件、未知条目 0；E: 空闲 9,910,149,120 字节，低于建议储备线。未清理有用缓存。
- 收尾只读扫描的 `target` 仍为 22,547,558,533 逻辑字节、53,195 文件、未知条目 0；E: 空闲 9,798,643,712 字节。卷空闲变化可能来自其他并发活动，不能归因于本轮 2.1 MB 目录夹具。预算扫描建议性退出 1；项目内 `target/release` 仍未找到，本轮没有重建或删除。
