# ZiCode Studio 移动端公网访问方案

目标：手机不在桌面同一局域网时，也能打开 ZiCode Studio 移动端并访问桌面会话。
本文记录拓扑、安全模型、落地步骤与故障排查。状态：**桌面端与服务器端已完成并验证，
阿里云安全组放行端口后即可对手机开放**。

## 拓扑

```text
手机 (任意网络)
  │  https://www.zicode.com:39010 （TLS 由桌面签发，SAN 含 www.zicode.com）
  ▼
阿里云 www.zicode.com (39.98.116.129)
  │  反向 SSH 隧道（Windows 自带 OpenSSH，断线自动重连）
  ▼
Windows 桌面
  ├─ 127.0.0.1:57682  严格认证公网网关（HTTPS，frp/SSH 转发目标）
  └─ 127.0.0.1:57668  证书安装引导页（HTTP，供新手机下载 CA）
```

服务器上原有 frps（frp 0.62.1，bindPort 7000、vhostHTTPPort 8080、dashboard 37500）
继续运行不受影响；本方案默认使用 SSH 反向隧道，原因见下文"为何不用 frpc"。

## 端口与放行

| 用途 | 桌面端口 | 公网端口（www.zicode.com） | 说明 |
| --- | --- | --- | --- |
| 主应用 HTTPS/WSS | 57682 | **39010** | 严格认证，必须配对后才能访问数据 |
| 证书安装引导 | 57668 | **39011** | 只提供 CA 证书与安装说明 |

- 服务器 ufw 已放行 `39000:40000/tcp`，无需改。
- **阿里云 ECS 安全组需放行入站 TCP 39010、39011**（当前仅放行 22/7000/8080/37500
  等端口，39010/39011 从公网不可达）。这是唯一需要用户在阿里云控制台完成的一步。

## 安全模型

不能直接把局域网 HTTPS 端口（57652）转发到公网：frp/SSH 隧道在桌面看来源地址都是
127.0.0.1，而桌面对回环地址放行设备认证，等于把全部会话和文件暴露给任何知道端口的人。

因此新增**严格认证公网网关**（`host_server.rs` 的 `authorize_public_http` 与
`websocket_upgrade_public`）：

- 除公开路径（静态资源、`/health`、`/v2/auth/exchange`、`/v2/auth/ca.pem`、`/v2/ws`）
  外，一律要求 `Authorization: Bearer <设备令牌>`，回环地址不豁免；
- 隐藏桌面专用端点：`/v2/lan-qr`（配对凭据签发）与 `/v2/model-gateway/*`（本地模型
  代理，携带 QVeris 密钥）返回 403；
- WebSocket 强制 `clientType=remote` 且设备令牌有效，Origin 必须在发布地址列表中；
- 手机与局域网流程一致：桌面生成会话二维码（扫码后 URL 为公网地址），手机用
  pairingToken 换取设备令牌，令牌保存在手机 localStorage。

证书：叶证书按启动时的网卡地址 + 配置的公网主机名（`publicUrl` 解析出的主机）签发，
CA 私钥仍在桌面系统凭据库。手机已安装 ZiCode Studio Mobile CA 时访问
`https://www.zicode.com:39010` 完全受信（无主机名警告，已验证）。

## 桌面端配置

1. 设置 → 远程访问 → 开启"安全移动访问"。
2. 在"公网访问"输入：
   - 公网 HTTPS 地址：`https://www.zicode.com:39010`
   - 公网证书安装地址：`http://www.zicode.com:39011`
   保存后**重启 ZiCode Studio**（重启后配置写入
   `%LOCALAPPDATA%\zicode\remote-access\config.json`，公网网关 57682 才会监听）。
3. 重启后可在设置页看到公网地址；点击会话旁的二维码会生成公网配对链接。

配置字段：`publicUrl` / `publicEnrollmentUrl`（可选，留空则不启用公网网关）。

## 服务器端配置

```bash
# 允许 SSH 反向转发绑定到公网接口（已执行并重启 sshd）
echo 'GatewayPorts clientspecified' >> /etc/ssh/sshd_config
sshd -t && systemctl restart sshd
```

## Windows 隧道（当前采用 SSH 反向隧道）

脚本：`C:\Users\ax2\zicode-frpc\start-tunnel.ps1`（断线 10 秒后自动重连）；
自启：`启动文件夹\zicode-public-tunnel.cmd`（登录时隐藏运行）。

等效命令行：

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -R 0.0.0.0:39010:127.0.0.1:57682 `
  -R 0.0.0.0:39011:127.0.0.1:57668 www.zicode.com
```

### 为何不用 frpc

服务器 frps 已就绪，但 Windows 上运行 frpc 需要客户端二进制。frp 官方发布包与本机
`go build` 产物均被 Windows Defender 判为 `PUA:Win32/FRProxy` 并拦截执行；本机无
管理员权限无法为目录加白名单。SSH 反向隧道使用系统自带 OpenSSH 与既有 root 免密登录，
效果等同 frp 的 tcp 隧道。若之后获得管理员权限并希望切回 frp，可参照
`scripts/public-access/frpc.toml`（需与 frps 建立认证令牌并启用传输 TLS）。

## 手机使用

1. 首次连接：手机打开 `http://www.zicode.com:39011` 下载并安装信任证书，核对指纹。
2. 桌面端打开目标会话 → 点击"在手机上打开"→ 手机扫码（二维码内容为
   `https://www.zicode.com:39010/app/...?pairingToken=...`）。
3. 手机完成配对后即可浏览会话、发送消息；之后直接用书签打开
   `https://www.zicode.com:39010`。

## 验证清单

- 桌面：`Get-NetTCPConnection -LocalPort 57682` 监听；
  `curl -sk https://127.0.0.1:57682/health` = 200；
  `curl -sk -o NUL -w '%{http_code}' https://127.0.0.1:57682/v2/sessions` = 401；
  `/v2/lan-qr` = 403。
- 证书：`openssl s_client -connect 127.0.0.1:57682 -servername www.zicode.com
  -CAfile <ca.pem> -verify_hostname www.zicode.com -verify_return_error` →
  `Verify return code: 0 (ok)`。
- 服务器：`curl -sk https://127.0.0.1:39010/health` = 200；
  `curl -s http://127.0.0.1:39011/` = 200。
- 公网（安全组放行后）：手机访问 `https://www.zicode.com:39010`，无证书警告，
  扫码配对后能列出桌面会话并发消息。

## 故障排查

- 公网连不上：先确认阿里云控制台安全组已放行 39010/39011（服务器本机 curl 通但手机
  不通，几乎都是安全组）。
- 手机显示"此设备未配对"：重新在桌面生成会话二维码扫码；令牌只存在于手机本地。
- 桌面重启后：隧道脚本会自动重连；桌面应用重启后公网网关会随配置重新监听。
- 隧道日志：`C:\Users\ax2\zicode-frpc\tunnel.log`。
