# ZiCode Studio 服务器部署手册（中继 + coturn + 监控）

本文是单台境内云主机（阿里云）生产部署的可执行手册，覆盖中继（M1 数据面 +
M3 E2EE + M4 配额/持久化）、coturn（M2 打洞）与监控告警。所有口令/密钥只写
非敏感占位描述，**不记录任何真实 secret**。

## 0. 前置条件

- DNS：`relay.zicode.com` 与 `turn.remote.zicode.com` 的 A 记录都指向本服务器
  公网 IP；
- 阿里云安全组放行：TCP 80/443（中继/证书）、UDP+TCP 3478（STUN/TURN）、
  UDP/TCP 49152–65535（TURN 中继区间）；
- 服务器为 Debian/Ubuntu 且有 root；仓库可从 GitHub 拉取。

## 1. 部署中继（M1/M3/M4 + 按日用量持久化）

```bash
ZICODE_RELAY_REGISTRATION_TOKEN=<secret> \
ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE=<每日字节配额> \
./scripts/relay/deploy-relay.sh
```

脚本自动：构建独立 relay crate → 安装 `/usr/local/bin/zicode-relay` →
systemd（注册令牌 + 配额 + `ZICODE_RELAY_DATA_DIR` 持久化 +
`StateDirectory`）→ nginx 反代 → certbot 证书。

验证：

```bash
curl https://relay.zicode.com/relay/status
# 期望含 usage / usageDay / usageHistory 字段；desktops 列出在线桌面
```

桌面端配置（`<data_root>/remote-access/config.json`）加
`"relayRegistrationToken": "<同一 secret>"` 后重启桌面。**secret 不入仓**。

## 2. 部署 coturn（M2 打洞）

```bash
./scripts/relay/deploy-coturn.sh
```

脚本会：安装 coturn → 写入 `/etc/turnserver.conf`（auth-secret 长时凭据、
relay 端口区间）→ 启用服务 → **打印 1 小时有效的 `relayIceServers` JSON**。
把该数组粘贴到桌面端 `remote-access/config.json` 的 `relayIceServers`，重启
桌面；手机端会经 `GET /v2/remote-config` 自动获取。TURN 凭据短期有效，
secret 只存在于服务器 `/etc/turnserver.conf` 与桌面配置，不入仓。

验证：`turnutils_uclient`（脚本会打印示例命令）。

## 3. 监控告警

```bash
ZICODE_RELAY_ALERT_URL=https://hooks.example.com/zicode \
./scripts/relay/install-check.sh
```

- systemd timer 每 5 分钟运行 `check-relay.sh --json`；
- 退出码：0=健康、1=桌面离线、2=中继不可达；失败时 POST JSON 告警（尽力而为）；
- 手动检查：`check-relay.sh --json`；接入 cron 亦可。

## 4. 桌面端验证

- 设置 → 远程访问：中继开关、连接状态、"今日中继流量"与近 7 天历史应显示
  真实数值；
- 撤销手机后约 5 秒内会话断开且停止重连；
- 重启桌面后中继自动回线（自愈）。

## 5. 手机端验证

- 公网路径：手机浏览器打开 `https://relay.zicode.com/d/<device>/app/` → 配对
  → 对话/回复正常；
- P2P：同局域网自动直连（host 候选）；跨 NAT 依赖 STUN/TURN 候选与打洞，
  失败自动回退中继，无需手动切换；
- 已配对设备在设置 → 远程访问 → 已配对设备中可随时撤销。

## 6. 故障排查

- 桌面日志：`%LOCALAPPDATA%\zicode\logs\ZiCode Studio Desktop.log`（UTC，
  比本地慢 8 小时）；`[relay-agent]`/`[pairing]`/`[model-gateway]` 前缀
  分别对应中继、配对、模型链路；
- 中继状态：`/relay/status`；超配额表现为 HTTP 429 或 WS
  `device_quota_exceeded`；
- `check-relay.sh` 退出码语义见第 3 节；`--json` 输出含 usage/usageDay/
  usageHistoryDays 便于告警消费；
- 服务器重启不清零当日配额（用量持久化在 `/var/lib/zicode-relay`）。

## 7. 发布与签名

- `bun run build` 生成安装包；`scripts/sign-release.ps1`（signtool，
  证书经参数传入，密码走 `ZICODE_SIGN_PASSWORD`）签名 EXE 与安装包；
- 对外分发前完成 Authenticode 签名（证书未就绪时先以本地哈希与安装验证
  记录为准）。
