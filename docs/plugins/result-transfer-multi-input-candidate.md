# 多文本字段结果接力候选

日期：2026-10-09。标识：`zicode.studio.result-transfer/1.1-candidate`。当前源码候选已通过真实HTTP/Worker机制专项，实际桌面/Pi及生产发布仍待；不更改DevTools冻结compute.wasi.v1首批{text}协议，不代表提供方已有regex/diff插件。

## 请求和兼容

既有 `/v2/plugin-results/targets`、`prepare-transfer`、`commit-transfer` 路由保持。响应schemaVersion仍为1，新增可选字段；旧单字段请求不需要inputs，网关在inputs为空时省略它，兼容既有单字段Host。多字段请求只允许发给支持本候选的Host，旧Host会拒绝未知inputs，不能据旧EXE声称已支持。

目标搜索项新增 `requiredInputs: ["right"]`：这是选择left之后仍需用户明确提供的必填字段名。Host不发送完整schema、默认值、历史数据或另一个工具的私有输入。选择right时相应要求left。搜索结果只表示结构和源字段约束可映射，用户填写完毕后仍需完整输入校验。

```json
{"scope":{"workspaceId":"…","sceneId":"programming","pluginId":"source","capabilityId":"source.encode"},"resultId":"…","target":{"pluginId":"receiver","capabilityId":"compare.lines"},"field":"left","inputs":{"right":"另一侧文本"}}
```

prepare将源结果映射到left，inputs中只允许其余必填文本字段，不能包含left、额外字段或非字符串。preview返回源text/field及inputs完整快照。commit仍只有scope/grantId/confirmed，不能再提供或替换输入；Host使用grant固定的inputs并复核当前包、权限、scope、schema、时效与幂等状态。

## 有界支持范围

对象最多16个声明字段，字段名非空且最多128字节；可映射字段和所有必填字段必须是string；可选字段省略，不从schema默认值补齐。每段最多8192 UTF-8字节，最终合并JSON及实际guest请求（包括pluginId/sceneId/capabilityId/commandId/input外层、JSON转义）各最多48KiB。Host继续执行实际schema子集的类型、长度、enum/const等约束。数组/数值/嵌套必填参数暂不进入接力目标，不是永久不能支持。

该边界仅适用于本地WASI纯计算，不新增文件/网络/模型/写入权限。数据保存仍走独立预览确认流程。运行中取消、源工具多个输出映射、自动接收已存在的另一字段、非文本参数编辑与流式大数据尚待专门接口。

## 界面与验证

选择接收字段→填写其他必填文本→预览源字段及其余文本→确认执行。取消零提交。表单不自动填写其他内容。DOM使用textContent，输入中的HTML不会被解释。UI截图仍为真实源码模块+模拟网关，不能充作Tauri全链路证据。后续当前源码Host真实HTTP/Worker机制专项已通过，详见下节；旧不可变EXE未包含新Host映射改动，仅复用其通用WASI执行能力。

源模块mapping.rs新增纯映射正反例；前端专项验证确认/取消、分页/业务错误、补充字段传递及安全文本展示。完整Rust门禁和真实运行链路结论以技术博客multi-input-transfer-2026-10-09记录为准。


## 真实HTTP/Worker专项（2026-10-09）

证据：技术博客 `iterations/multi-input-http-2026-10-09`，当前源码测试Host配合固定e2e85f8f Worker EXE和Studio自有stdin回显guest。自有guest不是DevTools diff实现，提供方算法仍由原会话维护。

普通HTTP/映射6项通过；实际Worker专项1项通过2.12s，两次左右映射精确保持源结果和另一侧CRLF/中文。缺字段/覆盖源字段/非字符串/超字节拒绝；prepare/confirmed=false不启动Worker；两次replay返回相同resultRef且不额外执行。禁用接收插件后旧grant拒绝，独立Base64工具继续执行，artifact保存0。4启动/4管道关闭，4实际PID终态0，Host停止完成。

首轮自有manifest漏description被拒绝；次轮自有guest一次多iov写后stdout不是完整JSON。两失败保留；连续缓冲循环写修正后通过，未改变生产预算或DevTools。当前专项不证明真实Tauri多输入、Pi多参数、运行中取消、所有输入空间、签名生命周期或其他OS。完整普通门禁结果见本轮档案，不以专项替代。
