# 插件模型生成在途取消（2026-10-15）

## 目标

补齐 `model.generate.v1` 在途取消。用户或插件 View 取消后，Studio 必须停止实际模型 HTTP 请求；取消确认只作为 ACK，不能代替任务终态。

## 实现

- 新增 Host 取消路由，操作由 Studio 父界面生成 UUID，并绑定 workspace、plugin、runtime 和 session。Host 限制活动操作数，准备操作与运行操作有独立过期时间；撤权时中断运行中的请求并废止未开始操作。
- 模型生成切换为 Rust 异步 reqwest 请求，保持超时、禁止重定向与 4 MiB 响应上限。取消令牌触发后 drop HTTP future/response stream，不将同步模型调用留在脱离 Host 生命周期的阻塞线程中。
- View SDK `models.generate(input, { signal })` 只在 iframe 内观察 AbortSignal，通过私有父子消息发出取消请求；取消请求使用独立 Host HTTP 调用。关闭 View 和切换工作区也请求取消。
- Host 取消 ACK 返回 `requested` 和 `executionFinished:false`；原生成响应返回 `model_request_cancelled` 才证明取消完成。取消与响应完成竞态时保留真实终态；仅成功结果进入 Host 结果目录。
- 模型目录将 `supportsCancellation` 改为 `true`。旧 View 不传 operationId 仍可生成，但不能在途中取消。DevTools 冻结包未修改，需后续在其 View 中使用 AbortSignal 并提供取消入口。

## 验证

- `bunx vitest run public/native/plugins/plugin-view-host.test.js public/native/plugins/plugin-capability-gateway.test.js`：2 个文件、35 项通过。
- `bun run check:rust:static`：全目标 Cargo check 与 warnings-as-errors Clippy 通过；Cargo 格式步骤为 advisory，报告工作区格式漂移，未对大文件整体重排。
- `cargo test --manifest-path src-tauri/Cargo.toml model_generation::tests -- --nocapture`：3 项通过，覆盖授权代数失效、调用方/工作区隔离、终态保留。
- `cargo test --manifest-path src-tauri/Cargo.toml cancellable_plugin_model_request_closes_an_in_flight_http_connection -- --nocapture`：本机 TCP 模型服务确认请求发出后取消，连接关闭且返回 `model_request_cancelled`，1 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml model_generation_result_is_captured_and_save_requires_confirmation -- --nocapture`：真实 Studio Host HTTP 专项通过，包含模型请求完成和结果保存确认，并启动第二次在途请求、调用真实 Host cancel 路由、核对 `requested` ACK、原生成返回 `model_request_cancelled`、无 resultRef、重复查询为 `finished`，本地模型服务观察到 TCP 连接关闭，1 项通过。
- Biome 对四个涉及 JS 文件的全文件检查报告 import 排序/格式问题；测试通过。没有运行自动全文件格式化，避免扩大与本次功能无关的改动。

## 边界与遗留

- 已验证：Host owner/workspace 约束、真实 Host HTTP 取消路由与终态、取消令牌与异步模型 HTTP future、真实本机 TCP 连接关闭、View Host 消息桥取消路径、取消不生成 resultRef、模型结果只在成功后交付。
- 待验收：DevTools 新版 View 内真实取消按钮与 AbortSignal、真实模型服务、WebView2 可见取消交互和截图、macOS/Linux 原生 UI、撤权与网络故障现场的完整 UI 终态。
- 取消响应的 ACK 本身不表示已停止；调用方必须等原生成调用的最终响应。
- DevTools 全部 154 项和 ZiFile 全部 108 项接受状态不因本功能变化。版本保持 0.4.2；未发布、未构建 release、未输出 ZIP。
- 前后复用同一项目 Cargo target；没有清理缓存或复制完整运行目录。只读空间审计：运行前 target 45,762,210,943 B / 82,033 文件，task-scratch 745,636,956 B，E 盘可用 17,485,987,840 B；最终 target 45,777,609,552 B（增加 15,398,609 B），task-scratch 不变，E 盘可用 14,575,247,360 B。扫描 `UnknownEntries=0`、卷查询成功；卷余量减少约 2.71 GiB，无法全部归因于项目。
- 随后补加真实 Host 在途取消测试并再次扫描：测试前 target 45,777,609,552 B、E 盘可用 14,574,235,648 B；测试后 target 45,772,369,391 B、task-scratch 仍 745,636,956 B、E 盘可用 10,850,279,424 B。没有切换 target 或运行 clean；卷余量减少约 3.47 GiB，逻辑 target 反而减少约 5 MiB，说明同期卷/存储变化无法归因于本次测试。扫描无未知项，未清理缓存。

## 2026-10-15 View 停用取消回归

- 补充 `plugin-view-host.test.js`：模型请求已进入 Host 执行后停用来源插件，宿主调用绑定该 workspace/runtime/session/plugin 的取消端点、旧 iframe 退出，并在原请求终止后结束为 `model_request_cancelled`。
- `bunx vitest run public/native/plugins/plugin-view-host.test.js`：14 项通过。
- `bunx biome lint public/native/plugins/plugin-view-host.test.js`：通过。`bunx biome check` 因该文件大量既有格式差异退出 1；没有自动重排其他测试。
- 测试前后只读空间扫描均完整、`UnknownEntries=0`；target 45,772,369,391 B、task-scratch 745,636,956 B 均未变化。E 盘可用空间从 7,818,854,400 B 降至 6,750,257,152 B，期间无其他Studio构建；变化无法归因该4秒前端测试。本轮未删除文件、未清理构建缓存。
- 此为Studio View生命周期回归证据，不是实际DevTools插件/原生WebView取消验收；DevTools fullToolsAccepted仍0/154。
