# 通用模型健康检查超时工作日志（2026-10-01）

## 目标与发现

模型渠道的连接测试在已有模型时会调用内嵌 Pi SDK 的 `session.prompt()`。QVeris 专用 HTTP 路径已有 30 秒中止；通用渠道没有自己的截止时间。前端 RPC 虽在 120 秒后超时，但模型请求可能继续运行，且无法给用户明确的超时健康状态。

## 修改与决策

- 通用渠道的短提示设置 30 秒截止时间；到时请求 Pi SDK 的 `session.abort()`，让本次健康检查返回超时失败，随后释放订阅和会话。
- 保留原有模型请求和健康状态写回路径。超时错误进入安全错误列表，并在设置页显示中文原因。
- `abort()` 是对进行中请求的中止请求；外部提供方是否立即停止计费须由实机和服务方行为验证，不能仅凭本地超时断言。

## 验证与遗留

`bun run typecheck`、`bun run typecheck:platform-core`、`bun run check`、`bun run build:extensions` 和 `bun run build:react` 退出 0。目标文件格式检查中的 `model-health-response.ts` 与 `public/i18n.js` 通过；`picot-config.ts`、`ConfigTab.tsx` 和 `hostErrors.ts` 有既有全文件格式差异。本轮未运行测试。真实慢服务、取消后状态、费用和三平台 Pi SDK 行为仍待验收。
