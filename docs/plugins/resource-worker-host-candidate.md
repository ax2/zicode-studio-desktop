# 可信父窗资源计算接口候选 draft.1

日期：2026-10-09。仅 Studio 内部候选；尚未发布 resource.v1，也不允许提供方据此宣称完整兼容。Worker 承载使用 `resource.wasi.input.draft2`，ABI 见 [快照帧](resource-worker-input-snapshot.md)。

2026-10-10源码补充：[资源计算授权生命周期](resource-worker-lifecycle.md)增加资源/权限/插件/凭据/模块/实例失效的主动取消监视；下文“尚不自动取消”描述保留其2026-10-09时点范围。新验证以技术博客iterations/resource-worker-lifecycle-2026-10-10的终态记录为准，不替代原生界面/图片算法或完整resource.v1验收。

## 调用与身份

三个接口均为 POST，必须使用可信桌面父窗的 `x-zicode-desktop-token`。隔离插件、Pi Bearer 凭据不能直接获得此权限。父窗必须从实际运行上下文构造 owner，不接受插件自行指定另一实例。

`/v2/plugin-resources/invoke-view` 接受严格对象：

```json
{
  "access": {
    "schemaVersion": 1,
    "owner": {
      "runtimeId": "实际运行实例",
      "sessionId": "实际当前会话",
      "pluginId": "插件标识",
      "capabilityId": "能力标识"
    },
    "resourceId": "已确认资源 UUID",
    "contentVersion": "资源版本"
  },
  "toolCallId": "本次调用 UUID",
  "input": {}
}
```

未知字段拒绝；请求体最多128KiB，只含引用和参数，不含路径或原始资源。当前一次调用只消费一个已确认资源；底层帧支持最多四项不代表此接口已提供多资源调用。

插件必须启用、授权 `resource.read`、具有目标能力和严格输入 schema，且 `runtime.resourceInputProfile` 明确等于 `resource.wasi.input.draft2`，入口是 WASI。它是候选声明，非公共 manifest profile。Host 自行导出运行身份、凭据代次、包/能力/权限/模块摘要证明，不能用客户端 owner 或摘要代替授权。

成功返回 schemaVersion、operationId、source（pluginId/packageVersion/capabilityId/contentVersion/profile）和有界 JSON result。输出目前不登记为资源，不提供二进制输出、自动接力或保存权限。

## 并发、快照与取消

每 Host 最多三项实际资源计算、同一插件最多两项，无等待队列，满载429 `resource_worker_busy`。配额在复制前取得，保留至实际 Worker 和管道清理结束；HTTP 等待方断开不释放配额也不自动取消。模块最多2MiB、资源最多32MiB；这些是字节预算，不是父子进程合计内存的硬上限。变更记录见[Worker 并发隔离](worker-isolation-budget.md)。

注册表锁只用于取得模块与声明；长计算不持有注册表或 Broker 锁。模块/材料快照绑定授权与版本，执行前后复核；授权变化或资源撤销时不返回旧结果。复制后的字节无法收回。当前撤权、停止、更新尚不自动发出 Worker 取消信号；五秒执行预算和返回前复核不能当作完整生命周期验收。

`/v2/plugin-resources/cancel-view` 接受 `{schemaVersion:1,owner,toolCallId}`。当前活跃实例经校验后沿用不变启动身份作为内部调用键，可在资源/权限撤销后请求取消。停止实例拒绝。响应 status 为 pending/requested/finished，并含 executionFinished；requested 不等于进程已经回收，也不表示写入回滚。UUID 不可重用为新的计算。

Worker 使用已有有界传输：五秒执行预算、256MiB guest 线性内存、2MiB 栈、1000万 fuel、1MiB stdout、64KiB stderr。进程回收或管道清理失败返回固定错误码；响应不得暴露原始子进程错误、路径或凭据。格式/身份失败可返回400/403/409，输入 schema 拒绝 `invalid_parameters`，取消 `worker_cancelled`，授权变化 `resource_authorization_changed`。

## 临时审计

`/v2/plugin-resources/worker-audit-view` 无参数，返回 `{schemaVersion:1,persistent:false,maxRecords:128,records:[...]}`。内存中只保留最近128次实际执行完成记录：operationId、pluginId、packageVersion、capabilityId、durationMs、ok 和固定 errorCode。拒绝在启动前的调用不一定进入执行审计。没有磁盘日志、原输入、输出、路径或凭据；应用退出即清空，不能声称持久审计已完成。

## 验收边界

### 隔离View SDK候选

