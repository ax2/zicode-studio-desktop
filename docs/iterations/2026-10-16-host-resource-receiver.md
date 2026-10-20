# Host Resource Receiver Preview

Date: 2026-10-16  
Scope: ZiCode Studio Desktop only. ZiDevTools source and packages were not modified.

## Goal

Remove the identified gap where the resource transfer directory could discover only WASI receivers, while keeping the receiver behind Studio's Host, permissions and explicit user actions.

## Findings

- The transfer dialog queried `resourceOnly`, but filtered results to `runtime === "wasi"`.
- The Host transfer target check required `resource.wasi.input.draft2` and a WASI module.
- The result-call executor also required a WASI module snapshot, so a built-in Host capability could not consume a confirmed resource.
- A manifest profile by itself must not authorize a new Host handler. This preview therefore uses a fixed built-in plugin/capability allowlist.

## Changes

- Added the versioned `resource.host.input.v1` compatibility requirement and `resource.host.image-input.v1` runtime profile.
- Added `com.zicode.resource-inspector/image.inspect`, visible only in resource receiver searches; ordinary Pi tool discovery does not expose it.
- Added a cross-platform in-memory PNG/JPEG/WebP metadata decoder with a 20 MiB input limit, 20,000-pixel side limit and 256 MiB decode-allocation limit.
- Extended target proof, transfer revalidation, resource call execution and UI response-profile checks for the one allowlisted built-in receiver. WASI package execution remains on its existing path.
- The receiver returns metadata only and writes no files. Sharing confirmation and execution remain separate actions.
- Added [the Host Resource Input Profile contract](../plugins/host-resource-input-profile.md) and updated [tool result interoperability](../plugins/tool-result-interoperability.md).

## Validation

- `bun run check` exited 0. Biome reported 144 repository warnings and 10 informational diagnostics; the design check passed with one existing inline-style warning.
- `bun run check:rust:static` exited 0: `cargo check --all-targets` and Clippy passed. The script reported formatting drift as advisory; no repository-wide formatter was run over the already dirty worktree.
- Focused Rust tests passed: `host_image_inspector_accepts_only_bounded_matching_image_resources` and `host_resource_receiver_is_only_offered_for_explicit_resource_sharing` (1 test each).
- Focused frontend suite passed: `public/native/plugins/plugin-resource-transfer.test.js` (13/13), including candidate discovery, explicit share confirmation, execution, profile validation and result display for the built-in Host receiver.
- A real Host HTTP/WASI integration run passed: `actual_http_devtools_image_resize_candidate_host_flow` (1 passed). It launched the current Studio EXE as the production Worker for the DevTools image-resize fixture, read the generated 2×1 PNG through Host HTTP, rejected an unconfirmed transfer, transferred it to the built-in receiver after confirmation, and verified the receiver response and source profile. The receiver remains excluded from ordinary catalog results. This validates the backend path, not the native discovery/share UI.
- `bun run build:local` exited 0 and reused the pinned Pi 1.2.0 and current `target/debug`. Output: `target/debug/zicode-studio-desktop.exe`, 123,911,680 bytes, SHA-256 `B27DADBE0AF149F0A709859BBEC6F71F7E6EC6DD60DAFA91D6228D4F33992714`; app version remains 0.4.2.
- Post-build storage audit was read-only and complete: `target` 29,378,873,979 logical bytes / 74,267 files; `.cache` 310,353,261 bytes / 155 files; `.cache/task-scratch` 749,240,625 bytes / 29,994 files; `site` 29,644,753 bytes / 431 files; E: free space 60,812,021,760 bytes. The advisory target and scratch thresholds were exceeded; no files were deleted.
- After compiling and running the real Host integration, the read-only storage audit remained complete: `target` 29,377,159,548 logical bytes / 74,275 files; `.cache` 310,353,261 bytes / 155 files; `.cache/task-scratch` 749,240,625 bytes / 29,994 files; `site` 29,644,753 bytes / 431 files; E: free space 61,004,955,648 bytes. No cleanup was performed; useful target caches were reused.
- The focused `rustfmt --check` still reports pre-existing formatting drift in this already dirty test module; the full repository formatter also reports broad unrelated drift. The new assertions were aligned with rustfmt output without reformatting unrelated hunks. `git diff --check` passed for the edited Rust and iteration files.
- Previous Windows native image resize flow remains evidence for the WASI producer only. It does not exercise this new receiver.
- CUA inventory returned `apps: []`; the documented launch and window-enumeration methods were unavailable in this session. No native window or screenshot is claimed for the new UI path; a real native “discover → share → execute → display” run and a non-Windows run are still required.

