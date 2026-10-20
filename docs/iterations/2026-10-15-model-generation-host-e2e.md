# 模型生成结果的 Host 接力验收（2026-10-15）

## 目标

把 DevTools 模型辅助候选的生成输出纳入 Studio 通用结果体系，确认模型请求与后续工作区写入都要由用户单独确认，并用真实 Host HTTP 路由验证边界。

## 实现

- 在 `src-tauri/src/host_server/plugin_services.rs` 新增隔离子进程测试，避免修改 Cargo 测试进程的全局 `~/.zicode` 路径。
- 测试按 Studio 模型目录接口生成不透明 `modelRef`，并把请求限制在本地合成 OpenAI-compatible endpoint；断言目录不泄漏 endpoint。
- 第一次生成授权以 `confirmed:false` 提交并被拒绝；第二次仅在确认后请求模型，Host 返回文本并捕获短期 `resultRef`。
- 通过现有结果保存预览接口读回相同文本；未确认提交被拒绝，确认后创建隔离 workspace artifact。
- 修复测试夹具 scratch 根在父/子测试进程间未共用的问题；使用父进程创建的项目内根路径供隔离子进程运行，成功后由父进程移除。
- 更新插件协议说明，修正“模型生成服务结果尚未进入父页面结果目录”的过期描述。

## 验证

- 端到端专项：`cargo test --manifest-path src-tauri/Cargo.toml model_generation_result_is_captured_and_save_requires_confirmation -- --nocapture`，初次及 scratch 路径修正后通过。随后同一专项扩展了在途取消路由、ACK/终态、TCP连接关闭及无结果引用断言；最终集成代码下 1 passed、0 failed，详见[模型取消记录](2026-10-15-model-generation-cancellation.md)。使用本地合成服务，无真实模型凭据或外部网络访问。
- scratch 路径修正后的测试源另经 `cargo check --manifest-path src-tauri/Cargo.toml --tests` 退出 0。通过后的夹具目录由父测试进程删除；没有新建重复测试目录。
- `rustfmt --check` 能解析文件，但报告文件已有的模块导入顺序及 `model_ref` 格式差异；本轮未格式化整文件，以免改动无关代码。
- 构建前后只读磁盘审计完整。端到端重跑后 target 45,752,087,951 B；task-scratch 745,636,956 B；E 盘余量 10,147,893,248 B（约 9.45 GiB），低于项目 20 GiB 预留线；脚本退出 1 是卷空间告警，扫描完整且无未知项。与运行前相比卷余量减少约 3.9 GiB，但同时受其他卷活动影响，不全部归因于测试。没有清理缓存。
- 第一次通过的测试遗留 `.cache/task-scratch/model-generation-http-8a276874-56b9-4abf-8bf8-c38748396ed8`，76,457 B / 14 个文件。其 owner 标记为本测试成功后删除；PowerShell 清理请求遭策略拒绝。按仓库规则没有用其他工具重试，路径保留供手工处理。新测试夹具交接已修正，后续运行由父进程清理共享根目录。

## 状态与遗留

- 已实现：Studio Host 捕获模型结果引用并让受信父页面复用结果保存功能；Host HTTP 专项证明模型调用同意和产物写入同意是两次独立确认。
- 已验证：首次专项执行通过；修正后的最终测试代码编译检查通过。
- 已验证：最终 Host HTTP 专项覆盖模型调用与写入的分次确认、结果捕获、取消路由 ACK、原调用终态、真实本地 TCP 连接关闭和取消后不产生结果引用。View Host 的停用取消也有定向前端回归。
- 待验收：真实 DevTools View 在原生 WebView2 中使用 AbortSignal、用户已配置模型、向真实 WASI 工具接力/保存全流程、DevTools 全量 154 项、ZiFile 108 项及 macOS/Linux 原生 UI。
- 磁盘空间策略目前禁止为释放空间清空 useful Cargo target。8 份旧本地运行目录约 6.68 GiB 仍按此前审批规则列为手工候选，见 `docs/iterations/2026-10-15-project-cleanup-review.md`。
- 应用版本保持 0.4.2；未发布版本、未创建 ZIP。
