# ZiCode 移动端公网接入：服务器会合架构（细化方案）

版本：v0.3 · 日期：2026-08-04 · 状态：M1 已部署到公网并经互联网链路验证，待手机真机验收

本文把"桌面端与移动端都主动连接服务器"的产品化方案细化为可落地架构。核心结论：
服务器只做**会合与转发**，不托管、不落盘、不解密内容；桌面始终是数据的唯一权威。
数据面按 M1（中转兜底）→ M2（P2P 直连）→ M3（端到端加密）分阶段演进，避免一步
到位的高风险改造。

## 1. 目标与非目标

### 目标

- 任何用户：手机在公网/异地访问自己的桌面，**零配置**（不装根证书、不开端口、
  不碰路由器）；
- 合规可商用：境内服务器、域名备案、隐私政策、代码签名，商业中转前完成资质评估；
- 保持"本地优先"：会话、笔记、文件只存在于用户桌面；服务器是通道，不是存储；
- 复用现有资产：配对/设备令牌/撤销体系、严格认证网关、响应式移动端前端。

### 非目标

- 不做云同步/云端工作区：桌面数据不镜像到服务器；
- 不做账号体系（第一阶段）：先以"配对码 + 设备令牌"代替账号；
- 不做原生 UI 重写：移动端用 WebView 壳打包现有前端；
- 不承诺 NAT 穿透 100% 成功：P2P 失败时由 TURN/中转兜底，但需说明延迟与流量成本。

## 2. 总体架构

```text
手机（任意网络）                服务器（境内）                桌面（用户家/办公室 NAT 后）
   │                              │                              │
   │ ① 控制面 WSS（会合/信令）      │ ① 控制面 WSS（注册/心跳）     │
   ├──────────────────────────────>│<─────────────────────────────┤
   │                              │                              │
   │ ② 数据面（P2P 优先）           │                              │
   ├──────────────────────────────►│◄─────────────────────────────┤
   │   WebRTC DataChannel          │   STUN 打洞/信令交换          │
   │   （打洞失败时走 TURN/中转）    │                              │
```

- **控制面**：两端与服务器保持长连接，用于注册在线状态、配对、数据面协商。
- **数据面**：会话/消息/笔记/文件流量。M1 直接走服务器中转；M2 起 P2P 直连优先，
  服务器只在打洞失败时兜底；M3 起数据面端到端加密，服务器只转发密文。
- **两端口径**：桌面和手机都只做**出站**连接，因此任何 NAT/防火墙/CGNAT 都可用。

## 3. 组件与职责

| 组件 | 载体 | 职责 |
| --- | --- | --- |
| 桌面出站 Agent | 集成进 Tauri 主程序（Rust，随主程序签名） | 连接服务器、注册可达性、转发数据面、代执行设备认证 |
| 服务器会合服务 | 境内云主机，WebSocket | 路由表、在线状态、配对转发、数据面协商 |
| STUN/TURN | coturn（境内） | NAT 地址发现；打洞失败时中继兜底 |
| 数据中转 | M1：frps 式 TCP/WSS 转发；M2+：TURN/自研 relay | 数据面兜底转发，无状态、不落盘 |
| 移动端 App | Android/iOS WebView 壳（Capacitor） | 打包现有 Web 前端；原生层做证书固定、TURN、后台 |
| 移动端 Web 前端 | 现有 `public/native` | 配对、会话、消息、笔记、文件 UI；传输层指向服务器 |

## 4. 连接与会合流程

### 4.1 桌面上线

1. 桌面启动后（远程访问开关打开），内置 Agent 向
   `wss://relay.remote.zicode.com/v1/rendezvous` 建立长连接；
2. 注册报文：`{ deviceId, desktopPublicKey, lanHint[], version }`；
3. 服务器登记"桌面在线"，返回会话标识；Agent 维持心跳（30s），断线自动重连
   （复用现有自愈思路）。

### 4.2 配对

1. 桌面"在手机上打开"时生成一次性配对码（沿用 RemoteAuth：5 分钟有效、单次、
   限流）并显示二维码/8 位短码；
2. 手机 App 输入短码或扫码 → 请求经服务器转发给对应桌面；
3. 桌面校验后签发设备令牌（哈希入库），服务器只转发结果，不持有令牌明文；
4. 手机保存设备令牌（App 本地），此后直接可用；撤销后 5 秒内断开（沿用现有机制）。

