# 手动工具调用的结束证明

2026-10-10，Studio 前端可靠性修正。沿用 manual.tool.call.v1 和 manual.tool.reconcile.v1，不增加提供方 API。

## 执行锁

Host 已发放调用句柄后，invoke 请求失败不代表后台执行结束。即使错误带有 manual_call_already_started、manual_calls_unavailable 或其他错误码，也保留句柄和运行锁，提供用户主动查询状态与取消入口。避免将代理故障、重复请求冲突或缺失响应误判为可以重新执行。

调用返回真实成功结果或明确 worker_cancelled 时沿用已有处理。其他失败等待有效 Host 状态；已结束但结果未收到时显示结果不可用，用户自行核对效果，再决定是否重新运行。终态确认不会自动再次执行，重新点击执行必须准备新的句柄。准备阶段尚未发放句柄的失败仍可重试。

## 状态校验

schemaVersion、profile、status 和 executionFinished 必须满足原协议；新增对 outcome 的完整性检查：

- prepared/running/cancel_requested 必须为 null。
- finished 必须为非空字符串，最多 128 个字符；未知但有效的错误码不会被当作成功。
- 缺失、null、空字符串、对象、数组、数字或超长终态结果均不能解除运行锁。
- 取消应答与退休凭据同样执行该检查。退休证明仍必须匹配原 Host 实例与 callId，且不能丢弃仍在等待的原始成功响应。

## 验证边界

新增用例修改前 10 失败；修改后工具中心、命令面板、共享 React 导出及资源 runner 共 107 用例通过。check 和 React 构建通过。前端 typecheck 仍仅报告 Habits/Watch 两处既有测试 mock 类型错误；另外一次根目录 typecheck 报告已有扩展域错误，日志完整保留，未声明全项目类型检查通过。

生产 tool-center.js 经 Edge 实际加载：带错误码失败→锁定执行/关闭→运行状态→畸形终态继续锁定→有效终态解锁且调用次数仍为 1→用户点击获取新句柄→第二次结果展示。页面及控制台错误均为 0。1280×900 明亮、390×844 night 主题截图已检查；首次脚本使用不支持的 dark 主题且截图发生在主题切换中间，保留过程证据，改为正式 night 主题并等待样式稳定后复验。

这是生产界面与可控 Host 响应模拟的浏览器验证，不是本轮真实 Host/Worker、原生 WebView、DevTools 算法或其他操作系统验收。完整档案：C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/manual-call-proof-2026-10-10/。

仍待处理：错误边界卸载后的句柄恢复、资源工具调用恢复、跨窗口运行记录、重新启动后的状态核对。154 项 DevTools 全目录范围及完整验收数量不变。
