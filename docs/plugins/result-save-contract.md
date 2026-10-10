# 插件成功文本结果保存：Host候选协议1

2026-10-08，源码实现候选。已连接可信父页面确认流程，最小接收页面已通过真实Host/Worker浏览器验证；完整原生壳仍待验收。不属于已经交付的resource.v1或DevTools首批冻结契约。只供Studio可信桌面外壳调用，第三方iframe不得自行提交保存；不向Pi或远程设备开放。

## 调用与身份

现有POST /v2/plugin-capabilities/invoke新增可选captureResult:true，默认false保持兼容。仅桌面凭据可请求暂存。真实能力返回ok:true/data.text时，Host返回resultRef；业务失败、非文本或超限返回resultCaptureError，原result保留，不让暂存故障改变工具执行结果。

Host仅暂存实际调用输出，不提供客户端上传任意内容伪造来源的入口。当前只支持WASI成功文本。resultRef含schemaVersion:1、resultId、mimeType:text/plain、UTF8 byteLength、SHA256 contentVersion、packageVersion。独立toolVersion未声明时不推断。

来源证明包含当前manifest、输入schema、权限、模块字节摘要及注册表变更序号；调用前后复核。保存再检查当前来源，因此禁用、撤权、改包或配置变化后拒绝旧结果。配置撤回后再恢复也不会使旧凭据重新有效。当前采取保守全注册表变更失效策略，后续可细分到插件/场景。

## 预览与提交

POST /v2/plugin-results/prepare-save：{scope:{workspaceId,sceneId,pluginId,capabilityId},resultId,title}。未知字段拒绝。title非空且最多200字符。必须匹配结果原始作用域，并检查当前来源及成果库storage.plugin授权。

返回schemaVersion:1、grantId、expiresInSeconds:120、preview；预览包含原文本、标题、字节数、内容摘要、来源包版本、目标工作区/场景、operation:create_new_artifact。prepare只读源文件并创建内存凭据，不保存成果内容。

POST /v2/plugin-results/commit-save：{scope,grantId,confirmed:true}。外壳必须先展示上述预览并取得用户明确同意；confirmed布尔字段本身不是已经验证的用户交互证据。可信父页面已有预览、确认与取消，真实浏览器已验证确认落盘及取消零写入；该证据限定于最小接收页面，完整原生壳仍待验收。

提交实时复核作用域、来源证明和成果库授权，仅新建file类型的工具结果成果，不覆盖、删除、上传或任意路径写入。内容取自Host快照，客户端不能在提交时替换。provenance包含结果ID、能力、来源包版本、来源证明、内容摘要；不保存输入文本或凭据。

同凭据成功后重试返回相同artifact及replayed:true，避免重复写入；存储失败不消费凭据，可在有效期内重试。已保存成果继续由现有成果库持久化、读取和导出。文本发送到属于独立的[result-transfer候选协议](result-transfer-contract.md)；跨插件成果读取、覆写、删除和文件资源授权尚未加入本保存协议。

## 限额和错误

每个结果最多64KiB UTF8；内存最多64结果、累计2MiB文本，最多64保存凭据。结果15分钟、凭据2分钟有效，访问时清理过期项；不淘汰未过期结果来隐藏超限。Host重启清除全部暂存和凭据，已确认保存的成果保留。

桌面授权失败403；result_not_successful_text、result_budget_exceeded、result_grant_budget_exceeded、result_unavailable、result_grant_unavailable、result_source_unavailable、result_source_integrity、result_source_changed、result_profile_unsupported、result_workspace_invalid、result_title_invalid、result_confirmation_required返回409。工作区必须是有效UUID；成果库权限失败403；存储错误沿用成果库状态。错误不包含文本、输入或凭据。

待验收：完整原生外壳的预览/确认/取消、目标切换与窗口生命周期、保存重启后实际界面展示、独立二插件结果发送及跨平台交付。最小接收页面已验证部分交互；不得将它或Host HTTP和内存单测替代上述验收。

## 可信父页面接入（2026-10-08）
Studio 的 plugin-view-host 已请求可选 captureResult 并在 iframe 外提供保存标题、预览、确认与取消。插件仍只收到原 result，resultRef/grantId 不经 postMessage 暴露。
新执行清除旧预览；异步调用序号使旧结果不能覆盖新结果；切换工作区、停用或销毁 View 会清除保存界面，迟到预览不呈现。写入失败保留原 grant 供幂等重试。用户已经点击确认并发出的请求可能完成，切换工作区不会撤销已授权的写入。
真实 Chrome 验收：五项原能力链路、JSON 结果 capture/preview、取消零落盘、确认后读取精确文本、390x844 预览、工作区切换零新增交付物、停用插件拒绝。父页面文本用 textContent，未解析输出为 HTML。
边界：仅最小接收页面+真实 Host/WASI Worker 已验证；派生接收包已验证跨包文本发送，不能代表独立第二提供方验收。完整 Tauri 主界面、模型自主保存及其他 OS 尚未验收。此前交付 EXE 不包含本新增 Host API；本阶段的新构建及验收记录见技术博客档案iterations/plugin-result-delivery-2026-10-08，构建开始不等于交付完成。此扩展仍为候选，不可宣称 resource.v1 已支持。