### 4.3 数据面建立

1. 手机持设备令牌请求会话 → 服务器告知两端彼此在线与连接偏好；
2. M1：服务器建立"手机 ↔ 桌面"转发通道（Token 校验后），流量直接中转；
3. M2+：两端交换 SDP/ICE 候选（经控制面），尝试 WebRTC P2P；
4. 打洞失败 → TURN 中继；仍失败 → 回退 M1 中转；
5. 桌面侧复用"严格认证"语义：来自服务器的请求仍须携带有效设备令牌，
   服务器不得获得回环豁免。

### 4.4 会话与自愈

- 桌面重启：Agent 重连服务器并恢复在线状态；手机侧复用现有 bootstrap 重试与
  WSS 重连重解析机制，无需手动刷新；
- 手机切网（Wi-Fi→4G）：App 控制面重连，数据面自动重协商；
- 桌面离线：服务器通知手机进入"桌面离线"状态，恢复后自动续接。

## 5. 协议与端口

| 用途 | 域名/端点 | 端口 | 说明 |
| --- | --- | --- | --- |
| 控制面 | `relay.remote.zicode.com` | 443 WSS | 注册、心跳、配对、数据面协商 |
| 数据面中转 | `relay.remote.zicode.com` | 443 WSS / 自定义 TCP | M1 必选，M2+ 兜底 |
| STUN | `turn.remote.zicode.com` | 3478 UDP/TCP | 地址发现 |
| TURN | `turn.remote.zicode.com` | 3478-3479（relay 区间） | 打洞失败中继 |
| 桌面 LAN/直连 | 现有 57652/57682 | — | 局域网直连保留，公网走服务器 |

协议要点：

- 控制面报文带版本号（可复用 `PROTOCOL_VERSION` 思路）与单调递增序号，防重放；
- 数据面帧：M1 为现有 WS 消息透传；M3 为加密帧（见第 6 节）；
- 所有公网端点使用 Let's Encrypt 自动续期证书；移动端原生层做证书固定。

## 6. 身份、配对与端到端加密

### 身份模型

- 桌面：启动时生成/持久化长期 **Ed25519 身份密钥**（存系统凭据库，同现有 CA 私钥
  存放策略），公钥经服务器注册；
- 手机：设备令牌（Random 256-bit，哈希入库）标识已配对设备；
- 服务器：只存"桌面 deviceId ↔ 在线会话"路由与配对转发状态，不存内容密钥。

### E2EE（M3）

推荐两条候选路径，M3 立项时二选一：

| 路径 | 加密 | 优点 | 代价 |
| --- | --- | --- | --- |
| WebRTC DataChannel | DTLS-SRTP/DTLS（内建） | P2P 与加密一并解决，业界成熟 | WebView 桥接复杂度高 |
| Noise 加密帧（`Noise_XK`） | X25519 + ChaCha20-Poly1305 | 协议简单、服务器可做密文中转 | 自研加密层需安全审计 |

密钥流程（以 Noise 为例）：配对时手机获得桌面公钥；每次会话建立执行一次握手，
派生会话密钥；每条数据帧 `nonce || ciphertext || mac`；密钥按连接轮换；
服务器只看到密文与路由元数据。

## 7. 服务器设计

### 7.1 部署形态

- 起步：单台境内云主机（与 www.zicode.com 同机房或独立），域名
  `remote.zicode.com`（ICP 备案）+ 子域 `relay.`/`turn.`；
- 组件容器化：`rendezvous`（自研，Go/Rust）、`coturn`、`relay`（M1 可先用 frps，
  M2+ 自研或 TURN）；
- 水平扩展：会合服务按 deviceId 分片；转发节点独立扩容；TURN 按带宽扩容。

### 7.2 无状态与日志

- 服务器不落盘任何会话内容；内存态仅含在线路由与限流计数；
- 日志只记录连接级元数据（时间、设备、字节量），内容级日志默认关闭；
- 提供 `/health` 与配额接口（每设备并发会话数、每用户月流量）。

### 7.3 容量与成本估算（单机起步）

