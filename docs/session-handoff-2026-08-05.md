# ZiCode Studio Desktop 会话交接（2026-08-05）

本文档用于把 2026-08-04 ~ 2026-08-05 这一会话的主要内容迁移到新会话。新会话从本
文件恢复上下文即可继续工作，不必重新考古历史。

## 1. 会话范围与目标

- 项目：`C:\Users\ax2\zicode-studio-desktop`（Rust + Pi 桌面应用，WebView2 前端，
  手机浏览器作为远程客户端）。
- 本轮主题：**移动端公网接入 + 稳定性**。从"内网/隧道直连"演进为"服务器会合"方案
  （M1 已上线），并完成模型请求稳定性调试。
- 目标仍在继续（goal active）：完善移动端体验，当前无阻塞项。

## 2. 当前架构（一句话版）

桌面端与手机端都**主动连接**中继服务器 `relay.zicode.com` 做会合与转发；服务器
无状态、不落盘；桌面本地严格网关（57682）仍是认证权威（设备令牌、扫码配对）；
数据面按 M1 中转 → M2 P2P 直连 → M3 端到端加密分阶段演进。

手机访问入口：`https://relay.zicode.com/d/dev-ax2-01/app/`
（302 重定向到 `/app/`，设备 cookie 自动保存；证书为 Let's Encrypt，手机无需安装
自定义根证书）。

## 3. 本轮完成内容（第 106–112 轮摘要）

详细逐轮记录见 `docs/mobile-experience.md` 第 106–112 轮；以下是结论性摘要：

1. **第 106 轮**：公网接入初版用 SSH 反向隧道（frp 二进制被 Defender 判
   `PUA:Win32/FRProxy`，无管理员权限改走 SSH `-R` 隧道，映射
   `0.0.0.0:39010→127.0.0.1:57682`）。该方案**已废用**，但隧道进程仍在运行。
2. **第 107 轮**：产品化方案定为"服务器会合"架构（桌面/移动都连服务器，服务器只
   会合转发），产出 `docs/remote-access-server-architecture.md` + `adr/0006`。
3. **第 108 轮**：M1 中继实施（`relay_server.rs` + `bin/relay.rs` 桌面注册、移动 WS
   桥、`/d/<device>/` 路由、HTTP 代理；`relay_client.rs` 桌面 Agent 桥接本地严格网
   关）；Rust 118 项测试通过。
4. **第 109 轮**：公网部署完成（阿里云 39.98.116.129，systemd `zicode-relay` +
   nginx + certbot 签发 `relay.zicode.com` 证书）；公网全链路验证通过。
5. **第 110 轮**：移动端收到"桌面离线"明确提示（中继发 `desktop_offline` 帧 +
   前端识别），不再误报"本地 Host 不可用"。
6. **第 111 轮**：修复 relay 模式路由解析（`/d/<device>/app/` 302 到根路径 + 设备
   cookie）与 PWA manifest 400（HTML 改写 manifest 链接、manifest 的
   `start_url/scope/id` 改为设备作用域）。
7. **第 112 轮**（2026-08-05）：模型请求稳定性调试。
   - 复现：旧实例场景配置过期 → 通用错误卡"请检查模型渠道"；新实例正常。
   - 验证：桌面连续 5 条消息完整返回；中继移动路径事件流 22 条零错误；当日应用
     日志零 ERROR/WARN/panic。
   - 改进：`model_gateway_proxy` 增加 `[model-gateway]` 请求/响应诊断日志。

## 4. 当前运行状态（2026-08-05 11:1x 实测）

- 桌面实例：`target\debug\zicode-studio-desktop.exe`，PID 33728（10:49 启动），
  监听 127.0.0.1:57620（本地）、0.0.0.0:57652（LAN HTTPS）、57668（证书引导 HTTP）、
  57682（公网严格网关）。窗口可见，**关窗即退出**。
- WebView2 CDP 调试端口：9226（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 启动时设置，
  由 WebView2 子进程占用）。
- 公网中继：`https://relay.zicode.com/relay/status` 返回
  `{"desktops":["dev-ax2-01"],"sessions":[]}`（在线）；`/d/dev-ax2-01/app/` 302 正常。
- SSH 反向隧道：ssh 进程运行中（08-04 16:55 启动，映射 39010/39011），已非主路径。
- 本地调试中继 `zicode-relay.exe`（127.0.0.1:9900）：**已停止**，需要时可再启动。
- 手机：OPPO PHY110，**ADB 当前离线**（`adb devices` 无设备），需重新插线/开调试。
- 应用日志：`C:\Users\ax2\AppData\Local\zicode\logs\ZiCode Studio Desktop.log`
  （时间戳为 UTC，比本地慢 8 小时）。模型失败排查看 `[model-gateway]` 行。

## 5. 关键文件与配置

