# DevTools 目录操作映射双向校验（2026-10-18）

## 目标与修改

Studio 接收方此前只验证 `package-map.json` 中每项操作能在同修订迁移表找到，未反向验证迁移表中已交付的候选操作是否被包映射遗漏。`scripts/verify-devtools-catalog-revision.mjs` 现在对有 `candidateDirectory` 的具体操作做双向核对，并拒绝同一源工具内重复的候选操作声明。错误包含源工具 ID 和操作 ID，便于提供方定位；已冻结的收据摘要仍原样验证。

迁移表还包含未交付工具的描述性范围，不能将这些范围强制映射到六个候选包。首次反向实现因此在历史 `timestamp` 描述性范围报 `migration_operation_unmapped:timestamp:undefined`；限定为实际声明候选目录的范围后，原冻结修订恢复通过。该失败记录说明了接收门槛的适用边界，未修改提供方源数据或冻结夹具。

## 验证

- 定向 Vitest 7/7 通过，包含映射收据不一致、迁移候选操作从包映射遗漏、重复候选操作三项拒绝用例。
- Biome 定向检查通过。
- 冻结 `3c7c5aa8ad679a14` 与提供方 `41ae80d96258362c` 均通过逐文件与语义核验，分别 11 文件、154 源 ID、六包、31 个候选源 ID。
- 提供方较新 `d7d61b707a89a366` 仍被拒绝，具体报 `package_map_operation_mismatch:json:devtools.text.json.format`；同修订其余六项 Text 收据字段不一致已在[上一轮记录](2026-10-18-devtools-catalog-revision-followup.md)列出并交 DevTools 原会话修复。

本轮没有接收新正式签名包、安装或启用 JSON Object，也没有执行原生 Host/Worker 或跨平台运行；DevTools 完整接受仍 **0/154**，ZiFile **0/108**。未创建第二份 Cargo 目标或完整应用运行目录。

前后只读空间扫描的 `target` 都是 22,547,558,533 逻辑字节、53,195 文件、未知条目 0；E: 空闲从 10,024,071,168 变为 10,021,134,336 字节。预算建议性退出 1，未清理缓存。Debug 主 EXE 仍在，SHA-256 `3C1B68AB17A6D7C658BA1181DAA1EF7129D065F584A2F6303C3E3A9D79E32976`；项目内未找到 `target/release`，本轮没有重建 Release。
