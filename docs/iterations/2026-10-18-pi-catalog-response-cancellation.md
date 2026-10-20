# Pi 插件目录响应取消边界（2026-10-18）

## 目标与发现

Studio 的通用 Pi 目录搜索与加载已给 `fetch` 传递 15 秒截止信号，但 `plugin-catalog-client.ts` 直接等待传输及 `ReadableStream` 正文读取。遇到不响应中止信号的传输或悬挂响应流时，单次 `studio_plugin_search` / `studio_plugin_load` 仍可能长期不返回，影响按需发现。

## 修改

在通用目录客户端用同一个绑定信号封装 `fetch` 和每次正文读取的等待；主动取消返回 `catalog_request_cancelled`，截止返回 `catalog_request_timeout`。正文失败时触发非阻塞流取消；仍保留原有正文大小上限、目录修订与身份核验、Host 实时授权。没有修改 Pi 本体、提供方插件、插件启用状态或 UI。

## 验证

- 新增传输忽略 AbortSignal、正文流停住两种回归情形，并补充请求前已取消、传输完全不响应时截止返回的断言；`extensions/plugin-catalog.test.ts` 最新 11/11 通过。此前 10/10 是增加截止分支前的记录。
- `bun run typecheck:extensions-source` 与 `bun run check` 通过。全仓 lint 仍报告其他文件的 147 条 warning、10 条 info；本轮两文件定向 lint 无问题。
- 本轮没有 Rust/Tauri 构建或原生窗口截图。该用例证明扩展层等待可中断，不证明任意插件算法、真实网络卡顿、Pi 模型调用或跨平台原生整链已验收。
- 同日真实 Pi 补验：在 C 盘技术档案 `iterations/pi-catalog-response-cancellation-2026-10-18/evidence/` 保存 135,017 字节的当前 Studio Broker 单独打包件（SHA-256 `14434DD4EBD481060EAB23175AC5AD358F7503ECEE02BEF13954A0248AF17BE9`）、探针、驱动与结果。项目内嵌 `pi.exe --version` 为 1.3.0，EXE SHA-256 `EB2205E842D1B02A1A539E98618B20D6B055A008FA0B678EBBBEB004239F1365`。隔离 RPC 进程加载该 Broker，合成传输分别不响应请求与卡住正文流，两个工具调用都返回 `catalog_request_cancelled`；驱动退出 0、探针 Pi 进程无残留。`evidence.json` SHA-256 为 `323E64F39E74FBDB308625D93CA2C532C9C8CD9174B3EB07E62E4F83ADA5ADA4`。这仍非真实 Studio Host/Worker 或模型调度验收。
- 真实 Pi 探针前后空间预算扫描 `target` 均为 30,041,815,353 逻辑字节、`UnknownEntries=0`；E: 可用由 7,925,760 到 7,860,224 字节。卷余量变化不能全部归因于本轮，两个预算退出 1 均为低空间建议。
- 运行前后空间预算扫描均为 `UnknownEntries=0`，`target` 逻辑大小保持 30,041,815,353 字节、E: 可用分别为 9,097,216 和 6,062,080 字节，因低空间建议性退出 1。期间只读抽样可用量曾到约 45 KB，又回到约 6.7 MB；变化来源未确认，未删除或改动其他项目文件。

## 遗留

待在稳定空间的真实 Studio/Pi Host 链路制造慢响应与取消，再核对用户可见错误提示；DevTools 正式签名包及全部 154 项、ZiFile 全部 108 项和其他系统仍待验收。完整工具接受数不因本次客户端修正增加，无发布结果。

同日继续只读复核：E: 约剩 8 MiB；`target/debug/incremental` 仍有 24 个目录、1,799 个文件、2,790,120,589 逻辑字节，内部重解析点 0，当前 Cargo dev profile `incremental=false`，当时无 cargo/rustc/Studio 进程。`target/debug/zicode-studio-desktop.exe` 与 `target/release/zicode-studio-desktop.exe` 均在。这个目录的自动删除此前已被策略拒绝，本轮没有重试；已向用户给出手工精确清理范围，实际删除 0、释放量未确认。最新 11/11 专项与扩展类型检查通过；测试前后预算扫描 E: 可用分别为 8,257,536、7,860,224 字节，两次 `UnknownEntries=0`，低空间建议性退出 1；不把卷余量差值全部归于本轮。