## Risks and follow-up

- This is a narrow preview contract, not a general-purpose arbitrary Host plugin execution API.
- Add each future Host receiver only with a versioned contract, fixed capability policy, explicit permission model, bounded inputs/outputs and runtime conformance evidence.
- OCR and image processing built-ins still use their existing path/string interfaces and are not eligible resource receivers.
- Keep the prior full DevTools tool matrix as the integration scope; one native receiver does not change any per-tool status in that matrix.

## 2026-10-16 当前工作树重复验收补记

- 命令：`$env:ZICODE_TEST_RESOURCE_WORKER_EXE=target/debug/zicode-studio-desktop.exe; RUST_TEST_THREADS=2; cargo test --manifest-path src-tauri/Cargo.toml actual_http_devtools_image_resize_candidate_host_flow -- --ignored --nocapture`。
- 第一次运行在图片 invoke 返回 HTTP 409 时失败；当时断言未打印响应体，具体 Host 错误码未知。失败 scratch 保留于 `.cache/task-scratch/host-image-resize-0c221151-c0af-49dc-9dcf-3342d97194aa`，没有清理。
- 为该断言增加失败时打印 HTTP 状态和响应体的诊断。相同源代码与隔离 Worker EXE 连续两次通过，分别 7.37 秒和 6.34 秒；成功运行清理了各自 scratch。
- 当前 Debug EXE SHA-256 `A2121FA0D7E99726F88DB27E0BC08646E186392D12540A2AEFC1F5157F3E0DE8`。两次通过验证 PNG 资源输入、真实 WASI resize、Host 派生输出和内容读回；不能抹去第一次 409。若后续重现，诊断会输出 Host 响应体。
- `bun run check:rust:static` 在测试诊断改动后再次退出 0；`cargo fmt --check` 仍只报告 advisory 格式漂移。

该用例仍只覆盖 Windows 本地 HTTP Host/WASI 后端。原生 View 的插件发现/结果展示、签名包安装和 macOS/Linux 实际运行仍未验收。

Computer Use 复核（2026-10-16）：当前桌面状态返回 pps: []，没有可选的 Studio 原生窗口；没有生成或伪造截图，原生 UI 验收继续待补。
## 2026-10-16 跨插件图片资源转交验收

### 目标与发现

补齐“插件输出可交给其他工具”的真实 Host/WASI 后端证据。此前用例只把 DevTools 图片缩放产物转交给 Studio 内置 Host 图片检查器，没有证明另一项 WASI 插件能接收并读取该资源。冻结候选 WASM 内含固定的 `com.zicode.devtools.image` 和 `devtools.image.resize` 标识；直接复制模块并改插件 ID 的首次试验收到 `IMAGE_OPERATION_FAILED`，因此改用独立 Studio-owned 接收夹具，不改候选包身份或内容。

### 修改

- 在 `actual_http_devtools_image_resize_candidate_host_flow` 中注册第二个独立 WASI 接收插件，使用 `resource.wasi.input.draft2` 和 `resource.read`。
- 接收夹具只读取转交图片前 8 字节并校验 PNG 签名；它不保存、不访问路径或网络。
- 断言确认分享前提交会被拒绝；确认后 contentVersion 保持不变；接收插件实际执行并返回 `PNG received`。原有内置 Host 图片检查器验证继续保留。
- 给插件执行失败补充 HTTP 响应体诊断。没有修改 `tests/fixtures/devtools-image-resize-candidate02/` 中的冻结提供方文件。
- 冻结候选 WASM SHA-256 仍为 `A38E4743475F33F8C04AED87E064C942067956D4D0A366A4A12E36371DF8F77A`；Studio Debug Worker EXE SHA-256 为 `A2121FA0D7E99726F88DB27E0BC08646E186392D12540A2AEFC1F5157F3E0DE8`。

### 验证