新增 `zicode.resources.invoke({capabilityId,resourceId,contentVersion,toolCallId,input})` 与 `zicode.resources.cancel(toolCallId)`。toolCallId由调用方为每次操作生成新UUID并保留至取消；调用中最多两项，重复活动ID拒绝。插件不能传owner、路径、schema覆盖或额外字段。父窗从真实当前View导出插件/运行实例/会话，调用结束后复核View仍连接且上下文不变，返回有限来源字段及JSON结果；不会调用既有text结果保存/接力动作。

SDK和父窗分别为取消保留最多两个独立请求名额，避免32项普通等待占满后无法请求取消。取消仅针对此View登记的活动调用；返回requested不是执行已结束。View销毁会以原调用身份请求取消，传输失败也会请求取消；这是尽力请求，不代表停止/撤权全生命周期已实现。当前gateway每次请求采用独立AbortController与30秒上限，Host实际计算仍限五秒。资源权限及参数schema以Host实时判断为准。

前端普通专项覆盖身份伪造、输入预算、并发与取消、销毁/上下文变化后旧结果丢弃、来源复核、错误脱敏和gateway路由。真实Chromium opaque iframe→SDK→父窗→实际gateway→受控HTTP接口→结果展示、取消错误与下一调用恢复通过；桌面1440×900和窄屏390×844截图已检查，pageerror零，取消刻意409产生一项预期console error。Browser plugin未提供，复用已有Playwright。此浏览器专项使用受控服务，不是实际Studio Host/Worker或DevTools算法；不能把它与上一节独立的真实Host专项合并宣称完整原生链路验收。

源码门槛411通过、16项环境测试忽略，严格 Clippy 通过。环境专项另行显式通过1项：真实 HTTP Host + 更新后的 Studio EXE + Studio自有WASI验收包，已确认300,000字节输入执行、未确认拒绝、schema/桌面鉴权、两项满载429、断开仍持配额、满载时bootstrap响应和目录/Broker锁释放、取消PID29884存活/回收/管道结束、后续恢复、撤权拒绝与撤销后取消、内存审计均通过。取消位于测试观察器控制的Worker启动阶段，不是算法指令级中断证据。首次专项因bootstrap漏必填query失败，失败日志保留；补正后成功。

证据在技术博客 `iterations/host-resource-worker-invoke-2026-10-09/actual-host-resource-result.json`、`actual-host-resource-corrected.log` 和 `source-evidence-routes.json`。Host运行实例为测试内存登记；该专项不覆盖实际Pi进程、插件界面或DevTools算法，也不是冻结Windows交付。

SDK候选已接线并通过独立浏览器桥接验证，下节进一步记录同次Windows原生输入执行展示。仍需Pi直接资源工具调用、原生运行中取消、真实DevTools资源消费包及图片算法、多资源输入、输出schema/二进制结果登记与预览、接力确认、保存、完整生命周期及其他OS验收；全部154工具的完整验收计数不因该通用底层接口改变。

### Windows同次原生补充验收

后续在既有专属isolated-profile复用当前EXE（SHA256 `635078339c28806587c932bf58cd3cbed725073694c075a66a12725a3821be8c`）完成实际Tauri WebView→SDK→可信父窗→Host→WASI Worker→界面展示。插件为Studio自有WAT契约验收包，预置到专属profile的developer目录后由Studio发现，再通过实际管理页启用/授权；不是本地安装选择器验收或DevTools算法实包。

当前原生运行实例由嵌入pi.exe实际子进程提供，调用绑定实际正式会话。确认前未上传且执行按钮禁用；300,000字节材料分五块上传，明确确认后Worker读取尾部`resource`并显示JSON结果。撤销资源后同一SDK调用被Host拒绝；管理页拒绝resource.read时返回permission_denied，重新允许并选择/确认新材料后计算恢复。正常流程pageerror/console error/warning均零，刻意撤销调用产生一项预期409 console error。1440×900 CSS、1800×1125实际像素浅色截图已打开检查，可信标题/确认区及结果无重叠或裁切。

证据：同阶段 `native-compute-result.json`、`native-compute-permission-result.json`、`native-compute-success.png`、`native-compute-regrant.png`。未使用HTTP代理或替换SDK/Host/Worker；CDP设置实际WebView文件控件，不证明物理OS文件对话框。此补充关闭了“同次原生资源输入执行展示”缺口，仍未证明原生运行中取消、Pi工具直接资源调用、真实图片算法、二进制输出与接力保存、完整生命周期、其他OS或新冻结Windows交付。全部154完整工具验收仍0，resource.v1仍未发布。
