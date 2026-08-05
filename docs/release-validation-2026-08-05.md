# 2026-08-05 本地发布验证（M3/M4 后 release 构建）

本记录对应 M3 端到端加密与 M4 中继注册鉴权合入后的 Windows x64 release 构建
验证。构建方式与 2026-08-01 相同：`bun run build`（`tauri build --bundles nsis`，
含 beforeBuildCommand 的 vendor/pi/portable-git/webview2/bun 拉取，均命中本地
缓存）。

## 产物

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `target/release/zicode-studio-desktop.exe` | 36,561,920 B | `AD227827661D826480B3E3D8E1F47D85C4A83023D3B25EE9A14CBA1880A7A2F9` |
| `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe` | 345,503,653 B | `458472A870F9AC23D78A280B4D1941DB0B93AD1F4A15255D418227F130115236` |

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
