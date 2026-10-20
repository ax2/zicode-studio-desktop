# 通用工具结构化输入（2026-10-17）

## 目标与发现

工具目录已经支持搜索、分类、来源、收藏、最近使用和按需加载，
但通用表单只接受平面字符串/数值/布尔字段。Host 已能验证数组和对象的
受支持 `inputSchema` 子集；带这些字段的工具在目录中可发现，却只能依赖
提供方自带 View 执行。

## 修改

- 通用工具与资源输入表单对声明为 array/object 的字段显示 JSON 编辑框。
  字段未编辑时可选值不提交；必填值必须输入相应类型。
- 提交前限制 UTF-8 输入为 32 KiB，拒绝 JSON 语法错误、类型不符、
  重复对象键、负零及转成 JavaScript Number 时失去精度的数值；
  解析后的数组/对象原样交给既有一次性调用协议和 Host 校验。
- 仅为 Host 已实现的 schema 子集开放该编辑器；`pattern`、`format`、
  `$ref` 等仍不可通过通用表单。子字段的 required、范围、enum/const
  最终由 Host 在 Worker 启动前验证。
- 复用现有表单视觉组件和中英文提示。截图审查发现两个 8 行编辑框
  会把主按钮挤出首屏，改为默认 4 行并保留编辑框自身滚动。
- 工具目录旧用例改为用真正不支持的 `format` 检查拒绝分支；
  保存结果用例的旧空收据已不符合当前协议，改为有效收据。

## 验证

- `bun run typecheck`、`bun run check` 退出 0；后者保留既有非阻断告警。
- `bun run vitest run frontend/src/features/toolCenter`：21 文件、130/130 通过。
  首轮曾有旧断言和空保存收据夹具两项失败，修正后整组通过。
- `bun run build:react` 复用现有输出目录成功。
- 浏览器加载该构建中的 `mountResourceInputs` 组件，在默认桌面视口
  和 440×800 窄视口查看实际截图；文字、JSON 编辑框、必填提示和按钮
  均可见，按钮在调整高度后进入首屏。输入 `["alpha.txt","beta.txt"]`
  的 JSON 形式和 `{"dryRun":true}` 后，预览返回数组/对象类型保持成功。
  截图位于技术博客 `screenshots/structured-tool-input-2026-10-17/`。
- `bun run qa:locale` 未执行到检查：该脚本要求 workspaceId 和
  sessionId，本轮没有运行中的真实会话；不把 usage 错误算作验收通过。
- 仅供视觉检查的本地 HTTP 服务已停止，临时预览页与 owner 文件核对后
  精确移除，2 个截图留在技术档案。后置只读扫描完整、未知项 0：
  target 29,448,272,490 逻辑字节，task-scratch 939,345,906 逻辑字节，
  E 盘可用 31,012,630,528 字节。既有构建缓存和其他 scratch 均未清理；
  卷余量变化不能直接归因于本轮。

## 边界

截图来自实际前端组件的本地浏览器预览，不是原生 Studio 主界面截图。
尚无签名 Zi DevTools 包的真实 Host/Worker/Pi/原生 WebView 结构化输入链路；
也未验 macOS/Linux。通用编辑器不是完整 JSON Schema 表单生成器，
不提供资源选取或任意文件访问。DevTools 完整接受仍 0/154，ZiFile
仍 0/108。本轮未发布版本、未生成 ZIP，也未改提供方项目。
