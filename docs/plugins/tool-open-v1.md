# tool.open.v1 插件 View 工具定位预览

状态：Studio 接收侧 `=1.0.0-preview.1`。用于从具体工具目录打开插件自有主视图中的对应工具。它只定位界面，不执行能力、不授予权限、不传入输入或结果。旧包仍打开应用首页并明确提示未支持精确定位。

## 清单和身份

schemaVersion 2 插件在 `requiredProfiles` 精确声明 `"tool.open.v1":"=1.0.0-preview.1"`，并提供至少一个 `location:"main"` 的 View 和至少一个已声明的 capability。Studio 只可请求同一插件 `contributes.capabilities[].id` 中的能力 ID；不接受任意操作名、路径、URL、选择器或脚本。Host 安装时校验 profile 版本和结构，WebView 轻量摘要只暴露布尔支持标志，不下发能力 Schema 或运行时路径。

提供方可先运行 `bun run check:plugin-manifest-profiles <plugin.json>` 获取只读提示：该预检检查 schemaVersion、精确 profile 版本、主 View 和非空能力列表。它随四平台 Developer platform 检查运行 Studio 自有合成清单样本；输出 `preflightOnly: true`、`hostAccepted: false`，正式接受仍以 Host 校验和真实运行证据为准。

```json
{
  "schemaVersion": 2,
  "requiredProfiles": { "tool.open.v1": "=1.0.0-preview.1" },
  "contributes": {
    "activities": [{ "id": "example.tools", "title": "Tools" }],
    "views": [{ "id": "example.main", "activity": "example.tools", "location": "main", "entry": "views/main.html" }],
    "capabilities": [{ "id": "format.json", "title": "Format JSON", "inputSchema": { "type": "object" } }]
  }
}
```

这只是定位扩展示意；实际插件仍必须满足完整清单、引擎、权限和执行合同。工具目录的 `pluginId` 与 `capabilityId` 来自 Host 已验证的当前条目，打开插件时由 Studio 再查当前注册表。禁用或客户端不可用的插件不能使用该入口。

## View 消息

Studio 打开主 View 后，向该帧现有 `zicode-plugin-view` 随机 channel 发送 `{type:"openTool",requestId,capabilityId}`。注入的 View SDK 可注册：

```js
const subscription = window.zicode.navigation.onOpenTool(async ({ capabilityId }) => {
  if (capabilityId !== "format.json") return "not_found";
  showFormatPanel();
  return "opened";
});
// View 销毁时可调用 subscription.dispose()。
```

回调须只切换/聚焦界面，不调用 `capabilities.invoke`、不写文件或启动服务。SDK 将回调结果以同 channel 的 `{type:"openToolResult",requestId,status}` 返回，status 仅允许 `opened`、`not_found`、`unsupported`。没有回调、回调异常或超时按 `unsupported` 返回。Studio 只接受当前 View 实例和请求 ID 的回执；旧帧、错误 ID 和跨场景/工作区消息不会完成当前定位。主 View 不确认时显示固定提示，不能声称已定位，也不自动重试或执行。

每个插件同时最多保留一条定位意图；后来的选择替换前一条。Studio 端 5 秒、View 端 4 秒预算。应用/工作区切换和 View 销毁会清除未完成意图；即使目标切换通知迟到，发送前及回执时仍核对当前场景/工作区/运行会话。请求绑定插件版本，更新后不会发送给旧 View 帧。定位回执不代表能力授权或实际执行成功。

工具目录转入应用时还要在异步应用切换**前后**核对同一场景、工作区和运行会话。若选择期间目标变化，提示重新加载工具详情，不向新目标的 View 发送旧目录项；应用可能已经完成普通导航，但不会执行工具或保留旧定位意图。

目录项的插件版本也随选择传给外壳，并在应用切换前后同当前注册表版本核对。若插件在目录仍显示旧条目时升级、回退或卸载，Studio 提示重新加载工具详情，不把旧能力 ID 定位到另一版本的 View。这里仅比较身份和版本；能力输入与执行仍以 Host 的当前授权及修订校验为准。

外部 View 在当前运行环境不可用时，Studio 立即拒绝直达并提示该环境限制，不建立等待中的定位请求。主 View 资源加载失败时，现有 View 错误面板显示加载原因并立即撤销定位请求；只有 View 已加载但没有确认定位时才等待定位超时提示。

工具目录的异步应用导航或 View 直达若意外抛出异常，Studio 在本次入口捕获并显示固定的本地化失败提示，不把插件异常原文展示给用户或交给未处理的事件 Promise。它不触发能力执行；其他工具仍可使用。此保护只覆盖该目录直达入口，不能代替所有应用导航或 Host/Worker 故障隔离验收。

## 提供方适配与验收

ZiDevTools 保留独立程序，只在其新版本插件包中声明该 profile、实现主 View SDK 回调，并给每个可从目录打开的能力提供稳定映射。冻结候选不得原地修改。提供方交付新包及独立收据、正例/未知 ID/慢回调样例；Studio 逐文件核验，再完成真实 Host 安装、工具目录点击、View 定位回执、撤权/卸载/切场景以及原生截图。没有声明本 profile 的现有包只打开首页，不计定位通过。此扩展不扩大 154 项工具的完整接受数。
