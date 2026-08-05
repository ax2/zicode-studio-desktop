# 2026-08-05 本地发布验证（M3/M4 后 release 构建）

本记录对应 M3 端到端加密与 M4 中继注册鉴权合入后的 Windows x64 release 构建
验证。构建方式与 2026-08-01 相同：`bun run build`（`tauri build --bundles nsis`，
含 beforeBuildCommand 的 vendor/pi/portable-git/webview2/bun 拉取，均命中本地
缓存）。

## 产物

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `target/release/zicode-studio-desktop.exe` | 41,097,728 B | `D9F4671E312784C00E66AB6317B0E10542776413586851D59B7229871821813E` |
| `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe` | 346,703,730 B | `8D498431177267CC8BA5C2233089CBCFFA7DC33084D7A309B224E33553751634` |
| `target/release/zicode-relay.exe`（内置中继） | 1,801,728 B | `2742DF2C132825F3B0EB0B022E5A5C3D4E8F6567462E22608CE8826D5E29F67B` |

未生成 ZIP（按项目约定保留完整可运行目录与 EXE/安装包）；安装包未做
Authenticode 签名，对外分发前仍需受控发布流水线配置代码签名证书。

## 冒烟验证（release EXE 独立启动）

- 进程启动正常，WebView2 窗口加载应用（CDP 可达，`document.title` =
  "ZiCode Studio Desktop"）；
