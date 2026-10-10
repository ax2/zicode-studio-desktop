# DevTools 诊断候选接口需求

请求编号：studio-diagnostics-candidate01-budget-2026-10-09。状态：待提供方回复，未发布为受支持profile。可携带机器清单见 [接口需求JSON](devtools-diagnostics-interface-request.json)。不要求提供方引用Studio仓库或读取本机路径。

## 需要提供方处理

| 能力 | 当前证据 | 需要交付 |
| --- | --- | --- |
| django.migrations | 固定合成样例1000万fuel耗尽 | 优化后的独立插件包、对应fixtures和摘要；或单独版本化预算提案 |
| celery.report | 固定合成样例1000万fuel耗尽 | 同上，不以Node功能通过代替fuel证据 |
| django.urls | 样例消耗9915761，剩余84239 | 覆盖声明输入范围的有效/对抗fixtures及预算证据 |
| 全部11项 | 9样例成功不能证明完整输入范围或源工具范围 | 所有operation的可携带合成输入、预期报告、逐项源功能覆盖/缺失说明 |

包固定版本0.1.0，模块SHA256 88c14b3357dda71b097ac6b66d211d2c5ded1526afc2dccf8758c6446ee751d1。每字段8192 UTF8字节，请求/完整结果各48KiB；需要边界/超限、多字节、未知操作/字段、无效报告和超大输出fixtures。不得使用真实用户诊断报告或敏感值作为交付样本。JSON中的compileMs是修复前调试源码环境的历史观察，不是新EXE或生产机器承诺。

## Studio继续承担

- 当前优化Worker的冷编译/五秒截止验证。保留现有1000万fuel、64MiB guest内存和2MiB guest栈；新8MiB原生执行线程用于可靠返回guest栈错误。
- 诊断扩展显式版本协商，旧Host拒绝不支持版本。确认精确schema/字节预算/业务错误枚举后才发布支持声明。
- 实際Host、Pi及原生View的发现、按需加载、执行、展示；权限、取消、失败后恢复、卸载/升级与结果接力保存分别验收。

本请求不将两项工具永久判为无法接入，也不删减全部154项目标。提供方可继续独立程序及插件构建；Studio只消费版本化包、公开契约与可携带证据。接口处理与最终Studio验收分开记录。


## 实际原生补充证据与界面需求

当前优化EXE/Windows原生实际11样例：9报告成功，迁移/Celery两次Host HTTP500固定worker_fuel_exhausted，输入保留且下一调用恢复。候选View catch统一显示宿主拒绝/异常/超时，无法让用户区分预算失败；需要Studio固定公开错误字段与提供方明确预算提示协同改造，禁止显示原始报告/解析器消息或堆栈。预算失败不应只提示反复重试。接口字段应先核对公开SDK能力，再固定版本与正反例。

后续新扩展包需要schema2、两个engine范围、requiredProfiles；当前诊断proposal未进入Host支持列表，原schema1测试不是正式协商。所有文件应由提供方独立输出，不要求Studio改签名内容。本轮没有修改DevTools。

Studio已提供[公开SDK错误字段规范](view-error-contract.md)：Error.code固定码可区分worker_fuel_exhausted、Worker超时/取消及客户端等待超时。实际提供方iframe已收到预算码并恢复。DevTools需按规范读取code并使用自己的固定中文文案，预算失败不只建议无条件重试，旧Host无code时保留通用回退。本会话不改提供方View，原候选UI仍是笼统catch。

## 2026-10-09 Pi与生命周期观察更新

实际嵌入Pi候选专项已覆盖11项发现/按需注册、9报告/2fuel。增强10阶段/55缓存拒绝覆盖全部11项；拒绝没有额外Worker，独立文本插件五次对照执行通过，重新启用/重装再授权发现加载与线程工具恢复通过。为源码Host/开发包专项，签名生命周期、GUI同次Pi、模型选工具、完整输入/源功能范围和其他OS仍待。接口请求仍open，两个预算问题/profile精确定义/所有边界fixtures未解决，不将候选接入观察当成正式profile支持。

已按用户此前协调授权向原会话zi-devtools发送明确要求并确认active；不新建会话或代理。提供方最新编辑器/元数据预算工作需保留；先核对其活跃构建再继续。消息发送或运行状态不等于新插件交付，收到新公开产物后由Studio独立验证。
