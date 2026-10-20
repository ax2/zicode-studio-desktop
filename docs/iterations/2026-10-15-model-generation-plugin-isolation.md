## 2026-10-15 模型生成授权的插件级撤权隔离

### 目标与发现

HTTP Host 服务已按插件隔离撤权；模型生成服务仍使用全局授权代数。停用、卸载或调整一个插件权限时，可能取消其他插件的模型请求。统一服务契约应让撤权边界与插件身份一致，同时保留全量重载时的全局失效。

### 修改

- `Grants` 改用插件级修订号，另保留全局 generation 供插件注册表重载；每条准备授权绑定插件修订号。
- 新增 `invalidate_plugin(plugin_id)`：只废止来源插件的待确认 grant 和活动操作，并取消该插件的运行中模型 HTTP future。
- Host 的插件启停、权限变更和卸载路径改用插件级撤权；完整注册表重载仍调用全局 `invalidate()`。
- 增加并发操作单测：撤销 A 会取消 A 的操作，B 的 token 与修订号保持不变，B 仍能正常完成生命周期。
- 更新模型服务预览，明确撤权范围及注册表重载例外。

### 验证

- `cargo test --manifest-path src-tauri/Cargo.toml host_server::plugin_services::model_generation::tests -- --nocapture`：4 passed，0 failed；覆盖插件隔离、owner/workspace 绑定、终态及输入边界。
- `bun run check:rust:static`：all-targets Cargo check 与 warnings-as-errors Clippy 通过；仓库 cargo fmt advisory 报告工作区格式漂移。单文件 `rustfmt --edition 2021` 已对本次 Rust 模块格式化。
- 构建/测试前后只读审计均完整，UnknownEntries=0。前：target 30,133,141,559 B / 78,074 files，task-scratch 747,858,111 B，E: free 44,612,128,768 B。后：target 28,714,048,337 B / 72,238 files，task-scratch 747,858,111 B，E: free 46,064,906,240 B。同期另有 Zi DevTools Release 编译；本会话没有删除任何文件，扫描差异的原因未确认，不归因于本次验证。缓存规模超过参考值但按策略保留。
- 机器矩阵仍为 DevTools 154 项 / 完整接受 0；此处是 Studio 撤权隔离的服务改进，不代表 DevTools 工具验收。

### 遗留


- 真实 DevTools View、签名提供方包、真实模型服务、WebView2 可见交互、其他操作系统和 DevTools 全量 154 项仍待验收。
## 2026-10-15 真实 Host 模型撤权隔离回归

### 新增证据

- 将真实 Host 测试放入独立的 `model_generation_revocation_host_tests.rs`，使用隔离 profile、两个独立安装的 fixture 插件和仅监听 `127.0.0.1` 的合成模型服务。
- 先为 A、B 准备模型授权，在提交前经 `/v2/plugins/permission` 撤销 A：A 的授权被 Host 拒绝为 `model_grant_unavailable`，B 已准备的授权仍可提交并成功生成。随后重新授权 A，再启动 A/B 两个并发请求并撤销 A。
- Host 测试确认 A 返回 `model_request_cancelled`，其模型服务端 TCP 连接关闭；B 在 A 被撤权后仍保持挂起，释放本地响应后成功返回结果。请求 prompt 也分别验证绑定到 A/B 插件身份。
- `cargo test --manifest-path src-tauri/Cargo.toml host_server::plugin_services::model_generation_revocation_host_tests::revoking_one_plugin_during_host_model_requests_preserves_the_other -- --nocapture`：1 passed，0 failed。
- `bun run check:rust:static`：all-targets Cargo check 与 warnings-as-errors Clippy 通过；仓库 cargo fmt advisory 仍报告工作区格式漂移，新增测试文件已单独 rustfmt。

### 空间和临时证据

- 前后扫描完整且 UnknownEntries=0。前：target 28,714,048,337 B / 72,238 files，task-scratch 747,858,111 B，E: free 61,239,595,008 B。后：target 28,712,179,543 B / 72,238 files，task-scratch 748,010,741 B，E: free 61,244,547,072 B。scratch 增量 152,630 B 与两次失败夹具目录合计大小一致；target 和卷余量变化原因不能仅凭扫描归因。
- 两次首次夹具尝试失败后保留了诊断目录，按审批策略没有清理：`E:\zicode-studio-desktop\.cache\task-scratch\model-revoke-host-9ee71e49-5ede-4f97-bb41-84ee05da411e`（76,812 B / 13 文件；先启用插件后授予必需权限）和 `E:\zicode-studio-desktop\.cache\task-scratch\model-revoke-host-acf9f13b-209a-47c3-9fba-f8a2a9a62779`（75,818 B / 11 文件；目录查询请求含未允许的 `workspaceId` 字段）。修正后的成功夹具由父测试进程在验证后移除。
- 没有清理 Cargo 缓存、其他缓存或旧目录。DevTools 矩阵仍是 154 项、完整接受 0；此测试是 Studio Host 服务隔离证据，不等于真实 DevTools 插件验收。

### 仍待验收

真实 DevTools View/签名提供方包、真实模型服务、WebView2 可见交互、macOS/Linux 原生运行，以及 154 项全目录逐项验收仍未完成。
### 2026-10-15 待确认授权撤权补测

- 将真实 Host 回归扩展为两个阶段：先准备插件 A/B 的授权但不提交，撤销 A 后确认 A 的授权提交返回 `model_grant_unavailable`，而 B 的待确认 grant 仍可提交并成功完成一次本机合成模型调用；随后重新授予并启用 A，再验证两个在途调用只取消 A、保留 B。
- 最终定向 Host 测试仍为 1 passed、0 failed；`bun run check:rust:static` 的全目标 check 和 warnings-as-errors Clippy 通过，仓库 fmt advisory 仍报告既有漂移。
- 本次测试前扫描：target 28,712,179,543 B / 72,238 files；task-scratch 748,010,741 B；E: free 61,205,766,144 B。测试后扫描完整且 UnknownEntries=0：target 28,711,448,811 B / 72,238 files；task-scratch 748,164,366 B；E: free 61,245,644,800 B。scratch 增量 153,625 B 与本次两次失败目录大小总和一致。target 和卷余量变化原因无法仅由本项目扫描归因；没有清理任何缓存。
- 两次补测夹具失败的目录保留作诊断证据：`E:\zicode-studio-desktop\.cache\task-scratch\model-revoke-host-3196b531-e670-4471-9f84-fbfd2e2af9b7`（76,813 B / 13 文件）和 `E:\zicode-studio-desktop\.cache\task-scratch\model-revoke-host-b721c2d0-51eb-4704-9b1e-44e01595a6e2`（76,812 B / 13 文件）；原因是权限撤销会停用插件，重授权限后还需显式重新启用。修正后最终测试通过，其自有 scratch 已由父测试进程按夹具规则移除。本轮未绕过审批清理这些失败记录。
- 机器矩阵仍是 154 项 / 完整接受 0；此证据仅验收 Studio 的待确认授权与在途请求隔离。