# Stage：文本结果接力状态恢复（2026-10-17）

## 目标与发现

结果接力在显式确认后执行接收方 WASI。上一阶段增加了取消，但提交连接断开时，可信父界面只能提示结果未知；用户不能只读确认 Worker 是否仍在运行，也不能安全取回已完成的结果。直接重复提交虽有 grant 幂等约束，但不能替代明确的恢复入口。

## 修改

- 新增桌面限定 `POST /v2/plugin-results/transfer-status`。Host 以作用域和 grant 查状态，重核来源记录、来源与目标授权和内容 proof；只在已完成时返回原缓存响应。查询不执行、取消或保存。
- 可信父界面在提交连接异常后自动查询一次，保留手动“查询接收工具结果”按钮。已完成结果复用原展示入口；仍运行或取消中可稍后再查。同一 grant 的确认按钮在未知结果后保持禁用，避免重复请求。
- 契约边界见 `docs/plugins/result-transfer-contract.md`。grant 仅在当前 Host 内存保留 120 秒，进程重启或过期后仍可能结果未知。

## 验证

- 前端定向 Vitest：3 文件 54/54；TypeScript 类型检查通过；`bun run check` 退出码 0，保留既有 145 条 warning、10 条 info 和 1 条生成代码样式提示。
- Rust transfer 组 7/7，2 个真实进程用例需显式执行；真实 HTTP/Windows Worker 多输入、运行中查询、取消中查询、缓存错误恢复 1/1；跨包真实 Worker 与撤权后旧 grant 查询拒绝 1/1。`bun run check:rust:static` 的 Cargo check 和 Clippy 通过，仓库既有 `cargo fmt --check` 漂移仍为提示，修改的 Rust 文件单独格式化。
- `bun run build:local` 复用原 `target/debug`，新 EXE SHA-256 `48EE0F162EAC5986E758D2A6A916138ADEDDD6A2353C83469D7D4F90C04F953E`。原隔离 profile 的 Windows Debug 重启后已连接，工具目录 24 项且 Inspect 0.1.1 仍在；断线恢复情景未在原生窗口注入，不能以启动截图代替该路径验收。
- 随后只读复核隔离配置 `enabled:true`、`pi.tools.register:true`，核对运行中进程确实为该 Debug EXE、`--isolated-profile` 与 `--tools-only`。在其原生窗口从 24 项目录按需打开 Inspect 0.1.1 的 IPv4 CIDR，输入合成 `192.168.1.10/24` 并执行；实际显示成功、网络 `192.168.1.0/24`、掩码 `255.255.255.0`、254 个可用地址及保存/转交入口。未点击保存或发送。此复核仅增加**当前 EXE 的单项真实执行**，不能代替旧 Debug 的 8/8 历史记录，也不能证明本阶段断线状态恢复或取消按钮的原生路径。
- 用实际 `plugin-result-transfer.js` 与受控网关响应在 Chrome 1280×800 渲染连接断开、状态 `running` 的组件预览；已逐图检查文字、数据预览和查询入口，归档技术博客 `screenshots/result-transfer-status-2026-10-17/recovery-component.png`。这张图是组件预览，不是原生 Host 断线截图。

## 遗留与磁盘

仍需在原生 Debug 注入可控提交断线与慢接收 Worker，验证状态恢复、真实取消点击和完成竞争；Host 进程崩溃后的持久收据、macOS/Linux 和独立提供方签名包也未验收。正式 DevTools 全目录接受仍为 0/154。

阶段前后只读扫描：`target` 29,988,611,459 → 29,993,014,792 字节（+4,403,333）；task-scratch 1,023,408,512 → 1,030,421,347 字节（+7,012,835）；非 scratch `.cache` 355,458,670、site 29,644,753 字节不变，未知项 0。E 盘可用 29,989,978,112 字节；卷余量变化不能全归因于本轮。组件预览的任务自有 `chrome-profile` 位于 `.cache/task-scratch/result-transfer-recovery-20261017/chrome-profile`，包含约 7.6 MB 的一次性资料。精确路径清理被自动策略拒绝，未重试或绕过；可由用户人工删除该子目录，保留同目录的小型预览源码供复查。没有创建第二个 target、发布版本或 ZIP。

单项原生复核后的只读扫描：`target` 29,993,014,792 字节，task-scratch 1,031,743,734 字节，非 scratch `.cache` 355,458,670 字节，site 29,644,753 字节，未知项 0；E 盘可用 30,340,788,224 字节。卷余量受其他进程影响；隔离 WebView 配置仍在运行，未按容量门槛删除复用中的缓存。
