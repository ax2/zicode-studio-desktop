# Stage：文本结果接力取消（2026-10-17）

## 目标与发现

上阶段已让接收方 WASI 计算离开共享锁，但确认执行后可信界面的“取消”仍被禁用。慢工具只能等待超时，用户无法撤销尚未执行的 grant，也无法主动停止正在执行的 Worker。

## 修改

- Studio Host 新增桌面限定 `cancel-transfer`，以 `scope + grantId` 定位授权。执行前取消阻止启动；运行中取消使用 Worker 已有停止信号；已完成只报告完成，避免误称撤销成功。
- 同一 grant 运行时拒绝重复提交，取消后不生成结果引用且不再次执行。搜索目录与无关工具可在接收 Worker 暂停时继续使用。
- 可信父界面在确认后保留取消按钮，向 Host 请求停止并等待原提交的最终结果；明确区分已取消、工具失败及取消与完成竞争。取消请求后若网络结果未知，禁止直接重复提交。
- 契约见 `docs/plugins/result-transfer-contract.md`。仅修改 Studio，未修改 DevTools 提供方、版本号或发布产物。

## 验证

- 前端定向 Vitest：3 文件 51/51；`bun run typecheck` 通过；`bun run check` 通过，保留既有 lint 提示。
- Rust transfer 组 7/7，2 个需显式运行的真实进程用例保持 ignored。真实 HTTP + Windows Worker 取消、并发目录查询、无关工具调用、新 grant 再执行的用例显式运行 1/1 通过。
- `bun run check:rust:static`：Cargo check、Clippy 通过；全仓 `cargo fmt --check` 的既有漂移仍为提示。定向修改已运行 rustfmt。
- 跨包真实 Worker 用例在本轮改动前 1/1 通过；第一次改动后重跑时 Cargo 尝试替换仍在运行的隔离 Debug EXE，被 Windows 拒绝访问。关闭隔离进程并重建后，改动后再次重跑 1/1 通过。保留首次失败的原因，不把它记作测试失败或抹去。

## 遗留与验收边界

随后安全关闭隔离窗口及其托盘进程，复用同一 `target/debug` 执行 `bun run build:local`，得到新版完整 Debug 运行目录与 EXE（SHA-256 `1AB824C1BBA950D9358C43A5597D3567FE2C4EDBF77380BF2622C6BFA42DFC3D`，版本仍 0.4.2）。改动后的跨包真实 Worker 用例显式重跑 1/1 通过。以原隔离 profile 的 `--tools-only` 重新启动后，原已安装/启用的 Inspect 0.1.1 仍在 24 个工具目录中；原生 NFKC → Unicode 完成按需加载、执行、6 字节文本预览、明确确认及接收结果展示。确认执行的短暂运行状态显示可用的“取消发送”按钮；接收工具完成得很快，随后点击时结果已落地，本次不能证明原生 Worker 被停止。浅色主题 1442×931 的完成状态截图已检查并归档至技术博客 `screenshots/result-transfer-cancellation-2026-10-17/new-debug-completed.jpg`。未保存数据、未传给模型。

后续仍需用可控慢接收工具实测原生取消及完成竞争。尚缺两家独立提供方实包、macOS/Linux、进程崩溃后的最终结果查询。旧 EXE 的 Inspect 原生 8/8 与本轮新 EXE 的普通转交是不同证据；正式 DevTools 完整接受仍为 0/154。
