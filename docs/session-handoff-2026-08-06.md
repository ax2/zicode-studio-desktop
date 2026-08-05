# ZiCode Studio Desktop 会话交接（2026-08-06）

## 当前状态

- 代码与交付物本地工作**已全部闭环**（第 126–141 轮），安装包为第 140 轮
  release 产物（含 M2 P2P 全链路 + STUN/TURN 注入 + P2P 有界重试）；
- 本地验证完整：中继鉴权/配额/持久化/监控（第 120–128 轮）、用量历史 UI
  （129）、M2 四层 WebRTC 验证（131–133、141，含浏览器↔webrtc-rs 互操作）、
  release 六次重建（130/135/138/140 等）；
- 桌面实例运行中（安装目录 release 版），公网中继 `dev-ax2-01` 在线；
- **待推送提交**：`e92d026`（第 142 轮验收清单同步）——GitHub 网络不可达
  （直连与本地代理 7890/7891/1080 均失败），推送待网络恢复：

  ```bash
  git -C C:\Users\ax2\zicode-studio-desktop -c http.version=HTTP/1.1 -c http.lowSpeedLimit=0 push origin main
  ```

## 生产缺口（全部为外部项）

1. **服务器部署**：公网 `relay.zicode.com/relay/status` 仍为旧版（无
   usage/usageDay/usageHistory）；M4 鉴权/配额/持久化与监控未生效。按
   `docs/deployment-runbook.md` 依次执行 `deploy-relay.sh` →
   `deploy-coturn.sh`（粘贴输出的 `relayIceServers` 到桌面
   `remote-access/config.json`）→ `install-check.sh`；
2. **真机验收**：二维码摄像头扫码、M2 同局域网直连/跨 NAT 打洞、后台保活/
   系统回收、键盘与无障碍清单项（见 `docs/mobile-real-device-acceptance.md`）；
3. **安装包签名**：`scripts/sign-release.ps1` 就绪，待 Authenticode 证书。

## 关键路径与约定

- 项目：`C:\Users\ax2\zicode-studio-desktop`（Rust + Tauri，移动端为浏览器
  远程客户端）；轮次日志 `docs/mobile-experience.md`（当前到第 142 轮）；
- Rust 门禁：`bash scripts/check-rust.sh`（check all-targets、test、clippy
  `-D warnings`、fmt）；前端：`bun run test` + `bunx biome lint <改动文件>`；
  cargo 需在 `src-tauri` 目录内运行（项目 `.cargo/config.toml` 用
  rsproxy 镜像）；
- 中继/网关/配对诊断日志前缀：`[relay-agent]`、`[pairing]`、
  `[model-gateway]`；桌面日志 `%LOCALAPPDATA%\zicode\logs\`（UTC）；
- 文档不记录敏感信息（secret/口令只留非敏感描述）；
- 部署细节、验收清单、发布哈希分别见 `docs/deployment-runbook.md`、
  `docs/mobile-real-device-acceptance.md`、`docs/release-validation-2026-08-05.md`。
