# Pi 插件目录严格 UTF-8 解码（2026-10-18）

## 目标与发现

通用 Pi 目录客户端原先通过 `Buffer.toString("utf8")` 解析 Host 的搜索/加载正文。遇到非法 UTF-8 字节时，Node 会替换为 U+FFFD；如果替换后的正文仍是合法 JSON，损坏的工具元数据可能进入目录。该边界与动态工具调用使用的严格解码不一致。

## 修改

`extensions/plugin-catalog-client.ts` 改用 `TextDecoder("utf-8", { fatal: true })`。非法字节经既有错误分支返回固定 `catalog_response_invalid`，不显示原始正文，也不改变目录分页、权限、截止、取消和按需加载协议。JSON Object 候选保持禁用，`pi.tools.register` 未改。

## 验证与遗留

- 新增非法 UTF-8 目录标题回归；`bun run vitest run extensions/plugin-catalog.test.ts` 为 12/12。
- `bun run typecheck:extensions-source` 与 `bun run check` 退出 0。全仓 lint 仍报告其他文件的 147 条 warning、10 条 info；设计检查有一条已有 inline-style warning。
- 本轮没有 Rust 构建、原生窗口或提供方正式签名包验收。客户端拒绝损坏正文不证明真实 Host 会产生该输入，也不提高 DevTools 154 项或 ZiFile 108 项的完整接受数。
- 测试前后只读预算扫描：`target` 均为 30,041,815,353 逻辑字节、`.cache/task-scratch` 均为 1,411,021,038 逻辑字节、未知项均为 0；E: 可用从 9,453,568 到 8,327,168 字节。两次扫描均因低空间建议退出 1；卷余量变化不直接归因于本轮，没有清理此前被拒绝的目录。

## 发布

无版本号变更、无发布产物。