- 本地严格网关 `/health` 200：`status=ok`、`protocolVersion=2`、
  `piVersion=0.83.0`、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`；
- 中继 Agent 注册：`/relay/status` 显示 `desktops:["dev-ax2-01"]`；
- 应用日志自启动以来无 ERROR/WARN/panic；
- 公网中继路径（PC 端移动模拟）：`/v2/bootstrap` 200 → WS `hello_ack` →
  `runtime_subscribe` 订阅成功，零错误；
- 模型链路（桌面 WebView 内发送消息）：`[model-gateway]`
  `POST /chat/completions` → `upstream 200 OK`，助手回复渲染到界面。

## 说明

- 本次验证使用 `target/release/zicode-studio-desktop.exe` 作为当前运行实例；
  桌面启动器已改为指向已安装的 release 路径。

## 安装器验证（2026-08-05 补充）

- 以 `/S` 静默运行 `ZiCode Studio Desktop_0.1.0_x64-setup.exe`，安装成功；
- 安装目录：`%LOCALAPPDATA%\ZiCode Studio Desktop\`，包含
  `zicode-studio-desktop.exe`（36,561,920 B，与构建产物一致）、
  `zicode-relay.exe`、`e2ee_key.exe`、`uninstall.exe`，以及
  `pi`（0.83.0）、`portable-git`、`webview2`、`bun`、`public`、
  `extensions` 资源；
- 从安装目录独立启动冒烟：进程正常、WebView2 加载、本地网关 `/health`
  200（pi 0.83.0、协议 v2）、中继注册 `dev-ax2-01`、日志无
  ERROR/WARN/panic；
- 桌面启动器 `启动 ZiCode Studio Desktop.cmd` 已由 `target/debug` 切换为
  安装目录 release 版。

## 二次构建（2026-08-05，含中继用量轮询）

- 在上一版基础上合入中继用量轮询与 `relayUsageBytes` 状态字段后重新构建并
  `/S` 重装；从安装目录启动冒烟通过（网关 `/health` 200、中继注册
  `dev-ax2-01`、日志无错误）；
- 状态接口实测返回 `relayUsageBytes`（当前为 `null`，待服务器中继部署新版
  上报 `usage` 后自动填充）；SHA-256 已更新为上表。

## 第三次重建（2026-08-05，含用量持久化与近 7 日历史 UI）

- 在上一版基础上合入：中继按日用量持久化（`ZICODE_RELAY_DATA_DIR`、
  30 天归档、`/relay/status` 返回 `usageHistory`，第 127 轮）、监控告警脚本
  （第 128 轮，脚本不入安装包）、设置面板近 7 日中继用量历史（第 129 轮）；
- 验证：
  - 内置 `zicode-relay.exe` 实测：注册鉴权 on、每日字节配额 1,000,000、
    `usage persistence: on`，`/relay/status` 返回
    `usage/usageDay/usageHistory` 四字段；
  - `/S` 静默安装后安装目录与 release 产物一致（EXE 同尺寸、中继同哈希；
    standalone EXE 会被 Tauri 在打包后打上 "bundle type" PE 补丁，因此不做
    逐字节比对），`public/` 含设置面板历史 UI 与中英文键；
  - 从安装目录独立启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、公网中继注册
    `dev-ax2-01`、启动后日志无 ERROR/WARN/panic；
  - 桌面快捷方式继续指向安装目录 release 版。

## 第五次重建（2026-08-05，含 STUN/TURN iceServers 注入）

- 在上一版基础上合入第 136 轮：`relayIceServers` 配置字段与
  `GET /v2/remote-config` 端点、手机端启动时拉取并注入 WebRTC ICE 候选；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希），
  `public/native/app.js` 含 `p2pEnabled` 与 `v2/remote-config` 拉取；
  从安装目录启动：网关 `/health` 200（pi 0.83.0、协议 v2）、公网中继注册
  `dev-ax2-01`、日志无 ERROR/WARN/panic；桌面快捷方式继续指向安装目录。

## 第八次重建（2026-08-06，含手机端直连徽标）

- 在上一版基础上合入第 148 轮：移动端连接状态条的"直连"徽标
  （`setP2pListener` + `mobile-connection-mode`）；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希），
  `public/native/features/mobile-experience.js` 含
  `mobile-connection-mode`；从安装目录启动：网关 `/health` 200（pi 0.83.0、
  协议 v2）、公网中继注册 `dev-ax2-01`、日志无 ERROR/WARN/panic；桌面
  快捷方式继续指向安装目录。

## 第七次重建（2026-08-06，含自动 TURN 凭据与设置 UI）

- 在上一版基础上合入第 145/146 轮：桌面端自动派生短期 TURN 凭据
  （`relayTurnUrl/Realm/Secret` + RFC 5389 HMAC）与设置面板
  "TURN 中继（可选）"配置 UI；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希），
  `public/native/settings/remote-access-settings.js` 含
  `TURN relay (optional)`；从安装目录启动：网关 `/health` 200（pi 0.83.0、
  协议 v2）、公网中继注册 `dev-ax2-01`、日志无 ERROR/WARN/panic；桌面
  快捷方式继续指向安装目录。

## 第六次重建（2026-08-05，含 P2P 有界重试）

- 在上一版基础上合入第 139 轮：移动端 P2P 失败后有界自动重试（每 60 秒、
  最多 5 次，旧网关拒绝不重试）；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希），
  `public/native/transport/runtime-adapter.js` 含重试逻辑；从安装目录启动：
  网关 `/health` 200（pi 0.83.0、协议 v2）、公网中继注册 `dev-ax2-01`、
  日志无 ERROR/WARN/panic；桌面快捷方式继续指向安装目录。

## 第四次重建（2026-08-05，含 M2 P2P 全链路）

- 在上一版基础上合入 M2：移动端 WebRTC 传输模块（第 131 轮）、桌面引擎
  webrtc-rs 0.13（第 132 轮）、网关 `/v2/ws` P2P 接线（第 133 轮）、移动端
  数据面切换（第 134 轮）；主程序因 webrtc 增大至 41,063,936 B；
- 验证：
  - release 模式编译通过（LTO + codegen-units=1，含 webrtc）；
  - `/S` 静默安装后安装目录与构建产物一致（EXE 同尺寸、中继同哈希），
    `public/` 含 `p2p.js`、`runtime-adapter.js`（`p2pEnabled`）与
    `app.js`（远程客户端启用标记）以及设置面板用量历史 UI；
  - 从安装目录独立启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、公网中继注册
    `dev-ax2-01`、启动后日志无 ERROR/WARN/panic；
  - 桌面快捷方式继续指向安装目录 release 版。