- 每连接内存：~50KB（WebSocket 栈）→ 单机 1 万并发可用 8GB 内存支撑；
- 带宽：日常对话以文本为主（KB 级），附件上限 8MB；假设 1000 活跃用户、
  日均 100MB/户 → 峰值约 20Mbps，单台 5Mbps 上行云主机不够，需按量购买带宽
  或启用 P2P 直连降低中转流量；
- **P2P 直连是控制带宽成本的关键**：M2 落地后，中转流量只占打洞失败比例。

## 8. 移动端 App 方案

- Android/iOS 用 **Capacitor/WebView 壳**打包现有 `public/native` 前端，
  不重写 UI；
- 原生层提供：证书固定、TURN 配置注入、WebView 与原生 WebRTC 桥接（M2）、
  后台/推送（后期）；
- 传输适配：现有 `RemoteAccessGateway`/WS 代码增加"服务器模式"URL 解析
  （`wss://relay.remote.zicode.com/...`），鉴权头与配对逻辑不变；
- 上架注意：iOS App Store 对 WebView 壳有审核要求（功能完整性、无隐藏跳转），
  需保留清晰的产品功能路径。

## 9. 桌面端改造

- 新增"远程访问方式"配置：`仅局域网` / `经服务器（产品化）`；
- 内置出站 Agent（Rust 模块，非独立进程）：避免 frpc 式独立二进制被
  Defender 判 PUA；桌面二进制做 EV/OV 代码签名；
- 保留现有 57652/57682 与配对体系：局域网/直连路径不变，服务器路径复用
  同一套设备令牌校验（服务器转发请求时携带手机令牌，桌面按现有逻辑校验）；
- 自愈：复用 bootstrap 重试、WSS 重连重解析、UnknownInstance 重绑。

## 10. 安全模型与威胁分析

| 威胁 | 缓解 |
| --- | --- |
| 恶意/被入侵服务器 | 数据面 E2EE（M3）；服务器不持密钥；设备令牌仅哈希存储；撤销即断 |
| 中间人 | 移动端原生证书固定；桌面与手机握手相互认证（公钥签名） |
| 重放/篡改 | 帧序号 + MAC（M3）；控制面限流与令牌 |
| 恶意设备暴力配对 | 沿用 RemoteAuth 限流（每 IP 60 秒窗口最多 8 次失败）与单次配对 |
| 设备丢失 | 桌面端撤销设备（5 秒内断开）；可加远程"全部下线" |
| 中转滥用/流量盗刷 | 每设备并发上限、流量配额、Token 轮换 |

## 11. 合规清单（中国境内市场）

1. **备案**：`remote.zicode.com` 做 ICP 备案；上线后完成公安备案；
2. **资质评估**：向公众商业化提供内网穿透/中转服务，需评估增值电信业务
   许可（IDC/ISP 类）边界，商业化收费前咨询专业律师；
3. **PIPL**：隐私政策（通道性质、不存储内容、日志范围）、用户同意、
   数据最小化、设备撤销即撤回授权；
4. **数据出境**：控制面/转发/TURN 节点全部位于境内；
5. **代码签名**：桌面与移动端使用 EV/OV 证书签名，规避 SmartScreen/Defender；
6. **安全评估**：上线前完成渗透测试与密钥管理审计（M3 加密层必须有）。

## 12. 实施里程碑

### M1 最小闭环（目标：验证全链路，1-2 周）

- 服务器：rendezvous（WSS）+ 转发 + 真实证书 + 备案启动；
- 桌面：内置 Agent 出站连接 + "经服务器"配置；
- 移动：现有 Web 前端经中继访问（走中转，无 E2EE，文档明示）；
- 验收：公网/异地手机扫码配对 → 收发消息 → 撤销生效。

**M1 实施状态（2026-08-04）**：

- 中继服务已实现：`src-tauri/src/relay_server.rs` + `zicode-relay` 二进制，
  提供 `/relay/desktop`（桌面注册）、`/v2/ws`（移动端 WS 桥）、
  `/d/<deviceId>/...`（应用页 + cookie 路由）、任意路径 HTTP 代理、
  `/relay/status`（在线状态）；
- 桌面 Agent 已实现：`src-tauri/src/relay_client.rs`，出站连接中继、
  按需把 HTTP 请求与 WS 会话桥接到本地严格网关（57682），网关仍是认证权威；
