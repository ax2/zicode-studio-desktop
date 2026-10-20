# 签名证明变化的 Host HTTP 重载验收（2026-10-17）

## 目标与发现

注册表专项已证明另一份有效签名包及完整性证明会轮换执行代次，但还需要核对真实 Host HTTP 重载是否接纳新包，同时精确处理旧游标和活动任务。提供方候选目录仍没有正式 `.zicode-plugin`；DevTools 开发会话仍在运行。

## 本阶段修改

- 增加接收端测试签名包的 Host HTTP 生命周期用例：安装、同证明重载、外部替换为另一份有效签名包及配套元数据、再次重载，并检查响应诊断、插件目录、游标和任务状态。此用例只验证 Studio 接收端，不修改 DevTools。
- 新用例的成功运行夹具放在 `.cache/task-scratch/host-signed-reload-*`，写入 `owner.json`；成功后清理并确认目录不存在。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop signed_proof_replacement_reload_revokes_only_its_host_state`：最终 1/1。相同证明重载响应无诊断，保留旧游标和 `running` 任务；另一份有效签名包重载响应无诊断且插件仍列为 `signed`，旧游标失效、所属任务 `revoked`，无关任务继续 `running`。
- 第一次运行夹具的游标字符串不足 16 字符，在替换阶段前失败；修正后两次运行均通过，最后一次增加“无诊断且插件仍列出”断言。`bun run check:rust:static` 退出 0；Cargo check 和严格 Clippy 通过，rustfmt 仍报 advisory。
- 前后只读空间扫描完整、未知项 0：`target` 29,419,844,521 → 29,419,982,761 B；task-scratch 均为 852,978,182 B；E 盘可用 43,809,280,000 → 43,096,702,976 B。没有执行项目清理，卷空间变化不归因于此用例。

## 审批与遗留

首次失败时在 `C:\Users\ax2\AppData\Local\Temp\zicode-host-signed-reload-8dd7f6c3-1dc8-493f-b4cf-6a65b7dd4ad1` 留下 9 文件、104,288 逻辑字节。经解析路径确认为本轮临时夹具后，PowerShell 删除请求在执行前被自动审批拒绝，返回 `blocked by policy`、未给具体原因；实际删除 0，不换工具重试。此路径为手工候选，不计作已释放空间。

真实 DevTools 提供方签名包、原生界面完整链路和跨平台运行仍待验收；154 项工具完整接受仍为 0/154。本阶段未修改界面，因此无截图。
