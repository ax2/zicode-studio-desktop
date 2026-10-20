# 插件成功文本结果保存：Host候选协议1

显式声明 `result.json.v1` 的新 WASI 能力可保存对象值和 `application/json` 成果；条件、预算与尚未完成的真实提供方验收见[结构化结果候选协议](result-json-profile.md)。未声明的能力继续使用本文的文本 v1 路径。

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

2026-10-16 增加仅可信桌面可调用的 `POST /v2/plugin-results/save-status`：`{scope,grantId}`，返回 `schemaVersion:1`、`status:saved|unknown`；只有精确匹配工作区、场景、插件、能力及保存 grant 摘要的有效持久成果才返回 `artifactId`。响应不含成果正文。Host 把 grant 的 SHA-256 摘要写入 provenance，不写入可用于提交的原始 grant。再次提交同一有效 grant 时先检查持久成果，若内存回执丢失则返回原成果及 `replayed:true`。`unknown` 表示**没有找到可验证成果**，不能证明未写入；父页面不会因它自动重试提交。原有旧成果没有此摘要，不能通过新接口恢复。

2026-10-17 的真实 Host HTTP 测试还覆盖了 Host 实例关闭、从同一隔离目录新建实例后的只读状态查询：新实例从持久成果恢复同一个 `artifactId`，旧内存 grant 不能再次提交，成果数量仍为一。随后由独立的操作系统子进程打开同一目录并重复上述 HTTP 查询与防重写检查，测试验证子测试实际运行。原写入进程在子进程查询时仍存活，测试没有模拟写入进程崩溃、提交时掉电或磁盘写入中断；这些边界及原生界面中的恢复提示仍待验收。

2026-10-17 的大目录核查发现成果库普通列表在按场景过滤前只遍历前 4,001 个文件项，不能用它判定旧保存回执是否不存在。保存回执查询现单独遍历该工作区全部成果元数据，按精确作用域与 grant 摘要匹配后再调用成果正文完整性检查；未读完目录或遇到损坏的元数据时返回错误，不把不完整扫描解释为 `unknown`。普通成果列表的界面限额保持不变。超过原列表窗口的定向存储测试及原 HTTP 保存测试通过；极大工作区的交互延迟仍需实测。

## 限额和错误

每个结果最多64KiB UTF8；内存最多64结果、累计2MiB文本，最多64保存凭据。结果15分钟、凭据2分钟有效，访问时清理过期项；不淘汰未过期结果来隐藏超限。Host重启清除全部暂存和凭据，已确认保存的成果保留。

桌面授权失败403；result_not_successful_text、result_budget_exceeded、result_grant_budget_exceeded、result_unavailable、result_grant_unavailable、result_source_unavailable、result_source_integrity、result_source_changed、result_profile_unsupported、result_workspace_invalid、result_title_invalid、result_confirmation_required返回409。工作区必须是有效UUID；成果库权限失败403；存储错误沿用成果库状态。错误不包含文本、输入或凭据。

待验收：完整原生外壳的预览/确认/取消、目标切换与窗口生命周期、保存重启后实际界面展示、独立二插件结果发送及跨平台交付。最小接收页面已验证部分交互；不得将它或Host HTTP和内存单测替代上述验收。

## 可信父页面接入（2026-10-08）
Studio 的 plugin-view-host 已请求可选 captureResult 并在 iframe 外提供保存标题、预览、确认与取消。插件仍只收到原 result，resultRef/grantId 不经 postMessage 暴露。
新执行清除旧预览；异步调用序号使旧结果不能覆盖新结果；切换工作区、停用或销毁 View 会清除保存界面，迟到预览不呈现。写入响应不确定时，父页面保留结果、阻止本页重复提交，并提供只读状态检查；即使检查仍为 `unknown` 也不自动重试。用户已经点击确认并发出的请求可能完成，切换工作区不会撤销已授权的写入。

2026-10-17：写入回执丢失或格式无效时，可信父页面会自动执行一次已有的只读 `save-status` 查询。若返回有效的 `saved` 回执，展示已验证成果，并仍要求用户明确点击后才打开；若返回 `unknown`、无效回执或查询失败，保留人工复查按钮及不确定提示，不发起第二次写入。工作区或结果切换后的迟到查询不得改变当前界面。

工具中心的 React 包装层现在也转发可选的 `saveStatus`，使用实际网关实例的方法绑定，避免脱离实例后访问不到 Host 请求方法。无该方法的旧网关仍维持不确定提示；有该方法的本机工具中心会调用与插件 View 共用的只读恢复流程。组件验证不能替代真实原生故障回执验收。
真实 Chrome 验收：五项原能力链路、JSON 结果 capture/preview、取消零落盘、确认后读取精确文本、390x844 预览、工作区切换零新增交付物、停用插件拒绝。父页面文本用 textContent，未解析输出为 HTML。
边界：仅最小接收页面+真实 Host/WASI Worker 已验证；派生接收包已验证跨包文本发送，不能代表独立第二提供方验收。完整 Tauri 主界面、模型自主保存及其他 OS 尚未验收。此前交付 EXE 不包含本新增 Host API；本阶段的新构建及验收记录见技术博客档案iterations/plugin-result-delivery-2026-10-08，构建开始不等于交付完成。此扩展仍为候选，不可宣称 resource.v1 已支持。
