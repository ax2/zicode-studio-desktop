# Stage：插件短文本字段紧凑显示

日期：2026-10-17。仅修改 Studio 的通用工具输入界面；不修改 ZiDevTools 或 ZiFile 提供方包。

## 发现与修改

真实 Windows Debug 的 ZiDevTools 图片缩放候选把 `maxWidth`、`quality` 声明为 `type:string`、`maxLength:4/2`，通用表单此前把所有字符串都渲染为至少 6 行的大文本框。大量插件按需加载时，这类短参数挤占一屏，执行按钮离开视口。

现在明确声明 `maxLength <= 128` 的字符串使用默认一行、仍可垂直扩展的 `textarea`；未声明上限或较长的字符串仍默认 6 行。保持字符串类型、Unicode 码点长度校验、换行内容、用户确认资源和提交值不变；不根据字段名猜测数字或自动执行。目录工具与资源工具共用同一 `ManualToolInput`，因此同时受益。

## 验证证据

- `ManualToolInput.test.tsx` 和 `resource-inputs.test.tsx` 共 10/10 通过：短字段为一行、长字段为六行、短字段仍接受并传递换行值；资源表单的 `maxWidth`/`quality` 值仍以字符串提交。
- `bun run typecheck`、`bun run check`、`bun run build:react`、`bun run bundle-css`、`bun run build:local` 均成功。`bun run check` 保留仓库已有 145 warning、10 info 及 1 个生成 JS 样式提示。
- 复用原隔离配置与当前 0.4.2 Debug EXE（SHA-256 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`）。1442×931 浅色原生 WebView2 截图已目视检查：宽度和质量均为紧凑输入，格式、两字段及执行按钮同屏可读，无横向溢出。
- 同一窗口以已存在的 132 B、4×2 合成 PNG 经明确确认后输入 `png`/`2`/`85` 并执行；真实 Worker 返回 `ok:true`，输出 2×1、77 B PNG，界面显示“结果尚未保存”及预览/发送/保存入口。本轮未点击保存或写入。

## 边界与存储

提供方原 schema 要求 PNG 输出时也填写 JPEG 质量，本阶段没有改动提供方声明或输入协议。当前界面也没有自动填入提供方 schema 的默认值；后续可独立设计。原生截图为即时工具输出，未导出 screenshot payload。未验证 macOS/Linux 或完整 DevTools 154 项，正式接受计数不变。

构建/测试前后只读存储扫描：`target` 29,996,989,575 → 29,997,194,081 B；task-scratch 1,136,572,763 → 1,136,586,720 B；非 scratch `.cache` 355,458,670 B、site 29,644,753 B 不变，未知项 0。E 盘空闲 30,227,931,136 → 30,182,309,888 B，卷空闲差异不能全归因于本任务。复用原 `target/debug`、依赖和验收 profile，未生成 Release/ZIP 或根据容量阈值删除缓存。