- `bun run check:rust:static` 最终退出 0，`cargo check --all-targets` 和 Clippy 通过；`cargo fmt --check` 仍报告格式漂移，为 advisory。
- `$env:ZICODE_TEST_RESOURCE_WORKER_EXE=target/debug/zicode-studio-desktop.exe; cargo test --manifest-path src-tauri/Cargo.toml actual_http_devtools_image_resize_candidate_host_flow -- --ignored --nocapture` 最终通过，1 passed、630 filtered，测试段 6.37 秒。
- 保留的失败目录：`host-image-resize-8961fed3-1c53-41b9-a964-91d616fdcdc7`（重命名冻结 WASM 后返回 `IMAGE_OPERATION_FAILED`）、`host-image-resize-22420891-a55e-4f7c-856e-fdac2ca79244`（接收 manifest 的 `resourceInputMax` 不满足 2–4 限制）、`host-image-resize-745bd9fc-d3a1-4c92-859c-c4c984bbf757`（发送给空 schema 的接收能力仍带缩放参数，Host 返回 `invalid_parameters`）。另保留本流程其他已生成 scratch；没有手工删除。
- 本轮最终只读存储扫描完整：`target` 29,379,413,843 字节 / 74,295 文件；`.cache` 355,458,670 字节 / 156 文件；`task-scratch` 758,923,480 字节 / 30,067 文件；`site` 29,644,753 字节 / 431 文件；E: 可用 59,293,949,952 字节。target 与 scratch 超过 advisory 参考值，未执行清理或重试被拒绝的清理。
- `git diff --check` 对本次 Rust 文件变更通过。没有界面改动，本轮不声称原生 UI 验收或提供截图。

### 遗留与边界

- 已验证的是 DevTools 图片候选 → Host 显式授权 grant → 独立 Studio WASI 接收夹具 → 结果返回。它证明协议级跨插件资源接力，不代表已有第二个 DevTools 插件包已适配 receiver ABI。
- 原生目录发现/确认/执行/展示、签名插件包安装、macOS/Linux 运行均待验；DevTools 全量接受数仍为 0/154。
- 磁盘候选与此运行增加的 scratch 未获清理授权，继续保留供人工审核。

## 2026-10-16 插件失败后的兄弟工具连续性重验

### 目标与修改

将产品要求“插件失败不能影响 Studio 主界面及其他工具”补进已存在的真实图片资源 Host/WASI 用例。图片插件对损坏 PNG 返回安全业务错误 `INVALID_IMAGE` 后，测试继续使用前面明确授权的接收资源调用另一独立 WASI 工具，并断言接收工具仍返回 `PNG received`。这覆盖一个实际插件业务失败后的兄弟工具连续性，不冒充进程崩溃注入、主窗口响应或全局故障隔离证明。

### 验证

- `bun run check:rust:static` 退出 0，cargo check 与 Clippy 通过；cargo fmt 漂移继续作为 advisory。
- 真实当前 Studio EXE Worker 用例 `actual_http_devtools_image_resize_candidate_host_flow` 通过：1 passed、630 filtered，测试段 5.54 秒；目标 EXE SHA-256 `A2121FA0D7E99726F88DB27E0BC08646E186392D12540A2AEFC1F5157F3E0DE8`。
- 测试前后只读空间扫描均完整、UnknownEntries=0。前：target 29,379,413,843 B / 74,295 files，task-scratch 758,923,480 B / 30,067 files，E: free 59,272,904,704 B。后：target 29,379,422,547 B / 74,295 files，task-scratch 同为 758,923,480 B / 30,067 files，E: free 59,469,008,896 B。target 和 scratch 超出 advisory 值；物理卷空闲空间差异不归因于本测试，本轮未清理任何文件或缓存。
- 相关源文件 `git diff --check` 通过；没有界面修改，因此本轮不产生 UI 截图，也不声称原生 WebView 验收。

### 遗留

真实接力与业务失败后继续工作已通过，但 worker 进程崩溃/超时故障注入、主窗口交互隔离、真实“目录→分享→执行→结果”原生界面，以及 macOS/Linux 运行仍待。Studio WASI 接收方仍是测试夹具，未增加 DevTools 全目录的接受项（0/154）。开发缓存和失败 scratch 保持原样，因清理审批未通过，不改用其他工具清理。
