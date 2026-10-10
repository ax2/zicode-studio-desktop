# 普通工具取消：Studio Host 接口需求草案

2026-10-10。状态：Host候选已实现，验证记录见下文；界面和生产EXE尚未接入，不是已发布协议。旧普通工具invoke没有调用身份，使用局部AtomicBool(false)；资源型cancel绑定runtime/session/resource调用，不能直接复用。单独中断fetch不证明Worker停止。DevTools包无需改变或依赖Studio运行环境。

## 目标与边界

- 覆盖工具中心显式执行的普通Worker/WASI调用，复用现有Worker取消/回收能力及审计。Pi、资源调用身份保持各自隔离。
- 新增可信桌面内部schemaVersion=1扩展；插件iframe/远程连接不能调用。通过Host功能声明探测启用按钮，旧Host不能显示可取消。
- 每次执行由Host生成UUID callId，绑定完整sceneId/workspaceId/pluginId/capabilityId、当前目录revision、输入摘要和captureResult。不要把调用ID当执行/写入授权，执行依然检查版本/权限/schema。
- 作用域错误、重复ID不同输入、旧实例/过期调用不能取消其他工作；使用JSON完整元组哈希键，防止分隔符碰撞。限制活动数、ID长度和结束记录数/TTL，避免无限缓存。

## 必需交互语义

1. invoke在调度前登记调用，执行仍放在阻塞工作线程且不持有registry/broker长锁。begin冲突明确返回错误。
2. cancel使用同一完整作用域及callId。允许撤权/禁用后取消已存在调用，但不能创建执行授权。
3. 处理cancel先于invoke登记的竞态：要么采用Host prepare→start令牌握手，要么有界预取消墓碑，不能误报取消成功后继续执行；实现前固定其中一种并记录版本语义。
4. 区分cancel_requested、already_finished、not_found/expired；请求取消不等于Worker已退出。仅原invoke终态/Host查询证明回收后显示“已取消”。取消太晚时展示真实成功结果，记录真实成功recent，避免假取消。
5. 取消生效的调用不捕获可复用结果、不记录成功recent、不缓存为成功响应；保留失败审计（无输入明文），允许新的调用ID重试。
6. 取消失败时保留“仍在运行”状态及重试取消入口，不开放并发重跑。关闭工具页/整个中心必须说明执行状态，不以组件卸载/AbortController代表取消。
7. 不可中断的内建同步动作明确“不支持取消”；不能用视觉状态隐瞒仍在运行的写入动作。

## 验收门禁

- 真实交付Worker长调用：用户取消→原invoke返回worker_cancelled→PID回收/管道关闭→同工具新ID成功；同时另一插件与Studio目录/主界面继续响应。
- HTTP提前取消竞态、重复取消、结束后取消、跨workspace/scene/plugin/capability/桌面凭据拒绝；注册表/权限变化后仍可取消自身原调用。
- 资源/Pi相同callId不能碰撞；并发上限与墓碑TTL/数量边界检查。
- 取消/失败不写recent，晚取消成功如实写recent；不保存部分结果或清除别的工具输入。
- Windows实际截图和进程证据；其他OS分别验证。单元测试或fetch abort不能替代原生回收验收。

## Host候选进展（2026-10-10）

选择Host prepare→invoke握手，具体请求/状态/预算见[候选说明](manual-tool-call-v1.md)。4项新测试（含真实HTTP/既有生产Worker）及3项原生命周期回归通过；最终check/clippy通过，仓库既有fmt漂移仅报告，未批量改写其他工作。真实进程测试覆盖提前取消不启动Worker、重复取消、结束后取消、跨工作区拒绝、禁用后取消、重复执行拒绝及另一个插件恢复，3个Worker均回收/关闭管道。单次取消12ms、目录+独立插件122ms，不作为性能基准。

尚未实现前端取消状态/关闭页面交互，尚未更新生产EXE；原生按钮截图、WASI、其他OS、同工具成功重试、权限撤销与卸载场景、晚取消成功的界面recent语义仍待独立验收。当前验证不替代以上完整门禁。


## 2026-10-10 可信界面取消接入补充

manual.tool.call.v1现已接入工具中心：Host能力探测、prepare UUID、执行、取消ACK与实际终态分开、不确定状态查询、旧Host回退。切换应用保留工具中心及执行，busy禁止关闭/重复执行；取消不写最近，迟到成功保留真实结果。当前Windows debug EXE/真实WebView/Studio夹具验证取消后新调用恢复、输入结果保留及recent21→22；95项定向测试通过。详见manual-tool-call-v1.md及技术博客iterations/manual-tool-cancel-ui-2026-10-10/work-log.md。历史Host-only条目保留其当时验证范围。

本轮不修改DevTools；154项逐工具接受仍0。WASI/其他OS、运行中原生关闭、状态过期后的安全恢复入口、独立分发目录和全部源工具scope仍待验；夹具不支持result capture，不能代替结果接力/保存验收。


## 2026-10-10 普通调用状态恢复源码候选

新增[manual.tool.reconcile.v1](manual-call-reconciliation-v1.md)，prepare保存原Host实例身份，call-status明确unavailable后才允许可信前端请求恢复。prepared在同一锁下封闭，active仅请求取消且不作为终态，已退休句柄在同Host不能再启动；跨Host或离线保持锁定，不自动重放、不推断业务成功/失败，也不写成功recent。无需DevTools改造。

103项前端/8项Rust（含真实HTTP+保留生产Worker）通过，3/3 Worker回收及管道关闭。初次真实HTTP启动观察超时、最终审计worker_timeout保留；同配置重验通过，不提高预算。TTL推进仅测试中进行。新生产EXE/原生截图、WASI及其他OS未验；154逐工具接受仍0。证据技术博客iterations/manual-call-recovery-2026-10-10/work-log.md。此前取消界面实机证据不能代替本扩展原生验收。


## 2026-10-10 状态恢复Windows原生补验

后续已用当前debug EXE b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a/0.1.0实际验证：目录发现/按需加载Studio夹具→真实Worker成功但测试网络侧丢弃响应→锁定且recent不变→生产60秒TTL自然过期→原Host身份恢复证明→解锁并提示核对，无自动重放→主动新UUID调用成功展示→recent22→23且收藏不变。原生浅色1442×931截图已检查。源/运行目录五项资源摘要匹配，无ZIP/新全运行副本；正常关闭后10采样自有进程剩余0，临时夹具2文件1029B已清除。

这是故障注入与Studio合成guest验收，不代替真实写入事故、跨Host旧进程结束、WASI/其他OS、全部DevTools工具算法或独立分发目录；原首次启动超时仍待诊断。154完整接受仍0。详见manual-call-reconciliation-v1.md和技术博客iterations/manual-call-recovery-native-2026-10-10/work-log.md。
