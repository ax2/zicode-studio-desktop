# Spring Actuator 后台任务与报告接口需求

状态：Studio 接口需求；尚未发布 Host 生命周期 profile，尚未实现任务操作处理器或验收。此文档根据 ZiDevTools 当前未提交目录快照中的 `spring-actuator` 1.1.1 范围整理，不改变冻结的 154 项接入矩阵。

Studio已另外形成通用 [`plugin.task.lifecycle.v1@1.0.0-preview.1` 合同草案](plugin-task-lifecycle-profile.md)，以统一 Host 任务身份、持久状态、恢复、取消和撤权边界。当前运行时已有内部 SQLite 状态存储和桌面任务中心的只读概览路由，但尚未实现或广告 View 可用的生命周期 profile；Spring Actuator 提案仍需与该合同对齐并提供可执行 conformance。

## 来源范围

提供方当前声明包含：

1. 用户显式选择基础地址后，读取固定的 Actuator `health`、`info`、`metrics` JSON；health 的 HTTP 503 是诊断结果，不是网络错误。不跟随重定向，不读取 `env` / `configprops`。
2. 异步运行状态进入 Studio 后台任务中心；任务列表显示通用摘要，详细报告仍在工作台查看。
3. 将 JSON 报告作为文件导出；报告包含工具版本和便携运行环境指纹。

Studio 当前 `service.http.get.v1 = 1.0.0-preview.1` 仅提供一次性、逐次确认的固定 HTTP GET。它不创建后台任务、不生成可恢复任务状态，也不授权插件写入本机文件，因此不足以承载 `spring-actuator` 1.1.1 全范围。

## 现有 Studio 任务能力的边界

当前“任务中心”界面由 `frontend/src/features/tasks/store.ts` 读取/写入 `read_super_agent_tasks` / `write_super_agent_tasks`，主要管理 Super Agent 工作流；不能让 DevTools 插件伪造或混写为 Agent 任务。Rust Host 目前只有 `model-generation` 和 `http-get` 两组插件服务路由；模型生成调用的操作 grant 与取消状态保存在运行时内存中，commit 返回终态结果，不是跨窗口/重启可恢复的通用任务 API。

因此 Studio 可复用任务中心界面和筛选交互，但底层要新增 Host 管理的插件任务记录与事件流，按 plugin ID、workspace 和 profile 版本隔离，并与 Super Agent 任务数据分开。不得复用 `super_agent_tasks` JSON blob，不得将模型生成任务包装成 Actuator 任务，也不得依赖插件 View 常驻来保存状态。支持任务跨重启恢复时，还要定义版本化记录、清理/保留策略及崩溃中断任务的终态恢复规则。

Studio 的通用 profile 草案现定义了 loopback Host 的 submit/snapshot/events/confirm/cancel 路由、可信父界面身份注入、16 KiB 请求上限、严格字段和稳定错误 envelope。插件任务只能调度由 Studio 注册且组合已声明版本化能力的操作处理器；该 profile 不开放后台执行任意插件代码。仍需把草案转为精确 JSON Schema/向量并实现 Host 持久任务服务，Spring Actuator 不得提前在 manifest 中声明支持。

## 提议的 Studio 边界

Studio 实现一个通用后台插件任务接口；提供方只声明操作与输入输出 schema，不能让插件管理自己的第二套任务数据库。

