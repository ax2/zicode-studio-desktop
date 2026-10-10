# 聊天收件箱扩展 Pi 导入兼容工作日志（2026-10-01）

## 目标与发现

可选聊天收件箱扩展的打包产物保留了对旧 `@mariozechner/pi-coding-agent` 和 `@mariozechner/pi-tui` 的实际运行时导入；当前锁定的 Pi 0.84.2 文档与包名为 `@earendil-works/*`。扩展内的 `types.ts` 还指向不存在的 `src/core/`，两个同级源码文件错误地从上级导入 `types.js`。esbuild 会擦除类型导入，因此此前构建成功不能证明类型路径正确。

## 修改与决策

- 聊天扩展中的 Pi 类型及实际函数导入改为当前 `@earendil-works` 包名，与锁定运行时文档保持一致。
- 类型出口指向实际 `core/` 目录，日志和运行时模块改为引用同级 `types.js`。
- 处理可选 bot ID/用户名时先确认字符串，避免异常配置值进入正则转义函数。
- 继续按现有构建规则把 Pi API 保留为运行时外部模块；不把整套 Pi SDK 复制到聊天扩展 bundle。

## 验证与遗留

`bun run build:extensions`、`bun run check`、目标目录 Biome lint 与差异空白检查均退出 0；生成的 `pi-chat.mjs` 只保留当前 Pi 包名。根 `tsconfig.json` 仍因内嵌 Pi 缺少 `dist/index.d.ts` 以及其他类型错误失败，不能称完整扩展类型检查通过。本轮未运行测试；Pi 实际加载聊天扩展、Feishu/WeCom 配置和三平台行为仍待验收。
