# ZiDevTools 修订逐项缺口清单（2026-10-18）

## 目标与发现

在接收不可变目录修订后，把 154 个源工具的候选交付、未覆盖范围和重开条件逐项列成当前修订清单，避免旧 dev.105 矩阵被误当作新修订现状。提供方 `package-map.json` 有 32 行 `pluginStatus=candidate`，但其中 `spring-actuator` 没有本修订的包操作映射；只有 31 个不同源 ID 在六包中有具体映射。

## 修改

- 新增 `scripts/render-devtools-catalog-gaps.mjs`，先调用 Studio 已有的逐文件与语义校验器，再从冻结 `package-map.json` 生成 154 行逐项缺口文档。`--check` 可检出文档漂移，不写文件。
- 新增[逐项缺口清单](../plugins/devtools-catalog-revision-gaps-2026-10-18.md)：保留提供方原始 `uncoveredScope`，列出版本、状态、六包映射及按迁移类别区分的提供方/Studio 重开条件。单列 Spring Actuator 的“候选标签但本修订未映射”。
- 向提供方目录交付需求增加这处精确接口差异；不改 ZiDevTools 或冻结夹具，也不自动启用 JSON 对象插件。
- 已把 Spring Actuator 的包/范围/收据问题发送到获授权的 `zi-devtools` 原会话；该会话后续交付仍需 Studio 独立核验。

## 验证与局限

生成前会再次核对 11/11 文件、目录索引、修订摘要与 154 项 ID。脚本校验每项都有未覆盖说明、没有重复 ID，且本修订的包操作映射数量仍为 31，候选标签孤项仍是 Spring Actuator。`--write` 与 `--check` 均通过；目录校验定向 4/4、Node 语法、Biome lint 与 `git diff --check` 通过。测试前后空间预算扫描 `UnknownEntries=0`，E: 可用字节分别为 101,847,040 和 102,227,968；低空间建议性退出 1，卷可用量变化不归因于单个步骤。此检查仅验证“文档忠实复现冻结提供方声明”，不证明声明的算法、完整 scope、签名或真实运行。无界面改动、无截图、无 Rust 构建或发布；DevTools 完整接受数仍为 **0/154**，ZiFile **0/108**。