- 插件请求使用固定操作 ID、已验证的插件版本和受限参数。Host 从已认证 View 注入插件、工作区、运行时、会话、权限代次和 request ID；请求体不能自报这些身份，也不能携带路径、URL path/query、请求头或授权材料。
- 启动任务必须由用户显式操作触发。Host 生成 opaque `taskRef`，绑定插件、workspace、operation、permission generation 和一次性授权；其他插件或 workspace 不能查询、取消或接管该任务。
- 可恢复的有序事件至少区分 `queued`、`running`、`awaiting_confirmation`、`completed`、`failed`、`cancelled`，含单调递增序号。View 重开后以 Host 快照加游标补齐，不依赖浏览器常驻或插件自建轮询线程。View 只接收 opaque `taskRef` 和有界状态/摘要，不接收 `resultRef`、绝对路径或报告正文；结果动作由可信父页面/Host 管理。
- 取消响应区分“请求已接收”和“任务已结束”。用户撤权、插件禁用/卸载、工作区关闭或 Host 退出必须使任务停止并产生终态；不得继续发送 HTTP 或写结果，迟到事件不得覆盖终态。
- Actuator 网络阶段只可调用 `service.http.get.v1` 的固定三个 endpoint。每个实际请求仍由 Host 做 DNS/连接策略、单次用户确认、TLS 校验、响应预算和审计；后台任务权限不能扩大网络 grant，也不能把 `health` 503 映射成传输失败。
- 任务中心只显示有界的通用摘要、工具名和状态；不把响应正文、环境变量、凭据、任意 URL 或完整错误写进任务事件。完整诊断保留在工具工作台的受限结果中，并按插件/workspace 隔离。
- 报告先作为有界 JSON 结果交给 Studio 结果/资源管道。保存前显示文件名、类型、大小和目标位置，由用户确认后写入；插件不能直接打开本机路径或静默覆盖文件。保存冲突、撤权和失败须保留恢复信息。
- 环境指纹字段需明确列举并逐项最小化；可包含 OS family、architecture、运行时/工具版本，禁止用户名、主机名、完整路径、环境变量、稳定硬件 ID 和凭据。提供方需说明可选字段与脱敏规则。
- 跨平台支持按 Windows、macOS、Linux 分别声明和验收；一个平台通过不能推断其他平台已支持。

## 最低契约与 conformance 向量

提供方需在独立版保持原功能的基础上，交付版本化插件 manifest、完整 source scope 映射和可复现插件包。与 Studio 确认 Host profile 前，不得在 manifest 中声明未发布接口。

至少给出以下请求/事件/终态及反例向量：

| 场景 | 预期 Host 行为 |
| --- | --- |
| 未授权或从非用户操作启动 | 拒绝；不生成可消费任务，不发网络请求 |
| health 200 与 health 503 JSON | 均以已完成诊断结果呈现，保留 HTTP 状态 |
| info/metrics JSON | 限定 endpoint；按同一 HTTP profile 确认和预算执行 |
| 用户拒绝 endpoint 确认 | 任务进入明确拒绝/终态，不发网络请求 |
| DNS、TLS、非 JSON、超限、超时或网络错误 | 稳定错误码与脱敏摘要；详细错误不含敏感内容 |
| 连续事件、断线后恢复、重复游标 | 严格单调序号；无重复写入、状态回退或终态复活 |
| 取消发生于队列、DNS、HTTP、解析、报告生成和保存各阶段 | 最终终态可查询；不产生迟到副作用 |
| 任务运行时撤权、禁用、卸载或 workspace 关闭 | 只停止所属任务；其他插件任务不受影响 |
| 报告预览后拒绝、目标冲突、写入失败、重新打开恢复 | 未确认不写；冲突不覆盖；按 Host 恢复流程处理 |
| 指纹泄漏尝试、恶意错误字符串和过大正文 | Host 按 UTF-8 字节预算拒绝或脱敏；事件/报告不暴露本机身份 |

接收包后由 Studio 再验收插件发现、按需加载、真实 Pi→Host→View、任务列表呈现、用户确认、错误隔离、资源接力/保存，以及目标 OS 的权限与撤权行为。协议草案、provider 自测、模拟 Host 或仅 HTTP-only 子集都不能证明整个工具已接受。

## 责任与解除条件

- Studio：评审并版本化通用插件任务/结果 Host profile；实现身份绑定、授权、事件恢复、取消/撤权、隔离、报告预览与确认写入；逐 OS 做 Host conformance。
- ZiDevTools：逐项保持并映射 `spring-actuator` 1.1.1 来源范围；提供 manifest/View、固定 HTTP endpoint 和任务/报告操作 schema、正反例及包外摘要；独立版继续可用。
- 完整工具接受条件：双方冻结 profile 与 package/schema/version/fixtures；Studio 对所有来源操作及边界完成真实包和完整运行链验收。若先交 HTTP-only 能力，必须拆为明确子能力，完整 `spring-actuator` 仍不计接受。

## 提供方草案审查结果（2026-10-16，活动工作树）