代码（均在 `src-tauri/src/`）：

- `relay_server.rs`、`bin/relay.rs`：中继服务（部署到服务器）。
- `relay_client.rs`：桌面 Agent（出站连中继 → 桥接本地 57682）。
- `relay_protocol.rs`：协议帧。
- `host_server.rs`：`model_gateway_proxy`（developer→system 重写 + 诊断日志）。
- `remote_tls.rs`、`remote_auth.rs`、`remote_access_config.rs`：证书/认证/配置。

前端移动（`public/native/`）：

- `bootstrap-entry.js`：裸地址 → 最近会话/配对页/离线页分流。
- `startup-failure.js`、`remote-auth.js`、`transport/runtime-adapter.js`：
  离线/配对提示与传输。
- `index.html`：`<base href="/">` 保留（根相对资源 + cookie 路由）。

配置：`C:\Users\ax2\AppData\Local\zicode\remote-access\config.json`

```json
{"version":1,"enabled":true,
 "publicUrl":"https://relay.zicode.com/d/dev-ax2-01",
 "publicEnrollmentUrl":"https://relay.zicode.com/d/dev-ax2-01/v2/auth/ca.pem",
 "relayEnabled":true,"relayUrl":"wss://relay.zicode.com",
 "relayDeviceId":"dev-ax2-01"}
```

文档：

- `docs/mobile-experience.md`：逐轮工作日志（到第 112 轮）。
- `docs/remote-access-server-architecture.md`：会合架构（M1/M2/M3）。
- `docs/public-access-frp.md`：SSH 隧道方案（已废用，保留对照）。
- `docs/mobile-real-device-acceptance.md`：真机验收清单。
- `scripts/relay/deploy-relay.sh`：服务器部署脚本。

## 6. 常用启动与验证命令

```powershell
# 启动桌面（debug exe，最快）
C:\Users\ax2\Desktop\启动 ZiCode Studio Desktop.cmd

# 或开发模式（自动重编译，端口可能波动）
cd C:\Users\ax2\zicode-studio-desktop; bun x tauri dev

# 启动本地调试中继
& C:\Users\ax2\zicode-studio-desktop\target\debug\zicode-relay.exe 127.0.0.1:9900

# 中继在线状态
Invoke-WebRequest https://relay.zicode.com/relay/status

# 手机 ADB
& C:\Users\ax2\AppData\Local\Android\Sdk\platform-tools\adb.exe devices
```

调试脚本（`C:\Users\ax2\zicode-frpc\`，针对 CDP 9226 与中继路径）：

- `cdp-send.py`：CDP 驱动桌面发消息。
- `relay-chat-test.py`：经公网中继订阅 runtime + 发 prompt 的事件流测试。
- `cdp-diag.py` / `cdp-verify.py` / `headless-test.ps1`：页面诊断/验证。
- `zicode-ca.pem`：本机 CA 公钥副本（敏感信息不入库，仅本机调试用）。

测试：

```bash
cd src-tauri && cargo test   # Rust 118 项
cd public && bun test        # 前端全量测试
```

## 7. 待办与后续方向

1. **手机真机验收**：重新连接 ADB（当前离线）后，完整走一遍公网路径——手机打开
   `https://relay.zicode.com/d/dev-ax2-01/app/` → 桌面生成会话二维码扫码配对 →
   聊天/刷新/离线重连。
2. **推送 Git**：当前 main 分支 ahead of origin/main **41 个提交**（均为会合方案以来
   的工作，未推送）。origin 为 `https://github.com/ax2/zicode-studio-desktop.git`。
3. **设置面板"经服务器"开关 UI**：尚未实现，目前靠 `config.json` 手改。
4. **M2/M3**：P2P 直连 + 端到端加密（尚未启动）。
5. **服务器部署自动化**：当前服务器是 scp + 手动构建；`deploy-relay.sh` 的 GitHub
   克隆构建路径未实测。

## 8. 新会话注意事项

- 桌面窗口 = 应用生命周期；改 Rust 后需重启桌面实例。
- 日志时间戳是 UTC（比本地慢 8 小时），核对时间时先换算。
- 模型失败排查顺序：先看 `[model-gateway]` 日志（auth 前缀 + 上游状态码），再确认
  场景配置（`scenes/*/agent/settings.json` 默认模型 `deepseek-v4-flash`）是否过期，
  最后看实例是否是最新启动。
- 中继无状态；桌面 Agent 断线会自动重连（重连退避），`/relay/status` 短暂为空属
  正常。
- 敏感信息（API key 全量、服务器口令、CA 私钥）不得写入文档与提交；本文件只记录
  非敏感架构与验证结果。
- 用户沟通用中文；提交按 feat/fix/docs/chore 分组；每轮工作日志追加到
  `docs/mobile-experience.md`。
