# DevTools / ZiFile 全量范围防漏核对（2026-10-15）

## 目标

为跨会话插件接入工作建立自动范围不变量，确保后续接入或阻塞状态变化时，不会因机器清单、手工矩阵和阻塞说明漂移而静默漏掉工具。

## 修改

- 扩展 `scripts/devtools-pi-evidence.test.js`：校验 DevTools 机器矩阵有 154 个唯一源工具；状态计数吻合；`devtools-all-tools-matrix.md` 与 `devtools-blocked-tools.md` 都逐项对应同一批 154 个工具；每行都有理由、责任方、解除条件和完整验收状态。
- 新增 `scripts/zifile-scope.test.js`：遍历 ZiFile 全部 108 个格式操作，校验唯一性、未接受状态、提供方声明差异和每个阻塞 ID 对应的责任方/原因。
- 未修改 DevTools 仓库、冻结候选包、已有验收状态或用户运行数据。

## 验证

- `bunx vitest run scripts/devtools-pi-evidence.test.js scripts/zifile-scope.test.js`：2 个测试文件、5 项通过。
- `bunx biome check scripts/devtools-pi-evidence.test.js scripts/zifile-scope.test.js`：通过，无自动修复。
- `git diff --check`：通过；出现的仅为 Git 行尾格式提示。
- 范围审计仍为 DevTools 154 项/完整接受 0，ZiFile 108 项/接受 0。此次是范围与文档一致性核对，不是算法、签名包、运行时或跨平台接入验收。

## 遗留

DevTools 仍需交付完整版本化插件和逐操作向量，Studio 才能逐项开展真实运行验收。ZiFile 仍需解决受约束原生归档运行、内容资源授权、事件/分页及原子写入协议。详细阶段记录同步于技术博客项目档案 `iterations/plugin-scope-coverage-2026-10-15/work-log.md`。
