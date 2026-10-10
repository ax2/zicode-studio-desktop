# 工具界面故障后的普通调用恢复

后续[资源会话恢复](resource-session-recovery.md)已补齐资源DOM/控制器跨详情React故障保留及实际HTTP/WASI输出、保存取消与输入撤销验证；资源丢失响应的Host终态恢复协议仍未实现。本文资源runner未迁移的段落属于当时状态。

2026-10-10，Studio 独立前端实现，不更改提供方包、Host API 或应用版本。

## 实现

ManualToolSession 在单工具错误边界之外持有普通工具调用控制器。ManualToolDetailView 只呈现输入/结果；原 ManualToolDetail 保留独立入口供现有使用方和测试。目录按 scene/workspace/tool 身份建立会话。

详情渲染失败时不会卸载调用控制器，也不因视图故障自动取消或重新执行。错误卡片仍可请求取消、检查状态、返回目录；普通调用仍在运行或状态不明时，目录的关闭按钮保持禁用，窗口关闭警告仍有效。其他工具不受该错误边界影响。

迟到成功会结束运行锁，但已经卸载的详情不再呈现或保存结果、不新增最近使用；错误卡片提示结果不可用，用户应核对实际效果。明确取消响应才显示已取消；取消应答不代表已停止。查询、终态与退休证明仍遵循[终态证明](manual-call-terminal-proof.md)，不完整凭据不能解锁。没有自动重新加载工具或重试入口。

真正关闭/卸载会话仍沿用原 hook 的取消请求与迟到回复隔离；这不是应用重启或跨 Host 的持久运行账本。

## 验证

- 23 文件 110 项相关前端用例通过，其中 3 项新用例覆盖运行中实际渲染异常、迟到成功、显式取消、不确定状态和畸形凭据。既有目录故障隔离、其他工具输入保留及显式重开回归通过。
- check/React 构建通过；frontend typecheck 仍仅 HabitsApp.test.tsx:53 和 WatchApp.test.tsx:63 两处已有 mock 类型错误。
- Edge 实际加载生产 tool-center.js，使用模拟 Host：发放句柄执行→permissions 故障注入导致真实 React 异常→错误卡片仍能查状态→非法终态维持关闭锁→有效终态解锁且没有重试；另一轮故障后请求取消→明确 worker_cancelled 才解锁。
- 最终页面脚本错误 0，控制台仅两个预期且被错误边界捕获的 React 故障；无框架覆盖。桌面 1280×900 明亮、窄屏 390×844 night/明亮截图已实看，文字与按钮可读，无横向溢出。
- 初轮浏览器定位两个同名“工具目录”按钮造成脚本 strict mode 失败，过程证据保留；定位错误卡片内按钮后完整复验通过，未将初轮当作最终接受。

档案：C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/tool-session-recovery-2026-10-10/。

## 尚未覆盖

### 后续 Windows 原生补验（2026-10-10）

`iterations/tool-session-native-2026-10-10/` 已补齐当前 debug EXE、实际 Host、生产 JavaScript Worker 与原生 WebView 验证。EXE SHA256 `6c14d757c277b87040f7c98c592e4e8380368a0ef4536d4641f38a428844ba6b`，项目与实际服务的 tool-center.js SHA256 一致 `07e87ee8518741283a0e2594a328d562bf564d7298b01adeb6269aa29808025e`。没有构建新 EXE。

实际目录发现→按需详情→取得真实句柄并执行→仅渲染层故障注入→错误卡片显式取消→Host cancel_requested/executionFinished:false→原 invoke 返回 worker_cancelled→解除关闭锁。另一轮真实 Worker 返回成功，由验证路由丢弃响应；错误卡片保持锁，切换笔记返回仍保留，等待自然保留期 65,248ms 后 call-status 拒绝旧句柄，同 Host/原 callId 的 reconcile 返回 manual_call_retired，才解锁；没有自动 invoke/重开/伪造结果。仅两次用户主动 invoke。

最终原生 WebView 视口 1440×900、截图像素 1800×1125、明亮主题，三张取消/响应丢失/退休证明截图实际检查：提示、按钮及主界面可读，无框架覆盖。pageErrors=0；控制台 5 条均有对应证据：两次注入且被捕获的 React 异常、取消调用 HTTP409、主动丢弃响应 ERR_FAILED、退休状态查询 HTTP409。

前两次脚本分别因取消按钮中文定位错误、未等实际响应完成就断言失败，过程证据保留；末轮完整通过。诊断请求头已脱敏，不保留临时凭据或 Cookie，早期进程已退出且最终隔离 Host 已关闭。临时夹具摘要核对后删除 2 文件/1029B，仅移除本轮注册项，其余项保留；指定运行路径剩余进程 0。没有独立 Worker 管道观察器，不将其他阶段进程事件作为本轮证据。

这仅补齐普通 JavaScript 工具与 Studio 自有夹具；不是 DevTools 算法、WASI/resource、保存/接力、其他主题或操作系统接受。下文“真实 Host/Worker 故障专项、原生完整 WebView”待项在上述两条 Windows 注入场景范围内已补齐，其他故障模式仍待。

资源工具 ResourceToolRunner 仍有独立资源生命周期；其控制器尚未迁出错误边界，不将普通调用恢复泛化为资源工具接受。保存/接力操作出错后的恢复、跨窗口与重启运行账本、真实 Host/Worker 故障专项、原生完整 WebView 与其他 OS 尚待。全 154 项 DevTools 工具范围及完整接受数量不变。

本轮取消前未独立采样Worker PID，worker_cancelled仅作为真实执行路径取消终态证据；未验收特定已启动Worker的kill/管道事件。成功场景实际Worker业务输出另有验证，最终运行路径进程0是收尾快照。

