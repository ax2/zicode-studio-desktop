# Stage：DevTools 全工具目录和分类交付就绪度复核

日期：2026-10-17。仅在 Studio 写接收记录；对 `E:\zi-devtools` 作只读核对，未修改其代码、配置或包。

## 目标与证据

Studio 已有百项工具目录的按需加载、来源/分类/收藏/最近及分页，但用户需要跨插件按任务浏览。真实 Text→Trace 接力显示来源筛选 7→2；现有提供方包没有能力级分类。逐包解析 `plugin.json`：`inspect-0.1.1-candidate-01` schema1、0/8 分类；冻结 `devtools-text-dev57` schema1、0/5；冻结 `devtools-trace-candidate01` schema1、0/2。Studio 不从能力 ID 私自推断分类。`E:\zi-devtools\release\plugin-candidates` 递归只读扫描未发现 `.zicode-plugin`。

使用 Studio 的只读比较器显式比较提供方活动 `E:\zi-devtools\docs\tools.json`、当前矩阵与冻结 dev.105：活动目录 154 ID（无增删），状态分布 implemented 92、in-progress 32、planned 30；相对矩阵 69 项版本/状态变化，相对 dev.105 有 71 项版本/状态、65 项 scope、14 项 discovery 变化。活动文件 SHA-256 为 `6f6d65dda8a7849d8a528291955b2afa695e0f205b159f9bae9a9c3ced72183e`；提供方 HEAD `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`，`docs/tools.json` 与迁移清单均有未提交修改。这是时点观察，不是稳定交付或新的验收矩阵。

## 接口动作与边界

已向用户此前授权的 DevTools 原会话送达增量接口需求：下一份独立包按 [tool.directory.v1](../plugins/tool-directory-v1.md) 精确版本为实际能力逐项声明 `categoryId`、真实 description、中英文 aliases，保留能力 ID；同时交付版本化包、独立逐文件 SHA-256 收据与目录快照，部分 scope 明确标记。此前正式签名包请求仍有效。Studio 等包外路径与收据后按原样核对，再做 Host/Worker/Pi/原生界面验收；不修改冻结旧候选，也不把活动目录纳入运行依赖。

本轮只读审查和协调，没有构建、安装、运行插件、清理缓存或变更版本。DevTools 完整接受仍 0/154，ZiFile 0/108；macOS/Linux 与正式签名生命周期仍待。