- 协议帧：`src-tauri/src/relay_protocol.rs`（JSON，serde tag）；
- 配置字段：`relayEnabled` / `relayUrl` / `relayDeviceId`（写
  `%LOCALAPPDATA%\zicode\remote-access\config.json`），状态接口暴露；
- 本地闭环验证通过：应用页 200 + cookie → 配对换取设备令牌 →
  带令牌 `/v2/sessions`=200、`/v2/bootstrap` 返回 RuntimeTarget →
  无令牌 401 → WS 经中继与严格网关完成 `hello_ack`；
- 部署脚本：`scripts/relay/deploy-relay.sh`（服务器端构建 + systemd + nginx +
  certbot，独立构建中继 crate）。**已上线**：`relay.zicode.com` A 记录已生效，
  Let's Encrypt 证书已签发，系统服务 `zicode-relay` 运行中；
  公网验证通过：应用页 200、配对换令牌、带令牌 API 200、`wss://relay.zicode.com/v2/ws`
  返回 `hello_ack`；手机无需安装自定义根证书。

### M1 桌面端配置示例

```json
{
  "version": 1,
  "enabled": true,
  "publicUrl": "https://relay.zicode.com/d/dev-xxxxxxxx",
  "relayEnabled": true,
  "relayUrl": "wss://relay.zicode.com",
  "relayDeviceId": "dev-xxxxxxxx"
}
```

`publicUrl` 同时承担三件事：二维码/设置页展示的入口地址、证书 SAN 的公网主机名、
严格网关 WebSocket 的 Origin 白名单来源。`relayDeviceId` 启用时自动生成。

### M2 P2P 直连

- coturn + SDP/ICE 协商；P2P 成功则不占中转带宽；
- 验收：打洞成功率、中转流量占比报表。

### M3 端到端加密

- 数据面加密（WebRTC DTLS 或 Noise）；服务器零知识；
- 验收：抓包验证服务器仅见密文；密钥轮换与撤销后不可读。

**M3 实施状态（2026-08-05，桌面侧基础完成）**：

- 选型：**Noise_XK（X25519 + ChaCha20-Poly1305 + SHA256）**，加密层在桌面
  relay Agent 的会话桥接处终止——手机与桌面之间密文，桌面本机网关与 Agent
  之间明文（回环可信），中继只看到握手元数据与密文；
- 新增 `src-tauri/src/e2ee.rs`：桌面静态 X25519 身份（私钥存系统凭据库
  `remote-access-e2ee-identity-v1`，公钥用 x25519 派生）、Noise_XK 响应方/
  发起方、握手帧与密文帧封装（`e2ee_handshake` / `e2ee_frame`）；
- `relay_client.rs` 会话桥接支持 E2EE：首帧 `e2ee_handshake` 进入 Noise 握手，
  完成后数据面全部走 `e2ee_frame` 密文；未声明 E2EE 的客户端保持 M1 透明桥接
  （向后兼容）；
- 状态接口新增 `e2eePublicKey` / `e2eeFingerprint`，设置面板展示身份指纹；
- 测试：Rust 124 项通过（新增身份派生、错误静态密钥拒绝、双向加解密、
  帧封装 5 项）；
- 待办（M3.2，2026-08-05 已完成）：手机侧纯 JS 同步 Noise_XK 发起方
  （`public/native/transport/e2ee.js`：自实现 X25519 / ChaCha20-Poly1305 /
  SHA-256 / HKDF，全部通过 RFC 7748/8439/5869 向量与 snow 官方 cacophony
  向量逐字节对照）；配对链接/二维码经 `/v2/lan-qr` 携带桌面 E2EE 静态公钥
  （`ek` 参数），手机 `remote-auth.js` 配对时固定该公钥；移动端
  `HostRuntimeAdapter` 在连接中继时先完成 Noise_XK 握手，之后数据面全部
  走 `e2ee_frame` 密文；
- M3 验收（2026-08-05）：JS 发起方经公网中继对真实桌面（Rust 响应方）完成
  三段握手，加密 hello → 网关鉴权 → hello_ack、runtime_subscribe 均解密成功，
  零错误；上行帧全部为 `e2ee_handshake`/`e2ee_frame`，中继只见密文
  （零知识核验 PASS）。剩余：手机真机扫码配对验收（ADB 接入后）。

### M4 规模化与合规上线