只读观察到 `E:\zi-devtools\plugins\spring-actuator` 中有 manifest、catalog、HTTP schema、View 和后台任务 proposal；manifest 声明的 HTTP profile 与权限符合当前 Studio 合同，catalog 明确 `scopeComplete=false`、完整工具未交付。该目录未提交、没有正式 `.zicode-plugin` 和稳定 receipt，因此不是接收包或验收证据。

已把以下问题交回提供方，不批准/发布其任务 profile：任务和终态 schema 暴露 `resultRef` 给 View；请求 schema 未区分 View 参数与可信 Host envelope；事件缺少明确快照/事件分页和游标恢复契约；`terminal` event 与终态载荷的绑定不明确；monotonic-events 向量对象重复声明 `sequence` 键；catalog 引用的 `schemas/result-resource-proposal/README.md` 在观察目录中不存在。提供方需修订并重新给出完整包/收据，Studio 再逐项 conformance 验收。

### 后续只读复核

后续活动快照已修订上述多项：View task 事件不暴露 `resultRef`；README 规定 gateway 注入 owner；快照/事件回放与终态 schema 已补齐；缺失 README 和重复键夹具已补上。第二次复核仍发现需要在正式接口中收敛的边界：Host 必须验证/生成报告 provenance、应用版本和便携指纹，不能信任 View 重复提交的字段；报告需验证 endpoint 唯一性及计数/状态跨字段一致性；事件回放需明确 cursorError 与序号、终态的机器可验关系；HTTP origin 必须拒绝 userinfo/path/query/fragment，并明确 DNS 私网/链路本地/重绑定控制。

该候选仍是未提交源码目录（后续观察为31文件、56,119逻辑字节），没有 `.zicode-plugin`、稳定收据或 Studio Host profile。以上只是接口审查反馈，任务/报告能力未实现、未发布、未验收；冻结矩阵仍为0/154。详细审查和时间快照见 `docs/iterations/2026-10-16-devtools-actuator-task-interface.md`。

2026-10-16 更新观察：提供方继续修改后，候选为32文件、61,416逻辑字节；任务 cursorError、origin 限制和部分负例已补充，但仍是未提交、未打包草案。报告来源/时间/指纹必须 Host 绑定；报告端点数量、唯一性和状态需一致；事件回放字段与终态/序号关系仍需机器验证；origin 需要真实解析反例而不能仅依赖正则。Studio已反馈这些剩余事项。此更新不发布或接受任何新 profile，0/154不变。

最新只读快照再增至33文件、64,999逻辑字节。报告草案改为 Host 生成元数据，但新加的 `report.schema.json` 当前 JSON 语法解析失败；`report-facts.schema.json` 的 endpoint 条件仍未嵌到数组 item schema。报告端点唯一性和 summary 一致性还缺负向向量/可执行校验。初版 26 个 JSON 的解析通过属于旧快照，已被当前失败取代。包和收据仍缺失，Studio 不接受 profile，矩阵0/154。

继续复核时目录仍为33个文件，最新观测64,989字节。严格重复键解析发现26个 JSON 中有2个问题：`report.schema.json` 缺闭合大括号，`report-facts.schema.json` 在同一 checks schema 重复定义 `items`。这比前次记录新增了重复键发现；提供方已收到准确路径与修订建议。

提供方随后修复了 facts schema 的重复键和 item 条件层级。最新目录仍33个文件、65,113字节；重复键严格扫描现在仅报告 `report.schema.json` 的 JSON 语法错误。报告向量仍缺端点重复、摘要计数/health 不一致和不允许状态的反例；已继续反馈，未接受 profile，0/154。

最新观察到 event replay schema 已要求 `requestedAfterSequence` 和 `snapshotRequired`；候选共33文件、65,329字节。重复键严格扫描仍只有 `report.schema.json` 缺闭合大括号这一项失败。报告负向 vectors 未随之更新，插件包/收据未交付，仍未接受 profile。

后续候选增至35文件、73,797字节，并新增报告 conformance vectors 与任务 cursor vectors，包含端点重复、摘要不一致、非法 HTTP 状态和序号关系反例。仍没有运行这些向量的 schema 校验脚本；README 也尚未链接新报告向量文件。最新重复键感知解析仍只发现 `report.schema.json` 语法错误；未打包、未验收，0/154。

提供方随后新增 `scripts/verify-contract.py`，最新观察36文件、89,451字节；28个 JSON 严格解析通过，脚本运行通过并报告 5 个本地引用、10 个报告向量和 10 个 cursor 向量。但代码复核发现脚本定义的 `validate_json()` 没有在主流程调用，向量只经自定义校验，不能证明向量符合 JSON Schema。另发现 byte/count 的 Python `bool` 可被 `isinstance(x, int)` 接受。已反馈这些范围，验证器仍不作为 schema conformance 证据；无包、无收据、0/154。

后续提供方把自定义 schema evaluator 接入向量主流程，并修正了首次运行时选错 `report-facts` fragment schema 的问题。最新观察38文件、129,809字节；29个 JSON 严格重复键感知解析通过，候选 verifier 通过21个 schema parse、5个本地引用、10个 resource vectors、9个 custom schema vectors、10个 cursor vectors。该 verifier 标示为自定义子集，且无正式包/receipt；不能替代 Studio 运行验收，0/154不变。

## Current provider schema snapshot (2026-10-16 11:20 CST)

Read-only inventory found 40 files / 154,945 logical bytes under `E:\zi-devtools\plugins\spring-actuator`; Git reports the directory untracked, and it contains no `.zicode-plugin`. `plugin.json` declares only `service.http.get.v1@=1.0.0-preview.1`; catalog continues to set `scopeComplete=false` and `fullSourceToolDelivered=false`. The proposal README now maps submit/snapshot/events/confirm/cancel to the five Studio draft routes and explicitly preserves the capability/handler boundary.

Compared `confirm.request.schema.json` with Studio's current draft: it requires only `schemaVersion`, `taskRef`, `operationStepId` and `decision`; it does not carry the Host-generated one-use `confirmationId` bound to task, step, target and grant generation. Sent this exact gap to the authorized DevTools session with missing/expired/replay negative-vector requirements. This is a mutable provider worktree snapshot, not a stable receipt; Studio did not copy, import or execute it. Full acceptance remains 0/154.

### Follow-up after confirmation-binding feedback

A later read-only snapshot shows the provider has added required `confirmationId` to `confirm.request.schema.json`, documented that the Host creates it, and added negative vectors for expiry, task/step/target/permission-generation mismatch and replay. The candidate is now 41 files / 171,668 logical bytes, still untracked with no `.zicode-plugin` or receipt; manifest and catalog still correctly say HTTP-only and full source scope undelivered. The proposal change closes this specific schema gap but has not been verified by a completed provider run or Studio runtime conformance.

### 0.1.1 review-directory receipt audit

The provider produced `release/plugin-candidates/spring-actuator-0.1.1-candidate-01` and `spring-actuator-0.1.1-candidate-01-verification.json`. Receipt declares 42 files / 172,765 logical bytes, `sourceTreeDirty=true`, `taskProfileDeclared=false`, no signing key, and `packageSha256=null`; it explicitly says this is not an installable `.zicode-plugin` or Studio acceptance. Studio independently checked all 42 listed paths, byte lengths, SHA-256 hashes and exact file-set membership against the directory; all matched.

Receipt-reported provider checks include its custom contract/vector evaluator and View guards, but do not equal Studio's Draft 2020-12 or runtime conformance. The candidate includes `scripts/__pycache__/verify-contract.cpython-314.pyc` (37,273 bytes); requested the DevTools owner exclude generated Python bytecode from the candidate and regenerate the receipt. No candidate was copied, installed or run; full acceptance remains 0/154.
### 0.1.1 candidate-02 and standard schema receipt

The provider regenerated a clean review directory after the pyc finding: `release/plugin-candidates/spring-actuator-0.1.1-candidate-02`, 42 files / 130,016 logical bytes. Its receipt reports 22 Draft 2020-12 schemas, 21 schema vectors, 10 cursor vectors, 7 event vectors, 8 confirmation binding/expiry/replay vectors, 10 resource vectors, and View cases (success, decline, errors, input guards and canonical origins). Studio independently matched every receipt path, size and SHA-256 and the exact file set; all 42 match and no `.pyc` is listed.

The receipt still states `packageSha256=null`, unsigned review directory, not an installable `.zicode-plugin`, and not Studio accepted. Source tree is dirty, task profile remains undeclared, manifest declares only `service.http.get.v1`, and catalog full scope is false. Provider validation is candidate evidence only; Studio did not install or execute it. Full acceptance remains 0/154.