- 多节点、配额、监控告警、隐私政策与资质落地、双端签名发布；
- 验收：压测（并发/带宽）、安全审计报告、合规文档齐备。

**M4 实施状态（2026-08-05，中继注册鉴权与配额第一步完成）**：

- `/relay/desktop` 注册增加鉴权：中继配置 `ZICODE_RELAY_REGISTRATION_TOKEN`
  后，桌面 Agent 注册必须携带相同令牌（桌面配置
  `relayRegistrationToken`），否则返回 `registration_rejected` 并断开；
  未配置令牌时保持开放模式（开发用，兼容旧部署）；
- 配额与防护：注册按源 IP 限流（默认 10 次/60 秒）、设备 ID 格式校验
  （非空、≤128、字母数字与 `-_`）、每设备并发移动会话上限（默认 16，
  超限返回 429）；
- 协议：`Hello` 帧新增可选 `registration_token`；新增
  `RegistrationRejected { reason }` 帧，桌面 Agent 收到后记录明确错误并
  停止重连（设置面板中继状态会显示原因）；
- 按设备字节流量配额（第二轮）：中继按设备累计双向中继字节（WS 帧 + HTTP
  代理请求/响应），按**天窗口**统计（跨天自动清零），配置
  `ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE`（每设备每日字节数）后超限设备的
  HTTP 代理返回 429、WS 会话收到 `device_quota_exceeded` 并关闭；
 `/relay/status` 返回 `usage`（设备 → 当日累计字节）与 `usageDay`
 （当天窗口标识）；用量默认内存态，配置 `ZICODE_RELAY_DATA_DIR` 后按日
 持久化：每 10 秒快照 `usage.json`，跨天自动归档为 `usage-<day>.json`
 （保留近 30 天），`/relay/status` 另返回 `usageHistory`（近 30 天按日
 归档），重启不再清零当日配额；
- 验证：Rust 新增 8 项中继测试（无/错令牌拒绝、正确令牌接受、畸形设备 ID
  拒绝、注册限流、会话上限、HTTP 字节配额 + 状态用量、WS 字节配额）+
  协议/配置测试，另含跨天重置用例；本地闭环实测无令牌/错令牌被拒、正确
  令牌 `welcome`、HTTP 超限 429、WS 收到 `device_quota_exceeded`、状态用量
  与 `usageDay` 正确；
- 部署步骤（生产启用）：服务器 systemd 单元加
 `Environment=ZICODE_RELAY_REGISTRATION_TOKEN=<secret>` 并重启
 `zicode-relay`；可选再加
 `Environment=ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE=<字节数>` 与
 `Environment=ZICODE_RELAY_DATA_DIR=/var/lib/zicode-relay`
 （`deploy-relay.sh` 默认写入，配合 systemd `StateDirectory=zicode-relay`）；
 桌面 `config.json` 加 `"relayRegistrationToken": "<同一 secret>"` 后重启
 桌面。**secret 不得写入文档/仓库**；
  - 监控告警：`scripts/relay/check-relay.sh --json` 输出机器可读结果，
    失败时经 `--alert-url`/`ZICODE_RELAY_ALERT_URL` POST JSON 告警；
    `scripts/relay/install-check.sh` 安装 systemd timer（每 5 分钟）。
  - 待办：多节点、M2 P2P 直连。

## 13. 与现有代码的复用清单

- `RemoteAuth`：配对令牌、设备令牌、撤销、限流（`src-tauri/src/remote_auth.rs`）；
- 严格认证语义：`authorize_public_http` / `websocket_upgrade_public`
  （`src-tauri/src/host_server.rs`）；
- 移动端前端：`public/native`（配对、会话、消息、笔记、文件）；
- 自愈机制：bootstrap 重试、WSS 重连重解析、UnknownInstance 重绑；
- 现有局域网/隧道方案（`docs/public-access-frp.md`）保留为开发者自用路径。

## 14. 开放问题（立项时决策）

1. E2EE 选型：WebRTC DataChannel vs Noise 加密帧；
2. 是否引入账号体系（M2+ 便于多设备/找回/配额）；
3. 一个用户多台桌面如何选择目标；
4. TURN 带宽成本模型与免费额度策略；
5. iOS 上架策略（TestFlight 先行 vs 正式商店）。
