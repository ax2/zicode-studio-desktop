# 2026-08-05 本地发布验证（M3/M4 后 release 构建）

本记录对应 M3 端到端加密与 M4 中继注册鉴权合入后的 Windows x64 release 构建
验证。构建方式与 2026-08-01 相同：`bun run build`（`tauri build --bundles nsis`，
含 beforeBuildCommand 的 vendor/pi/portable-git/webview2/bun 拉取，均命中本地
缓存）。

## 产物

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `target/release/zicode-studio-desktop.exe` | 41,099,776 B | `96A305BF0BF5F095068228FCF1BFF13BF2D86D961B33EAA1505560D48BDE53D5` |
| `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe` | 346,693,739 B | `5F0B101BBB9CEC2905F136DB59788E008D0252C7BB4360B9F64313A2EBC8F91F` |
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

## 第十次重建（2026-08-06，含直连徽标图标化）

- 在上一版基础上合入第 162 轮：左上角连接状态圆点下方的"直连"徽标改为
  **闪电图标**（14px 圆角、固定尺寸不换行，`aria-label` 保留语义）；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希），
  `mobile-experience.js` 含 SVG 图标徽标；从安装目录启动：网关 `/health`
  200（pi 0.83.0、协议 v2）、公网中继注册 `dev-ax2-01`、日志无
  ERROR/WARN/panic；桌面快捷方式继续指向安装目录。

## 第九次重建（2026-08-06，含中继半开连接自愈）

- 在上一版基础上合入第 152 轮：`KeepAlive` 心跳（桌面 30s 发送、120s 读超时
  重连）与中继应答，修复桌面↔中继半开连接导致桌面静默离线的问题；
- 验证：`/S` 静默重装后安装目录与产物一致（EXE 同尺寸、中继同哈希）；
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

## 第十一次重建（2026-08-08，含第 264–267 轮前端修复）

- 合入第 264–267 轮前端修复：桌面宽窗口内容列分档放宽（
  `--chat-content-max-width` 960→1120→1280→1440px、应用视图
  `--app-content-max-width` 1120→1200→1280→1360px）、笔记"带入
  对话"选中文字、桌面/移动端插件视图顶部避让（notes-main 类 +
  mobile plugin-main-view 68px padding）、Files 入口跨应用可达、
  service-worker Web Share Target 处理测试；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,316,864 B，
    SHA-256 `3DD8A158BEDD3C41BE29DC9D511AF286CA1F4D8240B9BAB57587557A7EC7D9B6`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,819,246 B，SHA-256
    `08980794FE889FF17D39D1B4327C1D6714EC237F74B1B910F9261531BDEA1479`
- 验证：
  - 打包进 EXE 的 public 资源与仓库逐文件哈希一致（style-theme.css、
    messages.css、composer.css、plugin-shell.js、notes-app.css、
    mobile.css 全部 match）；
  - `/S` 静默重装后安装目录与仓库 public 一致；从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - CDP 实测新实例：`--chat-content-max-width=1120px`、
    `--app-content-max-width=1200px`（1300 窗口）、设置视图点击
    Files 切回 Chat 并打开文件面板（round 266 行为）；日志无
    ERROR/WARN/panic。

## 第十二次重建（2026-08-08，含第 270–271 轮修复）

- 合入第 270 轮：relay 重写 PWA manifest 时把 `share_target.action`
  重写为设备作用域路径 `/d/{device}/app/share-target`，service-worker
  fetch 处理器同时匹配 LAN `/share-target` 与设备作用域路径；
- 合入第 271 轮：桌面宽窗口空间利用——桌面欢迎页垂直居中并新增快捷入口
  （开始新对话/项目/笔记/任务/自动化）、消息列/输入框/任务镜像面板留白
  封顶 96px（`--chat-gutter-max`）、新建工作区窗口默认 1440×900；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,316,864 B，
    SHA-256 `4ECBBF7896912055115F76D0C37D9A9B9008B4060B08BFC69D1F2A9C373398BD`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,872,608 B，SHA-256
    `6FEB2328513CCD1D5DCCFCC20937BC84EED894082CD37533C5522DAB6282CC3B`
- 验证：
  - 打包进 EXE 的 public 资源与仓库逐文件哈希一致（安装目录 297 个
    文件全部 match，含 i18n.js、style-theme.css、messages.css、
    composer.css、react/chat.js、message-renderer.css）；
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.83.0、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、公网
    中继注册 `dev-ax2-01`；
  - CDP 实测新实例：默认窗口 1440×900（`Browser.getWindowForTarget`
    bounds 1441×901）；空会话欢迎页垂直居中（1440 窗口 x=502、y=169、
    w=760），5 个快捷入口可见且可点（笔记→切到笔记应用、开始新对话→
    聚焦输入框）；最大化 2048×1210 时 messages padding=96px（留白
    封顶生效）、欢迎页居中于头部与输入框之间；日志无 ERROR/WARN/panic。

## 第十三次重建（2026-08-08，含第 273 轮插件应用 React 根失效修复）

- 合入第 273 轮：项目/任务/自动化/产物/金融五个插件应用接入共享挂载
  辅助（wrapper + 每次激活重建 React 根，`display: contents` 布局透明），
  plugin-shell `renderMain` 重置共享容器 className，消除切换应用后
  视图变空、`removeChild` 异常与 finance 类污染；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `2D55978FAB523CF1CD989E8057BBBB467876C54F7723F02451C67D471F446BE0`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,828,957 B，SHA-256
    `C7608238A1513DFA98D09DEE33C53859DC8B6A3716066CF50B480ABC6264CA35`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、默认窗口 1440×900；
  - CDP 两轮全应用切换（24 单元格）：0 空视图、0 finance 类污染、
    0 异常、0 控制台错误；日志无 ERROR/WARN/panic。

## 第十四次重建（2026-08-08，含第 275 轮移动弹层 Escape 关闭）

- 合入第 275 轮：笔记“移动到笔记本”弹层（MovePopover）补 keydown
  Escape 关闭分支，与其他弹层键盘约定一致；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `51B5EC6171A53A8000688DA811CF48D764438E0B2C5D128F01C867A69C7977E4`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,829,217 B，SHA-256
    `E93401708BCD1CB8E3FFBEFD02BC6E86A067B0600C2FCF3DAE5D51A3CCE8E0A7`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、默认窗口 1440×900；
  - CDP 实测移动弹层 Escape 关闭生效、应用快速切换 0 异常；日志无
    ERROR/WARN/panic。

## 第十五次重建（2026-08-09，含第 277 轮社区包目录并行加载）

- 合入第 277 轮：`fetchCatalog` 首页取 `totalPages` 后并行拉取剩余页
  （`Promise.all` 保持页序），社区包目录加载从串行 21 页（20–40 秒）
  降至亚秒级；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `87B2ADE997A1915AB426B42C81FC1BAD1DD2E46D00388555B769D8908E9A8E63`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,820,935 B，SHA-256
    `85ED4D59A81F7157D2EB72BE18158E77E71E0F8EE7B2DDD5D751EE71A272001C`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - CDP 实测扩展目录加载 6.4s 内就绪（并行优化前 20–40 秒），分页
    “1–50 of 5234” 正常；日志无 ERROR/WARN/panic。

## 第十六次重建（2026-08-09，含第 280 轮设置页 a11y 标签）

- 合入第 280 轮：设置页“自动压缩上下文/显示思考过程”两个 switch 补
  `aria-label`，“下次会话场景”下拉补 `aria-label`；新增回归断言；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `ED50BDFD96F3F719EF71CE860C6D17DA5C5D87854614BDECD355530F4E17A9FD`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,803,897 B，SHA-256
    `1D1A9F18B39E2C84D9675711047E79F80667CE5AEF62D9921A3E48930DC0543B`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - CDP 实测设置页开关读屏名与场景下拉 aria-label 生效；9 视图 a11y
    扫描 0 问题；日志无 ERROR/WARN/panic。

## 第十七次重建（2026-08-09，含第 282 轮命令面板焦点恢复）

- 合入第 282 轮：命令面板 `open()` 记录先前焦点（排除 body/html），
  `close()` 恢复原位否则回退命令按钮；新增回归测试；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `937F7D560218F56EF4B7BE19455AAFCB925F44E5011E73B1990FF721CB4407B6`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,856,567 B，SHA-256
    `B4F9964FF9736993549DB55D74CC04EFEF5C047C007E2648E27A644AE79E8EFC`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - CDP 实测输入框聚焦→Ctrl+Shift+P→Escape→焦点回到输入框；日志无
    ERROR/WARN/panic。

## 第十八次重建（2026-08-09，含第 284 轮设计 CSS 门禁清零）

- 合入第 284 轮：`session-sidebar.css` 字面量 `font-size: 12px` 改为
  设计令牌 `var(--font-size-sm)`，`check-design-css` 门禁首次全绿；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `E11AADE4404C7246AF0ABD098525AD3AF550DC6A0ABBACA63D13AE6F69D16819`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,864,649 B，SHA-256
    `0B5A7839422CF5338ACB6C34BAF9BF50E055F66CA5BA5C80F25A9EB7D758053A`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。

## 第四十七次重建（2026-08-09，含第 370 轮聊天底部对齐修复）

- 合入第 370 轮：短对话历史贴住 Composer（`.messages-bottom-aligned`，
  由 `syncMessagesAlignment` 在内容放得下时启用、溢出即移除），消除
  最后一条消息与输入区之间的死区；测量先归一化到顶流（Chromium 在
  flex-end 下低估 scrollHeight）避免长会话首屏被裁；前端 777 项
  （135 文件）全绿，typecheck/Biome/design 通过；
- 产物（第二次构建，含测量归一化修复）：
  - `target/release/zicode-studio-desktop.exe`：41,496,576 B，
    SHA-256 `DBFB723F41F92D4F7A0B3DB62D222F9F41584C8BDA12705E6239A314967091E8`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,918,375 B，SHA-256
    `C6238F862D7A7B7FE2AA3F0D192C13EF702BA7D0694DF6199CF335A46F1BDEC9`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `AE1A19BBA24EACBE16E12611A316B55B6D51E9FB0CAC3B3FE2BD40211F681D68`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - `/S` 静默重装后从安装目录启动，CDP 复验：长会话
    "你现在用的什么通道跟我对话？" `scrollH 2634>1210`、类关闭、
    滚动范围 1424px 首条可达；短会话"release冒烟：回复ok"类开启、
    最后一条消息结束于 y≈1056、Composer 顶 y≈1068（距 12px）；
  - 桌面欢迎页在开启类后仍居中铺满聊天列（自身 auto margin 不受影响）。

## 第四十八次重建（2026-08-09，含第 371 轮金融/产物空态垂直居中）

- 合入第 371 轮：金融工作台守卫卡与产物空态卡在只有单张卡片时
  垂直居中（`:has()` 限定 + `margin: auto`，与笔记空态一致），消除
  大桌面窗口下约 1000px 的顶部悬浮空白；新增 4 条布局契约断言；
  前端 778 项（135 文件）全绿，typecheck/Biome/design 通过；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,500,672 B，
    SHA-256 `5413E2E1BE4B1C7059F83DB40EE8C3A87A638F4EB536CA7A6F3E604A0CD50CC9`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,868,516 B，SHA-256
    `B4A46DF833CFCF422FD369D1DA04CD096E049B62E98FB6B160E32AA908729E72`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `BE0595A6AA6C0EFA2DF37FD40D17EDD57779D10A38743A6504FE13F89BE5E322`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - `/S` 静默重装后从安装目录启动，CDP 复验：金融守卫卡
    y≈522（上/下 522/525 对称）、产物空态卡 y≈544（544/552 对称）；
  - 全应用走查（对话/项目/任务/笔记/自动化/金融/产物/管理插件/设置/
    帮助）零控制台错误、无横向溢出。

## 第四十九/五十次重建（2026-08-10，含第 375 轮对话回答丢失 + 健康检查修复）

- 合入第 375 轮：
  - 流式助手消息收尾时把累计思考+正文写回 `message.content`，修复
    "回答只显示思考块、正文丢失"（会话 JSONL 数据完好，仅实时收尾丢
    渲染）；前端新增"思考+正文收尾保留正文"单测；
  - QVeris 渠道健康检查改走本地模型网关（`models.json` baseUrl +
    运行时实时 key，即桌面对话同一条路径），25 个模型有界并发（5 路）
    探测约 30s 完成；新增"健康检查走网关凭据"单测；
  - 前端 780 项（135 文件）全绿，typecheck/Biome 通过；
- 产物（第二次构建，含并发探测）：
  - `target/release/zicode-studio-desktop.exe`：41,500,672 B，
    SHA-256 `D627147D89CAB84B75BE90A62C34B0765C3BDE680B9577853F9B05A2F2DFBA90`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,919,140 B，SHA-256
    `212332F73041E75F180EBC8C5942837C9112A601C7A19ADA7023493CEBC5A25E`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `2A46ED662FFEBCF6C1F48B05549A86001CA8ECFA23EC50F25C5D7A77818BE5EC`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异），
    扩展 bundle 与仓库 dist 一致；
  - release 50 复验：对话"只回复 OK 即可"→ 回答正常渲染（思考块 +
    OK + 复制/存笔记/整理按钮）；健康检查 30s 内完成：
    "25 已启用 · 13 健康 · 12 异常"（claude-sonnet-4-5 与
    deepseek-v4-flash 健康 2–3s，deepseek-chat 等 404 为目录无效 id、
    deepseek-v4-pro 返回加密正文），模型链路与健康展示均真实。

## 第五十一次重建（2026-08-10，含第 376 轮健康探针预算修正）

- 合入第 376 轮：健康探针 `max_tokens` 16→128，给思考型模型
  （deepseek-v4-pro、gemini-2.5-pro、glm-5.2、kimi-k2.x/k3、
  minimax-m2.7/m3 等）留出正文预算，消除"无正文"误报；单测断言
  探针请求体 `"max_tokens":128`；前端 780 项（135 文件）全绿，
  typecheck/Biome 通过；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,500,672 B，
    SHA-256 `C4255C0C2F6647C7AB34343EE6C3E3FF3A8E79A755D2842C394F7CDB0D7B7448`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,897,924 B，SHA-256
    `9B4829475398913935B7A62ACC7C59AD7DAD36DBD8E2AE471D676B7AC41ED623`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `2058EC22D26D3A549E9CC4E5B770DD60F404B762253E122F0E1E419C4892685F`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异），
    扩展 bundle 与仓库 dist 一致；
  - release 51 复验：健康检查 30s 内完成，"25 已启用 · 22 健康 ·
    3 异常"——思考型模型全部转健康，剩余 3 个为网关不接受的目录
    别名 id（404 model_not_found），健康展示真实。

## 第五十二次重建（2026-08-10，含第 377 轮"整理对话为笔记"修复）

- 合入第 377 轮：
  - `handleRuntimeEvent` 在 `message_start`（user）与 `message_end`
    （assistant）把实时消息追加进 `currentHistoryMessages`（按 id
    去重），`buildConversationTranscript` 因此能拿到完整实时对话，
    修复新会话整理时报"当前没有可整理的对话"；
  - `showError` 不再把状态置为"已断开"（状态只反映 WebSocket 真实
    连接，由适配器监听维护）；
  - 前端 780 项（135 文件）全绿，typecheck/Biome 通过；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,500,672 B，
    SHA-256 `04D72D628FF06F569F599C8E924E3657A0FB55C87E65ECCA7FD34F615B1C0CC9`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,889,737 B，SHA-256
    `56205821C16CF0F97902C90E1F3636B048161E51B22FACFE2D5FF7BCF2FDD0D9`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `565E05A63DAB0C760DC990B6607FE97A283E72EE95A9F32DAE6A8DF9943AD50C`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）、
    扩展 bundle 与仓库 dist 一致；
  - release 52 复验：新会话发问→回答→点"整理为笔记"→约 14s 自动切到
    笔记并打开新笔记（标题=首问、标签 captured/chat、正文含摘要/要点
    结构化整理）；测试笔记删除后 QVeris 恢复 5 篇、回收站 0。

## 第五十三次重建（2026-08-10，含第 379 轮无效模型别名自动隐藏）

- 合入第 379 轮：`check_model_health` 对返回 404 `model_not_found`
  （确定性"该 id 不存在"）的模型调用 `setVisibility(false)`，模型
  下拉经 `applyConfiguredModelVisibility` 自动移除这些条目（配置页
  模型列表仍可见、可手动重新启用）；新增单测；前端 780 项全绿；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,500,672 B，
    SHA-256 `D60140BAA1B539E41614F348BC5FB44D48EC5D900B70870514FA04BE2BC273F5`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,929,118 B，SHA-256
    `925FB50E5F66E4FD58C25D064C0F5128895EEBF21E25E61D0055079DF152DF15`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `AF4A51CC18889FC2D817D870685252F69220AE3F995B75B1399648A1AAD5C557`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）、
    扩展 bundle 与仓库 dist 一致；
  - 健康检查后 `picot-models.json` 三个别名 visibility=false，页面
    刷新后模型下拉 23 项（22 个可用模型 + 当前选择），deepseek-chat /
    deepseek/deepseek-chat / openrouter/deepseek-chat 不再出现。

## 第五十四/五十五次重建（2026-08-10，pi 0.83.0 → 0.84.1）

- 合入：`scripts/pi-version.json` 锁定 0.84.1（六平台 SHA-256），
  `src-tauri/resources/pi` 解压 0.84.1 二进制，RPC 契约 fixture
  `tests/fixtures/pi-rpc/0.84.1/`；
- 0.84.1 兼容修复（模型链路曾报 "Provider is not configured:
  qveris"）：`credential_broker::scene_provider_credentials` 读取场景
  OS 凭据，`runtime_isolation` 以 `<PROVIDER>_API_KEY` 注入 pi 子进程
  环境；`picot-config` 的 qveris models.json 增加
  `apiKey: "$QVERIS_API_KEY"` 引用（ensure/sync 自动补齐）；新增
  apiKey 引用单测；前端 782 项、Rust 150 项全绿；
- 产物（第二次构建，含凭据注入）：
  - `target/release/zicode-studio-desktop.exe`：41,504,256 B，
    SHA-256 `CFE9769C92DA1FDAA8830761C0EAC49EC74147C0C8411A96CCA0A40A34EBCF86`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,777,811 B，SHA-256
    `F57B852ECED68E309152B7EA65D72669A03BF84D89B48694B66DDBF31764A304`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `857C050A54597278DAC89A075292DD1C52AF6206D1B21DAB24AFD9910553DE86`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）、
    安装目录 pi `.version`=0.84.1、`/health` piVersion 0.84.1；
  - 对话冒烟：消息 → 回答正常渲染，`[model-gateway]` 日志
    `auth=Bearer sk-C585XI…` + 上游 200 OK（0.84.1 经 env+apiKey
    引用解析到密钥）；健康检查"22 健康 · 3 异常"（3 个为已隐藏的
    无效别名）。

## 第五十六/五十七/五十八次重建（2026-08-10，第 382 轮桌面交互修复）

- 合入第 382 轮：
  - 工作区：实测"将文件夹作为工作区打开"当前窗口就地切换；新增
    "切换工作区"菜单（`list_workspaces` 命令 + 侧栏按钮，点击就地
    切换，Esc/外部点击关闭；第三、四次重建补 ACL 与路径显示修正）；
  - 文件右侧侧边栏实底背景、侧栏/功能区 `overflow-x: hidden`、
    设置移除"返回对话"入口、已归档默认折叠、"删除全部已归档"按钮
    svg 尺寸修复；
  - 前端 782 项、Rust 150 项、typecheck/Biome/clippy/fmt 全绿；
- 产物（最终，release 58）：
  - `target/release/zicode-studio-desktop.exe`：41,518,592 B，
    SHA-256 `D8DFE86AFBD728D400203FBEBCF932E9285986F004BF285B477FE5FFDF9990A7`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,766,650 B，SHA-256
    `5951741E9C6A4EA632C546356B4C44EC3956416D3D04FB32E336CDA091A439D3`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `3C2999C9B62E496E47C26A06351BA843DB8D080F874CEEDDD7D8128F31C1CE82`
- 验证：
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - release 58 实测：切换器列出全部工作区（ax2/work/cloud_store/
    zicode-studio-desktop，路径无 `\\?\` 前缀）并可就地切换；文件
    侧栏实底、归档折叠、设置无返回入口均符合预期。

## 第九十九次重建（2026-08-12，第 439 轮本地化契约）

- 合入第 439 轮：
  - `markdown.js` 表格 `aria-label` 改走 `t("Scrollable table")`；
  - 新增 `public/native/localization-contract.test.js`（4 项）锁定
    markdown 复制文案/super-agent 标签/bootstrap 中文分支走 t()；
  - 门禁：前端 852 项、Rust 192 项、typecheck/Biome 459 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 99）：
  - `target/release/zicode-studio-desktop.exe`：41,969,152 B，
    SHA-256 `608C8FF948ED7E7F280501248FFDFEA5AD14E4EAD6A46E16D614A9994EFD86C5`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,993,237 B，SHA-256
    `B8ED75551B701FC9709AB9BD38120E98BD6C531327CC7F683425FB522F3230FC`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `319C7CF1CA2D78CAAC40D0E2A53C9929FC845EF29280A10672D23E93C3C80A6D`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 本地化契约测试全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百次重建（2026-08-12，第 440 轮 React 文案本地化）

- 合入第 440 轮：
  - 上下文窗口图例标签 "Cached (reused)"/"Uncached"/"Available"、
    "{percent}% used" 后缀、空用量 title "Context usage" 改走共享
    t() 管道（`contextUsageLogic.ts`/`ContextUsageApp.tsx`/`index.ts`）；
  - 输入队列 "Steering"/"Follow-up" 与通知兜底 "Notification" 标题
    补 i18n 键并走 t()（`ComposerApp.tsx`/`notificationCenter/index.ts`）；
  - i18n 新增 7 键；localization-contract 测试扩至 5 项锁定 React 源
    与 bundle 无裸英文；重新生成 context-usage/composer/
    notification-center bundle；
  - 门禁：前端 855 项（139 文件）、typecheck/Biome 全绿；
- 产物（release 100）：
  - `target/release/zicode-studio-desktop.exe`：41,969,152 B，
    SHA-256 `A825C4BDCD56284D2DE8F3D5AA71ED12CC13170C5D8723A02EEFE917D92358BF`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,010,945 B，SHA-256
    `69FE959B14606654C07D4DE54104EE3A91E074536F6743F6273054120E9FC4CB`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `2217CA18B363B97AAF38E8734954BBD3CF2FB8ADDB9C0871DA9EE04613B00485`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - 公网中继 `/relay/status` 显示 `dev-ax2-01` 在线；
  - 本地化契约与前端 855 项测试全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百零一次重建（2026-08-12，第 441 轮任务事件本地化）

- 合入第 441 轮：
  - `task-state.js` 事件消息创建时走 t() 并替换
    {port}/{session}/{status} 占位（派发/子会话绑定/完成/暂停/恢复/
    取消 8 类模板），共享 `i18n` 三端同一实例；
  - `super-agent-runtime.js` 加载态/空态本地化（"Connecting..."/带
    状态空态键），两个历史列表渲染 t() 兜底；
  - i18n 新增 12 键；localization-contract 测试扩至 6 项；重新生成
    tasks bundle；
  - 门禁：前端 856 项（139 文件）、typecheck/Biome/design 全绿；
- 产物（release 101）：
  - `target/release/zicode-studio-desktop.exe`：41,973,248 B，
    SHA-256 `C5AE4B799185AD6FF43E8159053B0A22A5A198BCA1C9D177CB87511E583B94C9`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,032,780 B，SHA-256
    `EB4C9056C4A2228F4D5931AAD7D93CB28150246F38CB5EA20BEC6F0B196EEE5F`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `FD895DDD427316F80B8BDBCB69CC76098764AAEE21506C0BB1C3EA03BFD4C6D6`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - 公网中继 `/relay/status` 显示 `dev-ax2-01` 在线；
  - 本地化契约与前端 856 项测试全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百零二次重建（2026-08-12，第 442 轮插件/灯箱英文清理）

- 合入第 442 轮：
  - `plugin-shell.js` 命令面板条目 `desc` 改走 `t(plugin.description)`，
    插件功能区侧栏 aria-label 改走 `t("Plugin views")`；
  - `image-lightbox.js` 预览弹层与关闭按钮 aria-label 走 t()，新增
    "Image preview" 键；
  - localization-contract 测试扩至 7 项锁定三处不再裸英文；
  - 门禁：前端 857 项（139 文件）、typecheck/Biome 全绿；
- 产物（release 102）：
  - `target/release/zicode-studio-desktop.exe`：41,973,248 B，
    SHA-256 `09E6AABE17C20E1B9ED0CF9C8C1D5B165BF52E608BAD857DB41F2F53EC1E6040`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,018,902 B，SHA-256
    `2DB759FD1BDB60A8F684A6E02C6BE43A64032EA3C7DC5B455C5657FC57C57276`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `CD54DD906C15BECA8680B2D26C161A16D0F85F495D8A9181A48E05A708313320`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - 本地化契约与前端 857 项测试全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百零三次重建（2026-08-12，第 444 轮自动化命令面板文案）

- 合入第 444 轮：
  - i18n 补 3 键："Open automations"（打开自动化）、自动化插件描述、
    "Plugin view"（插件视图）；
  - localization-contract 测试改为全量校验 plugin-registry 展示字符串
    均有词典键（扩至 8 项）；前端 858 项（139 文件）、typecheck/Biome
    全绿；
  - CDP 移动视口（390×844）遍历 12 视图 0 横向溢出/0 控制台错误，
    命令面板实测显示"自动化: 打开自动化…"；
- 产物（release 103）：
  - `target/release/zicode-studio-desktop.exe`：41,973,248 B，
    SHA-256 `FBD4344276C6F67B0647136D8D80158B1EA1FB32AF18539F247FD3F0B74B2D9F`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,013,194 B，SHA-256
    `A2406A36D5C6A9A23AAA6475864479302423245B56D6F1C1E34876F50D0E03B5`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `AB1859CABF7C444A011051CDE5989EC776277AEED7DEB235FF8A5CC084C3A66E`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - 本地化契约与前端 858 项测试全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百零四次重建（2026-08-13，第 445 轮会话菜单本地化）

- 合入第 445 轮：
  - `SessionSidebarApp.tsx` 会话/项目右键菜单渲染改 `t(row.label)`；
  - i18n 补 "Archive all sessions" 键；
  - localization-contract 测试扩至 9 项（全量校验侧栏 label 词典
    覆盖）；前端 859 项（139 文件）、typecheck/Biome 全绿；
  - 数据链路实测：笔记编辑自动保存落盘（frontmatter + changes.jsonl
    版本哈希），主题切换即时生效且刷新后持久，均 0 控制台错误；
- 产物（release 104）：
  - `target/release/zicode-studio-desktop.exe`：41,973,248 B，
    SHA-256 `EAF31DE26D43C0AAE85346D9BFB548931E62E3C27B58B4EECE1FA94CFE3EB0D5`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,031,649 B，SHA-256
    `0852C30010D02D908B94A4993264410B9A2F77A601A12506439F8A972B5D6F7A`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `7CB0FAD228522AE90BEA425231736E3E9F54AEB659D18C2A2C0FC3A835B91916`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - 本地化契约与前端 859 项测试全绿；
  - CDP 实测会话右键菜单显示收藏/归档/重命名/导出为 Markdown；
  - 运行期日志无 ERROR/WARN/panic。

## 第一百零五次重建（2026-08-13，第 448 轮 RPC 桥自愈）

- 合入第 448 轮：
  - `NativePiManager` 保存 launch spec；请求遇 `BridgeError::ProcessClosed`
    时自动移除死运行时、按原 spec 重建 pi 并重试一次（同一实例
    10s 节流防抖）；
  - 新增单测覆盖无 spec 重建报错与死运行时确定性失败路径；
  - 门禁：Rust 193 项（169+19+5，另 2 忽略）、Clippy warnings-as-errors、
    fmt、前端 860 项（139 文件）全绿；
- 产物（release 105）：
  - `target/release/zicode-studio-desktop.exe`：41,985,536 B，
    SHA-256 `7FE48AD9F0FC49141599554F405F88CC16C074C57EF9BA321B46E567E7F2C214`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,008,524 B，SHA-256
    `D416D8632BBCB0F8621FEFD17089E01F2AD612CFA4FAAC20173FCD069EF6C241`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `FF2A42DD2CD80C36E905304A908ECE2547D14A68EC79765B8A7F57B85B4FDC24`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 300 文件逐文件一致（0 缺失/0 哈希差异），
    安装目录中继与 release 产物同哈希；
  - CDP 实测启动后 automation_workspace RPC 返回 ok、自动化视图显示
    正确空态（修复前为"无法加载自动化/Pi 运行时连接已断开"）；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十八次重建（2026-08-12，第 438 轮启动失败页本地化）

- 合入第 438 轮：
  - `public/bootstrap.html` 按 `zicode-studio-locale` cookie /
    navigator.language 切换中/英文（标题/正文/重试按钮）；
  - i18n 补 "Download and install update" 键；
  - 门禁：前端 848 项、Rust 192 项、typecheck/Biome 458 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 98）：
  - `target/release/zicode-studio-desktop.exe`：41,969,152 B，
    SHA-256 `C22DB1EA0DFC02BF22D5BAD3193449853AD3C76DD7653A5EFC9FB6775A4DF694`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,957,837 B，SHA-256
    `26D5BBD4EF545C9474CD62C3F58FD65C5F712D4840F961952BAADA126C18E8D1`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `A66AF0BCA6DD96B3C86FC548EA6CFB7BC4CB9E1C8B10ABAC784DE9D2D0160797`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测 bootstrap 页 zh 渲染：title/h1"无法启动"、按钮
    "重试启动"、lang zh-CN；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十七次重建（2026-08-12，第 437 轮复制状态本地化）

- 合入第 437 轮：
  - `public/ui/markdown.js` 代码块复制按钮与状态全部改走 `t()`
    （Copy/Copying…/Copied/Code copied/Copy failed/剪贴板权限提示），
    覆盖对话/笔记/产物/帮助共享渲染；
  - `ChatMessageList.tsx` 工具卡片复制输出状态改走 `t()`；
  - markdown 单测更新为中文断言；门禁：前端 848 项、Rust 192 项、
    typecheck/Biome 458 文件/design/Tauri 权限 24 条全绿；
- 产物（release 97）：
  - `target/release/zicode-studio-desktop.exe`：41,969,152 B，
    SHA-256 `CF5CFF1559E53930072A69841897157D20E0299855D15B4250C85C4A9D75983F`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,997,557 B，SHA-256
    `49A1EACCCD24EDA8F4751DAA173FF5147502E60BA6148C67EF3E97D19D1DCAD6`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `A24D0DDFC0F4588653D9F08143A430349D8528C993054E77105574475F93CD4E`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - markdown 单测断言复制按钮/状态为中文（复制代码/已复制/复制/
    复制失败/请检查浏览器剪贴板权限）全绿；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十六次重建（2026-08-12，第 436 轮香草组件本地化）

- 合入第 436 轮：
  - `super-agent-runtime.js`/`super-agent-entry.js`/`sa-chat-header.js`
    可见英文标签全部改走 `t()`（任务/筛选/强制取消/清除/历史/查看
    会话/目标/项目/重试/正在聆听/AGENT INBOX 等）；i18n 补 8 键；
  - 门禁：前端 848 项、Rust 192 项、typecheck/Biome 458 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 96）：
  - `target/release/zicode-studio-desktop.exe`：41,870,848 B，
    SHA-256 `89DC060282398EF0F84A52B26D223D5671405947CBAECC5A88046751F3BB21DC`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,855,875 B，SHA-256
    `1E22E2867BC91FD315DDFBF54CB569DC5BBFACA535E2E88C7FF4DC9D96C18B86`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `18FFE5F527BA760ED8FF924488555B93427BB165C4BECF3A7EDFB71DFBDA0033`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：任务面板标题"任务"、筛选"全部/等待中/运行中/完成"、
    头部状态"正在聆听"，可见文本无硬编码英文标签、0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十五次重建（2026-08-12，第 435 轮收件箱断连本地化）

- 合入第 435 轮：
  - `chat-settings-panel.js` 的 `messageFromError` 对 ProcessClosed
    返回本地化文案"Pi 运行时连接已断开。新建一个会话即可恢复连接。"；
  - 新增单测（配置网关返回 ProcessClosed → 状态区显示中文友好文案）；
  - 门禁：前端 848 项、Rust 192 项、typecheck/Biome 458 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 95）：
  - `target/release/zicode-studio-desktop.exe`：41,870,848 B，
    SHA-256 `645B67FA92D0F383FDEEB4849D79D3746509A27E72B921E7D967E01D9985F7FC`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,932,182 B，SHA-256
    `50C52143D000D9731A07A60E3E3AD89C8C6BEE7019212DF28F0C0C3682DA9CE9`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `F7BC8182FEBF1A69AA8B8A830DD509473C1C149FE9AAE4241BAE4EE3A462837D`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：全 DOM 无原始 ProcessClosed，智能收件箱状态显示
    "Pi 运行时连接已断开。新建一个会话即可恢复连接。"，0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十四次重建（2026-08-12，第 434 轮配置页断连本地化）

- 合入第 434 轮：
  - `configStore` 增加 `localizeError`，把模型提供方/渠道加载、密钥
    保存、渠道移除/保存、健康检查、智能体/模型配置编辑器、系统凭据
    移除提示等全部展示型错误统一经 `localizeHostError` 本地化；
  - 补 11 个中文兜底文案；新增 catalog/channel 断连本地化单测 2 项；
  - 门禁：前端 847 项、Rust 192 项、typecheck/Biome 458 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 94）：
  - `target/release/zicode-studio-desktop.exe`：41,870,848 B，
    SHA-256 `E886CCF69E4D86D1A626749D8FB69FD4A7DEB31E87496087A354691D0FFB6957`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,880,395 B，SHA-256
    `DB1E8FC49488B0C06EAF0C2879F5D446FBC4C6BC843EEEF91786D3C4ABD558E5`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `1F0B1D89121368977E73017FDB7D5BF8E267060A094BF686A39E6B1947522C3D`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：设置 → 配置页全部错误位显示
    "Pi 运行时连接已断开。新建一个会话即可恢复连接。"，无原始
    ProcessClosed，0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十三次重建（2026-08-12，第 431/432 轮帮助文档与维护）

- 合入第 431/432 轮（无运行时代码改动）：
  - `public/help/security-data.md`（zh/en）新增"工作区数据快照"章节
    与"回收站 + 快照 + 导出"三层数据保护说明；
  - 第 429 轮性能基准脚本改为不依赖具体笔记本名；
  - 门禁：前端 845 项、Rust 192 项、typecheck/Biome 458 文件/design/
    Tauri 权限 24 条全绿；
- 产物（release 93）：
  - `target/release/zicode-studio-desktop.exe`：41,870,848 B，
    SHA-256 `3E79C47884ECB8FEE66A171DEF5E32C61E712444231EF68306D20D4ADDEC0C2D`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,857,707 B，SHA-256
    `4EA8B6BF4B886CF956BCC9713D50BF62B36A188BC89276DC1C37D015E55A6DE9`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `A4E21C7C39A4AF29701E04FA94C2DC1B1B73F1BC9820F8AF5A6BB2FF3BC315E8`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - HTTP 实测帮助文章含"工作区数据快照"新章节；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十二次重建（2026-08-12，第 428 轮备份恢复闭环）

- 合入第 428 轮：
  - Rust `restore_workspace_backup`：把快照中的
    {sessions,notes,artifacts,tasks,automation,finance} 复制回
    `<工作区>/.zicode/`（替换现有目录），恢复前自动快照当前状态；
  - Tauri 命令 `restore_workspace_backup` + 权限 1 条（共 24 条）；
  - 前端：备份列表新增"恢复"（确认文案 + 重启提示）；backupStore
    恢复测试 1 项；
  - 门禁：前端 845 项、Rust 192 项（168+19+5，另 2 项忽略）、
    typecheck/Biome 458 文件/design/Tauri 权限 24 条/clippy/fmt 全绿；
- 产物（release 92）：
  - `target/release/zicode-studio-desktop.exe`：41,870,848 B，
    SHA-256 `B77117C82A721321B073F4DA413B6A04ED51BB1A06356E9A6354594BDA4103EE`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,880,740 B，SHA-256
    `0B45D870F239578AFF37BBAB4B47A0D1E86F9158FC117DF842D84A7BC6A492C9`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `E81B1D76636313459CE3C1B28C5AFC94C7B4CB6DC5803065E8042AF17BD3D854`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：建测试笔记本+笔记→手动备份→删除笔记本→"恢复"确认
    文案正确（拒绝保留、接受执行）→状态提示重启→笔记应用恢复出
    笔记本→清理测试数据后回到测试前状态；全程 0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十一次重建（2026-08-12，第 427 轮工作区数据自动备份）

- 合入第 427 轮：
  - Rust `backup_store.rs`：`<工作区>/.zicode/{sessions,notes,artifacts,
    tasks,automation,finance}` 快照到 `~/.zicode/backups/<workspaceId>/
    <时间戳>/`，backup.json 元数据，每工作区保留 7 份；启动时
    `backup_if_due`（每天最多一次）自动快照并记日志；
  - Tauri 命令 `create/list/delete_workspace_backup`（按工作区 id
    解析根路径，删除校验 id 防路径穿越）+ 权限 3 条（共 23 条）；
  - 前端：设置 → 通用 → 数据新增"工作区数据备份"（立即备份、最近
    备份、列表、删除确认）；backupStore + 4 项测试；
  - 门禁：前端 844 项、Rust 191 项（167+19+5，另 2 项忽略）、
    typecheck/Biome 458 文件/design/Tauri 权限 23 条/clippy/fmt 全绿；
- 产物（release 91）：
  - `target/release/zicode-studio-desktop.exe`：41,853,952 B，
    SHA-256 `A108E7A548EB193C04FC3F2A966DEEAE7344B5509CBAF4A680D56840CE539579`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,921,298 B，SHA-256
    `277B2C50CCDC544B5883379FA3105AAF021436340A63A9973F9BEFB7DC4D4F54`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `F7C522ECA8EB30EA9758A126C6C6EF74AA1176E9B16B52E5632140F2661616E0`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；启动
    日志含 "created workspace backup …（3 apps, 0 bytes）"；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：设置 → 通用 → 数据备份区显示自动备份；"立即备份"后
    列表新增一条（时间/大小/应用清单）；删除备份 confirm 文案
    "删除工作区备份 …? 此操作无法撤销。"，拒绝保留、接受移除；均
    0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第九十次重建（2026-08-12，第 426 轮数据安全审计）

- 合入第 426 轮：
  - 自动化 `removeWorkflow` 增加 confirmRemove（默认
    `globalThis.confirm`），拒绝跳过；消息
    "移除自动化 “标题”? 此操作无法撤销。"；
  - 会话侧栏 `deleteArchivedSession` 增加 confirm（默认
    `globalThis.confirm`），与"删除全部已归档"行为一致；消息
    "删除会话 “标题”? 这将永久删除该对话，且无法撤销。"；
  - 测试：自动化拒绝/接受 2 项、会话拒绝 1 项；前端 840 项、
    typecheck/Biome 456 文件/design 全绿（本轮无 Rust 改动）；
- 产物（release 90）：
  - `target/release/zicode-studio-desktop.exe`：41,774,080 B，
    SHA-256 `40B49FAB0B644E459747C5ED9D3CBB7FC58AD11A62DCF9E30793561D477AEAE7`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,817,615 B，SHA-256
    `1A1DCF635C568E867C05DE8E0ADDDB2E1E538AE5937B351CB7D1BC6FF995A9C6`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `3937D0798125DFF91F22C4EC5829B2817670CD601B70E96C33A91F54078B186A`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：自动化创建测试流程→"移除"→confirm 文案正确、拒绝保留、
    接受移除并清理；真实会话归档→"删除"→confirm 文案正确、拒绝保留、
    取消归档恢复；均 0 控制台错误；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十九次重建（2026-08-12，第 425 轮笔记本删除可恢复）

- 合入第 425 轮：
  - Rust：`delete_notebook` 改为回收站语义——整棵子树（含嵌套笔记本）
    笔记先移入各自 `.trash`，vault 目录移入
    `<工作区>/.zicode/notes/.deleted/<id>`；`list_trash` 扫描活动 +
    已删除笔记本（`TrashEntry` 增加 `notebookTitle`）；`restore_note`
    对已删除笔记本先整体还原再恢复笔记；清空回收站/保留期后移除空的
    已删除笔记本目录；
  - 前端：回收站显示来源笔记本名（已删除笔记本用 `notebookTitle`
    兜底）、确认与提示文案改为"移入回收站，可在回收站恢复"；
  - 测试：删除→回收站→恢复→清空闭环、嵌套笔记本整树删除 2 项新增；
    前端 837 项、Rust 187 项（163+19+5，另 2 项忽略）、
    typecheck/Biome 456 文件/design/clippy/fmt 全绿；
- 产物（release 89）：
  - `target/release/zicode-studio-desktop.exe`：41,774,080 B，
    SHA-256 `6028C56099D6B6FB4B18268798FCA0453694C103CF1886CA6DCB166C5A18B515`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,828,310 B，SHA-256
    `3953C2E8AE7A9369F5DCBCF0EC684657FF2B99F7E327CB8B67678CEDA064B85F`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `5120162AEAB21D871737CCE4DB0FDB329DF7D77785FFD471BD0AECCE7C6AA9BF`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：新建测试笔记本→建笔记→删除→回收站显示
    "无标题笔记 · zsd-425 回收站测试 · 已删除"→恢复后笔记本回归→
    再次删除→清空回收站→磁盘 `.deleted` 为空、changes.jsonl 记录
    created/deleted/restored/deleted/purged 全链路；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十八次重建（2026-08-12，第 423 轮 TURN 连接自测）

- 合入第 423 轮：
  - Rust `turn_probe.rs`：coturn auth-secret 短期凭据派生 + STUN
    Allocation 双向往返（无认证 401 质询 → realm/nonce +
    `MD5(username:realm:credential)` message-integrity 重发）；
    `host_server` 新增 `probe_turn` RPC（spawn_blocking，不回传密钥）；
  - 前端：RemoteAccessGateway.probeTurn + store runTurnProbe 状态机 +
    设置"测试 TURN 连接"按钮（含 unconfigured/ok/unauthenticated/
    unreachable/protocol/error 本地化文案）；
  - 测试：同密钥 Ok、错密钥 Unauthenticated、已知向量 + MD5 密钥复算；
    前端 837 项、Rust 185 项（161+19+5，另 2 项忽略）、
    typecheck/Biome 456 文件/design/clippy 全绿；
- 产物（release 88）：
  - `target/release/zicode-studio-desktop.exe`：41,760,256 B，
    SHA-256 `148BB60A1D6DED61AE69563D504732EC131AA65C0CEB33CBB206A8A774F9E3D8`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,845,167 B，SHA-256
    `4445DD26CD6EA88F3D07A17DF5275E62D15C73F263BC4D383E5558FD44C68C8D`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `B8B33C99E297F0322BE22A37031FB148E69658A49754AB5CEE8993F7BFC62B6B`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：设置 → 远程访问 → 点击"测试 TURN 连接"，返回
    `unauthenticated`（"TURN 服务器拒绝了派生凭据——请确认桌面密钥与
    coturn 的 static-auth-secret 一致"），按钮状态/文案正确；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十七次重建（2026-08-12，第 422 轮工作区栏精简）

- 合入第 422 轮：
  - 工作区栏项目卡片改为纯展示标签（`div.workspace-bar-label`），
    不再承担"将文件夹作为工作区打开"按钮职责；该入口移入切换器
    菜单底部（分隔线 + "将文件夹作为工作区打开"菜单项，仍调用
    `open_folder_as_workspace` 并保持当前应用）；
  - 帮助文档 interface.md（zh/en）同步工作区栏说明；
  - 七项工作区/存储需求核验：重复按钮无残留、`~/.zicode` 全局工作区
    置顶、切换工作区停留当前应用（settings 实测）、各应用按工作区
    `.zicode` 目录落盘、系统/模型配置统一在 `~/.zicode`（`~/.pi` 仅
    迁移备份）；
  - 前端 833 项、Rust 通过、typecheck/Biome 456 文件/design/Tauri
    权限 20 条全绿；
- 产物（release 87）：
  - `target/release/zicode-studio-desktop.exe`：41,718,784 B，
    SHA-256 `D145A147122BC0CB80D1EA73E6A20D9EAD3BDE2EA2199E862C34BC440EAFF9B1`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,874,047 B，SHA-256
    `E23795B68BD79802FDF1ACFDD5DBD98154EBA422313989CE9DEA08A07932B9FD`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `D91330AD0147B152CAADA724BB35E961A4A81629AF074926D9B0506577785C90`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：工作区栏为被动标签（无 `workspace-bar-project` 按钮）、
    切换器菜单含全部工作区（`~/.zicode` 置顶）+ "将文件夹作为工作区
    打开"项；切换工作区停留当前应用；设置视图头部文件按钮隐藏；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十六次重建（2026-08-12，第 418 轮产物批量导入）

- 合入第 418 轮：
  - Rust：`ArtifactStore::import_document`（保留原 id/handle/
    created_at/version，幂等跳过已存在项）+ `import_all`；host 新增
    `POST /v2/artifacts/import-all`（70 MiB 上限）；
  - 前端：网关 `importAll`、Store `importAll`、导航"导入全部产物"
    按钮，与导出对称；
  - 测试：Rust 导出→导入闭环（保留 id/内容一致、二次导入幂等 0）+
    前端 store 测试；
  - 前端 831 项、Rust 182 项（158+19+5，另 2 项忽略）、
    typecheck/Biome 456 文件/design 全绿；
- 产物（release 86）：
  - `target/release/zicode-studio-desktop.exe`：41,714,688 B，
    SHA-256 `282FA5FB9F327014B940E2FE05E02E6B8D94ACDFAAB92AD33B253E18586F4821`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,847,290 B，SHA-256
    `01CFC3574413FE5EBF6AC067DD8F412E911F2BF34F2BF39877E2233E358EA3F6`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `F98939AC0DB9164970CAD5953DFA30B7A573E675EC72DDC4E055599B0B7DF2B4`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 闭环：创建→导出→删除→导入恢复（importedCount 1、原 id 与
    内容一致）→清理，全部 200；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十五次重建（2026-08-12，第 415 轮导出文档标题头）

- 合入第 415 轮：
  - 会话导出支持文档级 `# 标题` H1（标题取自会话名/首条消息），
    单会话导出自包含；项目导出保持分节标题（不传 title 避免重复
    H1）；
  - 前端 829 项、Rust 181 项、typecheck/Biome 456 文件/design 全绿；
- 产物（release 85）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `D785A309B38372A69023B096521143099DCCD7A37FD4B72C3DD9FFE9F77E08B2`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,800,472 B，SHA-256
    `6E31BD62DAE831DA4513E029844BF652772ADA7E7ED725999961659ED8A6AF5E`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `211045B55F15FB36F245CE67A2BC28A3C27C76423F78D95CB8F702DA4AD3C1BC`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：真实会话导出文件以 `# 验证 env apiKey：回复 OK` 开头，
    内容完整；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十四次重建（2026-08-12，第 414 轮移动端帮助导航触摸高度）

- 合入第 414 轮：
  - release 83 移动端全表面回归（390px，8 表面）：0 溢出、新功能
    入口移动端可达（会话导出为 Markdown、笔记导出/导入全部、更新
    按钮）；
  - 修复帮助导航文章链接移动端触摸高度（20px → min-height 40px）；
    文章正文行内交叉引用链接属 WCAG 行内豁免；
  - 新增契约测试锁定移动端帮助导航链接触摸高度；
  - 前端 828 项、Rust 181 项、typecheck/Biome 456 文件/design 全绿；
- 产物（release 84）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `2D29B6A48BFF5785D40243660B6B8DD3FB43A998C96FD334659CBED263427254`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,818,121 B，SHA-256
    `E9646C89F207CA9F3091A3C36D98507B7966356594B460DD3F49BD12F41922AE`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `15669E63BB25C37254C717CBDD3A57C6441F8D8A2781B5785813610E83A571EC`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：390px 帮助导航链接高度 40px（min-height 40px）；
  - 运行期日志无 ERROR/WARN/panic。

## 第八十三次重建（2026-08-12，第 412 轮 4K 消息宽度修复）

- 合入第 412 轮：
  - 4K/超宽审计（2560×1440 / 3840×2160 × dpr 1/1.5，5 表面）：
    0 溢出、0 裁剪、主区缩放正确、0 控制台错误；
  - 修复真实缺陷：`.message-content` 无宽度上限，4K 下助手消息
    气泡 3324px（应封顶 1440px）——`width: 100%` 覆盖了基础
    `width: min(var(--chat-content-max-width), 100%)`；
  - 新增契约测试锁定消息气泡宽度封顶；
  - 前端 827 项、Rust 181 项、typecheck/Biome 456 文件/design 全绿；
- 产物（release 83）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `3A2D27FDD2858B94698E5F9738B7BD4C59C256B92E746DB6CAA485028B42140F`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,826,520 B，SHA-256
    `8DDAE88F1EBA8C97E96B10FEF036594FC17ACE231440F4CE784B5C28EA052D39`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `44088119E925FCD037803521BC3DBD4E014BA2CF0B9F34997888AAF5F499B04C`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：4K 下真实会话 4 条消息宽度全部 1440px、无超宽元素；
  - 新实例启动后 relay 连接成功，运行期日志无 ERROR/WARN/panic。

## 第八十二次重建（2026-08-12，第 411 轮产物批量导出）

- 合入第 411 轮：
  - 产物库新增"导出全部产物"（纯前端：遍历快照逐项读取文档，打包
    `{ schemaVersion: 1, exportedAt, artifacts[] }` 下载）；
  - 空态提示/逐项失败跳过/全失败提示；app-updater 测试同步适配
    新按钮行为（可点但只开 GitHub、不触发未签名 feed 检查）；
  - 前端 826 项、Rust 181 项、typecheck/Biome 456 文件/design 全绿；
- 产物（release 82）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `028DFE817C53BD7575DD037380C6DFB37E668D81FA1A44DE16CAF5504522227C`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,802,453 B，SHA-256
    `A443A41630180471BD670E37E42CB82735C69667B06126754E075F9DE71F5812`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `C9C6D46BE7B4E86ECEDC2FBF2625987855E962C7E36270A22BE079A8C59181BD`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：产物导航"导出全部产物"按钮就位，空态下无下载、无报错
    （提示"没有可导出的产物"）；批量打包逻辑由单测覆盖（2 产物 →
    1 下载、内容断言）；
  - 新实例启动后 relay 连接成功，运行期日志无 ERROR/WARN/panic
    （安装窗口内旧实例的 DNS 瞬时抖动不属本版本）。

## 第八十一次重建（2026-08-11，第 409 轮更新入口 UX 修复）

- 合入第 409 轮：
  - 修复未配置自动更新时"使用 GitHub Releases"按钮禁用导致的提示与
    行为矛盾：按钮改为可点并打开 GitHub Releases 页（经全局外部
    链接拦截器调用 host `open_external`）；
  - updaterStore 未配置分支 disabled=false；settings 新增锚点测试；
  - 前端 824 项、Rust 181 项、typecheck/Biome 456 文件/design 全绿；
- 产物（release 81）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `23147A51227CF4FE466057B082FCADCA136F14AC7F747225F1F5824C948B805B`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,793,801 B，SHA-256
    `BAFA56A0B895075186BC0C40277E8036626720EF349BE54AC29C64C119B1639D`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `E663DBA03D222397794645D06D4837892C81791916F2EE52E68B8887C481BB58`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：更新行按钮可点（disabled=false、aria-busy=false、文案与
    状态正确），点击触发外部打开链路；
  - 应用日志无 ERROR/WARN/panic。

## 第八十次重建（2026-08-11，第 407 轮笔记批量恢复导入）

- 合入第 407 轮：
  - Rust：`VaultExportBundle` + `NotesVault::import_all_export`；
    host 新增 `POST /v2/notes/import-all-backup`（50 MiB 上限）；
  - 前端：数据管理新增"导入全部笔记本备份"（chooseFile → 批量导入
    → 重载 + toast）；
  - 测试：Rust 导出→导入闭环单测 + 前端 store 测试；
  - 前端 823 项、Rust 181 项（157+19+5，另 2 项忽略）、
    typecheck/Biome 455 文件/design 全绿；
- 产物（release 80）：
  - `target/release/zicode-studio-desktop.exe`：41,646,080 B，
    SHA-256 `CA311752772EE1F3EE51D866EC3638BBC32399433BDF1672B1B63DB7CC916E3B`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,843,562 B，SHA-256
    `36BE6B6C8A41BC28F0EE2C76BB4EAB2DDAC4990304872C7E8271F4C8BD371253`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `5B53B5E247749C8DB6823858D5D383C21191462BEB9CF5284536733A082D146D`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：ax2 导出 bundle 导入 agent-inbox 工作区 → 返回
    QVeris (Imported) 5 篇 + 剪藏测试 (Imported) 1 篇；随后删除
    导入笔记本，无残留；
  - 应用日志无 ERROR/WARN/panic。

## 第七十九次重建（2026-08-11，第 406 轮笔记工作区级备份导出）

- 合入第 406 轮：
  - Rust：`NotesVault::export_all_notebooks` 聚合全部笔记本导出；
    host 新增 `GET /v2/notes/export-all`；
  - 前端：数据管理新增"导出全部笔记本备份"，下载
    `zicode-notes-all-<workspaceId>.json`（schemaVersion 1 +
    notebooks[]），成功 toast；
  - 测试：Rust 单测（2 笔记本聚合）+ 前端 store 测试；
  - 前端 822 项、Rust 180 项（156+19+5，另 2 项忽略）、
    typecheck/Biome 455 文件/design 全绿；
- 产物（release 79）：
  - `target/release/zicode-studio-desktop.exe`：41,618,944 B，
    SHA-256 `745696153DDDC18EF9F00A3C01E5C50708E8C90DA2F92DDA30E4BC90661F08D0`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,813,855 B，SHA-256
    `3E03D0D8DA4476DD26DAAA9F133307CC21D9041239E15162142F7FA6BEBB4185`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `3D158E870342691F0525AF26F2B8309BBE3F93EC0D391705D1F697A5A33462C7`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：ax2 工作区"导出全部笔记本备份"下载
    `zicode-notes-all-f70e093f.json`，含 QVeris 与剪藏测试两个
    笔记本；
  - 应用日志无 ERROR/WARN/panic。

## 第七十八次重建（2026-08-11，第 405 轮项目级 Markdown 导出）

- 合入第 405 轮：
  - 项目头上下文菜单新增"导出项目为 Markdown"（📦）：逐会话读取
    转写渲染，`# 会话标题` 分节合并为单文档下载；失败/空会话跳过
    并计数提示；
  - 单会话导出重构共享 `downloadMarkdownFile`；
  - 前端 821 项、Rust 179 项、typecheck/Biome 455 文件/design/
    i18n 覆盖率/Tauri 权限 20 条全绿；
- 产物（release 78）：
  - `target/release/zicode-studio-desktop.exe`：41,604,608 B，
    SHA-256 `01333FD62B67D51AAA8D9BD5F3950864C74E4F79CC549FF7BE08A1D7B85A15C2`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,820,165 B，SHA-256
    `F92D1ECE03BD8EFD934EFE4CCBB64C5AFF2851E49E42BE35018E51438BE177AE`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `1EAECDAC0E3B389CF30CB96CB8AE939681C8896CD63C07B1949148C682C90D00`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：ax2 项目导出 `ax2.md` 含多会话分节（用户/助手/思考/工具
    完整）；
  - 应用日志无 ERROR/WARN/panic。

## 第七十七次重建（2026-08-11，第 403 轮导出成功/失败反馈）

- 合入第 403 轮：
  - 会话导出接入通知系统：成功弹"对话已导出为 Markdown"，失败弹
    "无法导出该对话：无法读取该会话的转写内容。"（固定虚拟会话
    优雅降级）；
  - 补 3 个 i18n 键；新增成功/失败通知断言测试；
  - 前端 818 项、Rust 179 项、typecheck/Biome 455 文件/design/
    i18n 覆盖率/Tauri 权限 20 条全绿；
- 产物（release 77）：
  - `target/release/zicode-studio-desktop.exe`：41,604,608 B，
    SHA-256 `1874D6D89E927C52F279BA47CA5BB3C62250CE6D161113EAD707DE905225FC1B`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,802,201 B，SHA-256
    `AB9E76029659B89DEDE78EBEBBFFA6623EFEABA19A909EE2612347E1C6371CCA`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `3B859A4807DB57355591AF683EF92B97303C298D075A6483E8EBE9751F165E39`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：真实会话导出成功 toast、固定虚拟会话导出失败 toast、
    390px 移动端菜单含导出项；
  - 应用日志无 ERROR/WARN/panic。

## 第七十六次重建（2026-08-11，第 402 轮 Markdown 导出 + JSX 本地化）

- 合入第 402 轮：
  - 修复 5 处 JSX 文本节点硬编码英文（思考块标签、确认对话框、
    内联扩展提示、插入示例、草稿提示），i18n 覆盖率测试升级为
    同时检查 JSX 文本节点；
  - 新功能：会话"更多"菜单"导出为 Markdown"（read_session_messages
    → 用户/助手分节、思考引用、工具列表 → 下载）；
  - 前端 817 项、Rust 179 项、typecheck/Biome 455 文件/design/
    i18n 覆盖率/Tauri 权限 20 条全绿；
- 产物（release 76）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `1765AFA4259E8B7434DB80F9FC478675D6A81C2D44D1CEA380FD54BCC5861C09`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,827,906 B，SHA-256
    `2DA213FA0F0D6F0F53B24F8DD9352D92DB6987415831DCC58A93C63A72817D71`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `D93B1CE289BA831EC6B07B7FC24CF4800D9BA2CEF749FB919E64E458FDDA1C38`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP：真实会话导出 Markdown 内容完整（中文分节 + 思考引用）；
    思考块标签实测为"思考"；
  - 应用日志无 ERROR/WARN/panic。

## 第七十五次重建（2026-08-11，第 400 轮移动端触摸目标修复）

- 合入第 400 轮：
  - 390px 全表面触摸目标审计：主交互 ≥40px、全部 ≥24px（WCAG 2.2
    AA 最小值）；
  - 修复：会话行 min-height 40px、会话更多按钮 min 40px、思考强度
    轨道 200px + 分段 min-width 40px、自动化审批复选框 24×24 +
    行点按区 40px；
  - 回归测试：布局契约新增触摸目标规则检查；
  - 前端 812 项、Rust 179 项、typecheck/Biome 453 文件/design 全绿；
- 产物（release 75）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `7E9E0D367B4F5EBC54503AAF02379136FCF49E510B8B5A1E5FF0E9B727289DC0`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,800,918 B，SHA-256
    `CE451C56C6627D8DB69E436986827804774F4E42F12A6DCF0EAD286D73317B94`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `7663A43B8FDB9E69CD47AF4B47DC98B09549F09BCF0DE8EE535501BC100ACD16`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 390px 复测：无 <24px 触摸目标；
  - 应用日志无 ERROR/WARN/panic。

## 第七十四次重建（2026-08-11，第 399 轮表单可访问名称 + 硬编码英文清理）

- 合入第 399 轮：
  - 审计：桌面 10 功能区 + 移动端 390px 多状态全部可见交互元素
    可访问名称完整；发现智能收件箱聊天平台表单（飞书/企业微信）
    8 个输入框缺 aria-label、3 个 placeholder 硬编码英文；
  - 修复：8 个输入框补 aria-label，3 个 placeholder 改走 t()，
    新增 App ID/App Secret/Bot ID/Secret 四个 i18n 键；
  - 回归测试：布局契约锁定该表单全部输入框必须带 aria-label 且
    placeholder 必须经 t()；
  - 前端 811 项、Rust 179 项、typecheck/Biome 453 文件/design/
    i18n 覆盖率/Tauri 权限 20 条全绿；
- 产物（release 74）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `1C85CAAE74D2F32F0BA875C8A9E4509F0C6C7BE9F14DA1D6AD3402A645D68502`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,803,618 B，SHA-256
    `A431402F0CD24B43C82231C023F682C2CC8B73FED5635C3B158AE7B9153477D2`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `963F67DC937D49265A296865D53434D414EAE0BC3F5B271E3C68701286A9A5AD`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 打开设置 → 智能收件箱：8 个输入框 aria-label 与 placeholder
    均为中文，无英文残留；
  - 应用日志无 ERROR/WARN/panic。

## 第七十三次重建（2026-08-11，第 397 轮断连错误本地化 + i18n 门禁修复）

- 合入第 397 轮：
  - 全表面审计（CDP，桌面 1440×900 + 移动 390×844）：12 个功能区
    遍历，0 控制台错误、0 文档级横向溢出；
  - 修复：Pi 运行时断连时笔记/自动化/任务/项目/产物各表面显示原始
    英文 `Pi RPC request failed: ProcessClosed`——新增共享
    `localizeHostError` 映射为友好中文提示（含恢复指引），应用到
    全部 store 加载/保存/删除/搜索/通知错误路径与聊天错误渲染；
  - 修复 i18n.js 7 处重复对象键（`Symbol` "代码" 被金融 "标的代码"
    遮蔽属真实翻译 bug），Biome 门禁由红转绿（453 文件）；
  - 前端 809 项（新增 8 项共享/各 store 回归）、Rust 178 项、
    typecheck/Biome/design/i18n 覆盖率/Tauri 权限 20 条全绿；
- 产物（release 73）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `D092C3CCC87C444D9B2AD88790580A63DE40EE40BA52C925E689929D1AFE0B64`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,800,903 B，SHA-256
    `55E95B1FCD6120D805EBBF24ED66521E64D7A87ABA71CD0BCA139C6DA5065FBC`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `0B5C4F7638E864B0AFBCD38A28F9236AF7F07E92DE656861B77A01C709E0CA21`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 全表面巡检 0 控制台错误/0 横向溢出/无原始英文错误；
  - 应用日志无 ERROR/WARN/panic。

## 第七十二次重建（2026-08-11，第 396 轮成本/帮助/任务/自动化全表面复核）

- 合入第 396 轮：
  - 成本用量面板实测：加载真实数据（总费用 $0.01、会话 7、消息 23），
    图表 canvas 渲染正常，无横向溢出；
  - 通知中心 Toast 系统正常（恢复提示弹出与关闭，第 392 轮已实测）；
  - 帮助中心 14 篇文章逐篇打开均有 h1 与正文，"界面与导航"含工作区
    章节、"快捷键"含命令面板/工作区表格；
  - 任务中心筛选栏 + 空态正常；自动化空态正常；产物库空态正常；
  - 金融工作台非金融场景显示场景守卫，"打开场景设置"按钮实测跳转
    设置场景区并滚动到位；
  - 新增回归测试：帮助 manifest 14 页，每页 zh/en 文件必须存在且
    >80 字符；
  - 前端 801 项、Rust 178 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 72）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `736AA01E72E5230ECD495D6FD0BB335AC2DC8ED0F1BF63B742B136365FA79497`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,833,577 B，SHA-256
    `0482D1E424F02DCD37CAFA75D1B279F5C13B2D30A82F5C9661F7B643748B6E37`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `7368A550C7D4D0ED5AF880915C7C58F06401A85DF22C51E124D364DD7E92BC4C`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 应用日志无 ERROR/WARN/panic。

## 第七十一次重建（2026-08-11，第 395 轮笔记剪藏/附件 + 错误本地化）

- 合入第 395 轮：
  - 实测网页剪藏（采集 example.com 建笔记、重复采集命中去重）与
    附件（上传/读取字节一致、markdown 链接写入正文），临时数据清理、
    QVeris 完好；英文界面切换验证通过；
  - 修复：主机 API 错误消息为英文（如采集网络权限、备份笔记过多），
    新增 `localizeNotesHostError` 按错误码映射本地化并应用到笔记
    store 全部错误设置，补 i18n 键与单测；
  - 前端 800 项、Rust 178 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 71）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `C2D11C1850FDBC1134C8F218C0A1B7ED07D7BDD612E7C84F747F621308DC99F8`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,786,724 B，SHA-256
    `133A7371C2BFD78309590B5DCD2216B02D41B2DBB7A09CDDFA87F50C25D93BBE`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `929F4F270008E3B08A7825A9D14B5A27491367D290CFAA9412172E9BBE1DF54B`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 安装版 Composer 占位符中文、Agent Inbox 固定组可见、0 横向溢出；
    日志无 ERROR/WARN/panic。

## 第七十次重建（2026-08-11，第 394 轮安全审计 + Agent Inbox 修复）

- 合入第 394 轮：
  - 安全审计：日志无 sk-/api_key/Bearer/password 命中；
    model-gateway 日志掩码从 16 字符收紧到 6 字符并抽取 `auth_preview`
    单测；`~/.zicode` 配置与凭据文件 ACL 仅本机用户 + SYSTEM +
    Administrators；
  - Agent Inbox 修复两处：`session_dir_name` 未清理 Windows 非法字符
    （`C:` 冒号导致 os error 267，占位会话目录无法创建）；前端
    `SUPER_AGENT_PATH_SUFFIX` 仍为旧路径 `/zicode/agent/super-agent`
    （第 384 轮把 inbox 工作区改到 `workspaces/agent-inbox` 后固定组
    一直不显示）——统一为按正斜杠规范化匹配新路径，双修复均补单测；
  - 前端 799 项、Rust 154 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 70）：
  - `target/release/zicode-studio-desktop.exe`：41,600,512 B，
    SHA-256 `8AA6660960A8B36B4DCBC457CF00C93791FA8DEB1C7843293DD2173C32BECF7E`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,808,479 B，SHA-256
    `DB5E6715D0B49772B7CDA42A79E2B047F9207DD75C7FD1E51667507BB3507E01`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `A4A7B72213040F9BF36D3E1CAC190E9E91A0C859D3AEFAED8AC2A870198A4C65`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - Agent Inbox 全链路实测：启用开关 → `ensure_agent_inbox_session`
    成功 → 双运行时启动 → 侧栏固定组"★ 智能收件箱 已固定"展示 →
    切回 ax2 工作区 12+1 会话、固定组跨工作区可见、0 横向溢出；
    日志无 ERROR/WARN/panic。

## 第六十九次重建（2026-08-11，第 393 轮本地化审计）

- 合入第 393 轮：
  - 清除会话侧栏/欢迎页/Composer/搜索对话框/设置配置页/成本面板/
    包浏览/扩展提问/帮助/通知等处的硬编码英文，全部走 `t()` 本地化
    并补 zh 翻译键（含 `{count}`/`{file}` 占位替换）；
  - 新增回归测试：`frontend/src/features` 下 `.tsx` 的
    placeholder/aria-label/title 禁止硬编码英文标签；
  - 前端 799 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 69）：
  - `target/release/zicode-studio-desktop.exe`：41,599,488 B，
    SHA-256 `4E5CA668D300E54FEA5F27AC61AB18ADFABF46B68D7387ACE36DF59E2ED3C18D`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,815,833 B，SHA-256
    `2D641FF38A5A1039418BEACE60A626E1FD393439481E831C2A831CCE1314294F`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `F00126E730433713CA466603DBB83010E6ED5D37BDF7B1BAF1C250B1FA855470`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 安装版中文界面文案验证：Composer 占位符"输入消息，或使用 /
    调用技能…"、配置页频道编辑器标签"基础地址/API 协议/API 密钥/
    模型（每行一个 ID）"；12 会话完好、0 横向溢出；日志无
    ERROR/WARN/panic。

## 第六十八次重建（2026-08-11，第 392 轮运行时崩溃恢复实测）

- 合入第 392 轮：
  - 故障注入实测：终止当前会话 Pi 运行时进程后，应用不崩溃、状态变
    "已断开"、发送消息给出清晰错误（ProcessClosed），新建会话立即
    重新拉起运行时并恢复正常对话；
  - 修复：运行时进程死亡后发送路径检测 `ProcessClosed` 类错误，立即
    把状态置为"已断开"并弹出一次性恢复提示（新建会话即可恢复），
    连接监听器复用同一逻辑，每次断开只提示一次、重连后重置；
  - 契约回归测试：app.js 含进程关闭错误检测、恢复提示文案与发送路径
    接线；
  - 前端 798 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 68）：
  - `target/release/zicode-studio-desktop.exe`：41,599,488 B，
    SHA-256 `6B31D43BE0C64660526D1D6BE01BA9CC2DEA4B7AE9A9EF43C046618531E1B885`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,799,572 B，SHA-256
    `C668DFBBE9868C2512F6D3866225DE3F3FB4E56D6AF2DE3B541B91AE9CD8F80F`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `26F934A5A9EEE1C7677D5C1AD1465B8D8BAD2E03C60224ADF1739BB46EBC9DC9`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 安装版状态正常（已连接）、12 会话完好、0 横向溢出；日志无
    ERROR/WARN/panic。

## 第六十七次重建（2026-08-10，第 391 轮帮助文档同步实际架构）

- 合入第 391 轮：
  - 帮助中心"界面与导航/场景与隔离/快捷键"三篇文章与第 384–390 轮
    的实际架构同步（工作区栏/切换器、按工作区数据目录
    `<工作区>/.zicode/<应用>/`、`~/.zicode` 系统配置、命令面板
    命令），zh/en 双语更新；
  - 补文档覆盖契约测试（Help 必须包含工作区切换与按工作区数据布局）；
  - 前端 797 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 67）：
  - `target/release/zicode-studio-desktop.exe`：41,595,392 B，
    SHA-256 `24ACD556A8CF5B1794AD310A313CB0A78F9063E157AC5B8ABCA5AE6E9D5C2339`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,822,796 B，SHA-256
    `F980B530C33EAE5500475013C3FE0A6E60B1125A2D75FFBDD734031789E95962`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `86005536A964C1A968AB8B903019CD53B06528338A3AE089171DB33AE197E9D9`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测帮助"界面与导航"渲染新版工作区内容（工作区栏/切换器/
    `.zicode`），会话 12 条数据完好；日志无 ERROR/WARN/panic。

## 第六十六次重建（2026-08-10，第 390 轮启动恢复验证 + 命令面板补全）

- 合入第 390 轮：
  - 命令面板（Ctrl+Shift+P）补"新建会话"与"切换工作区"两个高频
    命令；修复"切换工作区"命令被自身点击冒泡立即关闭菜单的问题
    （延后触发按钮，补契约回归测试）；
  - 重启恢复、移动端深度交互（抽屉/菜单/底部导航）、6 套主题切换
    复核通过；
  - 前端 796 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 66）：
  - `target/release/zicode-studio-desktop.exe`：41,595,392 B，
    SHA-256 `DE5C6AF222AD7E8DF2342CA3B97D8B1228C95408372A76F4F6C340D019EA43F6`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,774,606 B，SHA-256
    `21B80D332AB5E5A6A5A9B6627D44A827BAC61486C6D2D326964DAC02A5BA5D8A`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `D1DDD81194698E9572E3352BCCB309288B40037EA5728D176C301F21B691BB56`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 实测命令面板顶部为"新建会话/切换工作区"，切换工作区命令正常
    打开切换器（5 个工作区）；日志无 ERROR/WARN/panic。

## 第六十五次重建（2026-08-10，第 389 轮核心链路实测 + 健康汇总口径）

- 合入第 389 轮：
  - 模型链路端到端实测：真实发消息 → 网关应答 → 回复渲染 → 会话
    落盘工作区 `.zicode/sessions` → 侧栏新增，0 控制台错误；
  - 配套链路复核：模型下拉 22 项、配置页模型健康、会话归档/删除
    （文件同步删除）、产物库闭环、Ctrl+K 搜索；测试数据已清理；
  - 修复：模型健康汇总统一按可见模型统计（此前"已启用"按可见、
    "健康/异常"按全部，含已隐藏别名），隐藏别名不再计入异常；
    补单元测试；
  - 前端 795 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 65）：
  - `target/release/zicode-studio-desktop.exe`：41,595,392 B，
    SHA-256 `2B39E2489D23343E5BCA1B4B5CDB0204CD57616168683E1A7622B1BBEE9E49E3`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,788,903 B，SHA-256
    `4E2A32A4229CEDA490F495E6252ECA9D3A36D203040DB79974502ECF5ED1ECB6`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `7D2FC35849AFB70A05E4278BF7981D5650F816C4EE5D32DCE45A3C77C4A151A5`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 实测配置页汇总显示"22 已启用 · 22 健康 · 0 异常"；日志无
    ERROR/WARN/panic。

## 第六十四次重建（2026-08-10，第 388 轮数据闭环验证 + 导入计数修复）

- 合入第 388 轮：
  - 数据闭环实测：笔记 新建→编辑→回收站→恢复→导出→删除→导入
    还原（内容逐字节一致）、会话备份导出 schemaVersion=1/12 条
    结构完整；
  - 修复：导入备份响应返回真实 `noteCount`（此前为新建笔记本的初始
    0），补 Rust 往返断言；
  - 前端 794 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 64）：
  - `target/release/zicode-studio-desktop.exe`：41,595,392 B，
    SHA-256 `3A0955AE78DE3FC902472957ECA4E7D8C47AF782C8DDF32B0132B757A95C466D`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,778,456 B，SHA-256
    `E1CA2B81CB739082F3DDEE9786626CA67B58644029EBD5D91E343DE09EF61866`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `3521401A867F3D12FAD37D784B8CFBF635F5C2F175F442FB96E6B90BAF973BA5`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 实测导入响应 `noteCount=1`，测试数据全部清理、QVeris 5 条笔记
    完好；日志无 ERROR/WARN/panic。

## 第六十三次重建（2026-08-10，第 387 轮键盘无障碍走查）

- 合入第 387 轮：
  - 会话行/项目头的 ⋮ 与归档按钮增加 `:focus-within` 显示规则，
    桌面端键盘用户可 Tab 进入（行聚焦 → Tab → 归档 → Tab → ⋮），
    Space/Enter 打开菜单、Escape 关闭并回焦触发按钮；
  - 键盘走查复核：命令面板（Ctrl+Shift+P）打开/搜索获焦/Escape
    关闭并恢复焦点，活动栏方向键循环移动焦点；
  - 前端 794 项（新增会话侧栏键盘聚焦用例 + 布局契约 focus-within
    规则断言）、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 63）：
  - `target/release/zicode-studio-desktop.exe`：41,594,880 B，
    SHA-256 `AA7786E5FB49BB7C6249B379AFB9CC1CE49E9EABF2CA3B3956C6BA0BE49E7EAD`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,796,720 B，SHA-256
    `EDA083DB39C1882F5D06EA0EC577FDF6773CC1E18ADAD7D1EF47FB3F93224DAB`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `BB1CB4B2B3BCFE7A4BE20790139C1AAFF9F7010C8E7D8E6E095464376836F3AC`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：真实点击/键盘聚焦会话行后 `:focus-within` 生效、⋮ 按钮
    computed visibility=visible、文档横向溢出 0、会话 12 条数据完好；
    日志无 ERROR/WARN/panic。

## 第六十二次重建（2026-08-10，第 386 轮全应用审计 + 溢出/可访问性修复）

- 合入第 386 轮：
  - `.main` 增加 `overflow: hidden`：折叠态右侧文件面板（320px
    off-canvas）与浮动会话导航轨不再撑宽文档，消除对话视图 320px、
    其他应用 4px 的文档级横向溢出；
  - 会话搜索输入框与对话输入框补 `aria-label`（"搜索会话"/
    "消息输入框"），中英翻译齐全；
  - 全应用面审计（桌面 + 390×844 移动仿真）0 控制台错误、0 文档级
    横向溢出；主题切换/新建会话/归档二次确认/工作区切换复核通过；
  - 前端 792 项（新增布局契约 2 项）、Rust 152 项、
    typecheck/Biome/design/Tauri 权限 20 条/clippy/fmt 全绿；
- 产物（release 62）：
  - `target/release/zicode-studio-desktop.exe`：41,594,880 B，
    SHA-256 `D73C8C269D13FD8A6F462E9EE44EDFB9ABB77E093E4E76AD232D86047B3F9CB5`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,767,990 B，SHA-256
    `46D10F2D2F06D6078B61E6F8C30B4B84F34671C78A1881321B5C4315261A863E`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `527CDE4AFF016DEE47AC6C973AC60AE4A1E08BD30011CF343A504C64F31573AA`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：对话/项目/笔记/任务/自动化/金融/产物/设置/帮助文档级
    横向溢出全为 0，`.main` computed overflow=hidden，会话搜索与
    消息输入框 aria-label 生效，会话 12 条数据完好；日志无
    ERROR/WARN/panic。

## 第六十一次重建（2026-08-10，第 385 轮任务/自动化/金融按工作区隔离）

- 合入第 385 轮：
  - picot-config 数据平面把任务、自动化工作流、金融研究卡片的数据
    目录改为工作区作用域：`<工作区>/.zicode/{tasks,automation,finance}/`，
    运行时注入 `PI_DESKTOP_WORKSPACE_DIR` 供扩展定位；
  - 首次加载时把旧场景级文件（`~/.zicode/scenes/<key>/agent/<app>/`）
    一次性移入所属工作区目录；读写保留旧文件兜底，数据不分裂/不丢失；
  - 前端 790 项（新增任务落盘、自动化落盘、旧数据迁移 3 项）、Rust
    152 项、typecheck/Biome/design/Tauri 权限 20 条/clippy/fmt 全绿；
- 产物（release 61）：
  - `target/release/zicode-studio-desktop.exe`：41,594,880 B，
    SHA-256 `F5B7628318F0F6671941AE5E0729B0ACD13A00A343C02126E2105CE60DFDCDB5`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,785,983 B，SHA-256
    `BB4EF6F82CCB38AB9D3AE0B6EF8592410C3993017495482396B7CDC779C69A62`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `0B91A2B6734C0ED8FEA2227AD7B54D9C31C58FF2B3F6CCAEC318ECA55D956211`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - 安装版 `extensions/picot-bridge.mjs` 含 `WORKSPACE_APP_DIR` 与
    `tasks/automation/finance` 工作区路径及迁移对；
  - 真实运行时迁移生效：旧
    `~/.zicode/scenes/<key>/agent/automation/workflows.json` 已移至
    `C:\Users\ax2\.zicode\automation\workflows.json`（场景目录残留 0）；
  - 日志无 ERROR/WARN/panic。

## 第六十次重建（2026-08-10，第 384 轮工作区模型 + ~/.zicode 存储）

- 合入第 384 轮：
  - UI：移除对话侧栏"将文件夹作为工作区打开"按钮、项目头部新建会话/
    笔记/产物/任务快捷按钮与"新建对话"文字行；Files 活动按钮仅在对
    视图显示；
  - 全局公共工作区 `~/.zicode` 默认注册并在切换器置顶；
  - `switch_window_workspace` 命令：当前窗口原地切换工作区，URL 携带
    `?app=<当前应用>`，加载后恢复原应用视图；
  - 存储：会话→`<工作区>/.zicode/sessions`（旧 instances/sessions
    一次性迁移）、笔记→`.zicode/notes`、产物→`.zicode/artifacts`；
    系统配置（pi agent/models、场景档案、远程访问、凭据索引、工作区
    元数据）迁移到 `~/.zicode`，旧 `~/.pi/agent` 与旧数据目录保留；
  - 侧栏会话列表按当前工作区过滤（切换工作区即切换列表），空工作区
    显示"当前工作区暂无会话"；
  - 前端 787 项、Rust 152 项、typecheck/Biome/design/Tauri 权限
    20 条/clippy/fmt 全绿；
- 产物（release 60）：
  - `target/release/zicode-studio-desktop.exe`：41,594,368 B，
    SHA-256 `83F1BECAA3DCE3047EEC00DE49516DCB432043B98858FEAE3C58B3749BEAF036`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,799,733 B，SHA-256
    `B091636B4B0E4FC61B9A1EECD23E172576E01B081A2CC76BEF67CDCB33DEF153`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `5E05FB09B3C794006E76C418EDAF3B8A2D2F0F5D9EFB310476279CDC22B3ED85`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - `~/.zicode` 已建：`metadata/picot.sqlite3`、`scenes/`、
    `agent/`（含自 `~/.pi/agent` 迁移的 settings/models/auth）、
    `credentials/`、`remote-access/`、`scene-profiles.json`；
  - 会话迁移：旧 `%LOCALAPPDATA%\zicode\instances|sessions` 的 12 个
    会话已迁至 `C:\Users\ax2\.zicode\sessions`（instances 残留 0）；
  - CDP 实测：无冗余按钮、切换器全局工作区置顶、笔记视图切换工作区
    后停留原应用（`?app=`）、全局工作区会话列表为空并显示空态提示、
    切回 ax2 恢复 12 个会话；日志无 ERROR/WARN/panic。

## 第五十九次重建（2026-08-10，第 383 轮共享工作区栏 + 移动端可触达）

- 合入第 383 轮：
  - 共享工作区栏（公共组件）：所有功能区视图（对话/笔记/设置/帮助）
    顶部显示当前工作区名称+路径，点击打开文件夹选择器并就地切换；
    "切换工作区"菜单列出全部已注册工作区并可就地切换；远程客户端
    无原生能力时自动隐藏按钮；插件壳重复项目行隐藏；
  - 移动端：会话行与项目头新增 ⋮"更多操作"按钮（收藏/归档/重命名/
    删除、归档全部会话，与右键菜单共用实现）；粗指针/≤768px 强制
    显示归档与"删除全部已归档"按钮；抽屉内打开菜单不自动收起；
    工作区栏 ≥40px 触控目标、切换菜单限制在抽屉内；
  - 前端 785 项、typecheck/Biome/design/Tauri 权限 19 条命令全绿；
- 产物（release 59）：
  - `target/release/zicode-studio-desktop.exe`：41,518,592 B，
    SHA-256 `6B356245D9AB468193FE6796191E1AA68FAD2FD34A00AF4A09D4C13C5C9D3F1A`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,765,177 B，SHA-256
    `4188ABA348E7754F9AAE06BEB2E48A5F39F08A9E353C0BA7C99EF1255BBAB44E`
  - `target/release/zicode-relay.exe`：1,805,312 B，SHA-256
    `120ABC74BC37C1B563AAF0DFD10239FD0F08CE2B885C36E79DB84EEB786300B7`
- 验证：
  - `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.84.1、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；
  - 安装目录 public 与仓库 299 文件逐文件一致（0 缺失/0 哈希差异）；
  - CDP 实测：对话/笔记/设置视图工作区栏恒在（ax2 /
    `C:\Users\ax2`），切换器列出 4 个工作区；会话 ⋮ 按钮 12 个、
    归档 6 条、会话 12 条数据完好；移动端 390×844 仿真抽屉内
    工作区栏/⋮/归档按钮可见、菜单锚定在按钮下方且抽屉不收起；
  - 应用日志无 ERROR/WARN/panic。

## 第二十四次重建（2026-08-09，含第 298–300 轮 + 笔记回收站）

- 合入：第 298 轮桌面宽屏空状态/侧栏收起、第 299 轮布局走查/拖拽回归
  测试、第 300 轮笔记回收站（删除进 `.trash`、列表/恢复/彻底删除、
  workspace 隔离）与笔记应用设计文档；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,380,352 B，
    SHA-256 `D590116B03B32A0F8C0A4F3F7B944428ECD75F4E52C01D9575A17F9DA92EEAB1`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,877,932 B，SHA-256
    `88444C6E4546626A3C4C831CBC959616759BC05B1B388B72DCDD34399874D7D0`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致（0 缺失/0 哈希差异）；
    `/S` 静默重装后从安装目录启动：网关 `/health` 200（pi 0.83.0、
    协议 v2、`lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；CDP
    全链路实测回收站：删除→回收站 (1)→恢复→再次删除→彻底删除（二次
    确认）→回收站为空，临时笔记本/笔记已全部清理，QVeris 与测试
    笔记本数据完好；Rust 167 项（143+19+5）、前端 747 项测试全绿。

## 第二十五次重建（2026-08-09，含第 301 轮回收站补强 + 笔记快捷键）

- 合入：回收站清空（empty_trash + `/v2/notes/trash/empty`）、回收站行内
  来源笔记本名、树导航退出回收站、Ctrl+N/Ctrl+Shift+T 快捷键、帮助中心
  中英文同步；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,399,808 B，
    SHA-256 `689110A0B703191838E78DF9B160FC67C35D1AB1699210D937EEA596D6254A5E`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,879,313 B，SHA-256
    `33C4A017E09750E9C9019D145A95504EDEB5D37346C0E9B91FC07FB2A72ABC73`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；CDP 实测
    Ctrl+Shift+T 打开回收站、行内显示来源笔记本名、清空回收站二次
    确认、Ctrl+N 新建笔记；临时数据全部清理，QVeris 5 条与测试笔记本
    数据完好、回收站为空；Rust 168 项（144+19+5）、前端 749 项测试
    全绿。

## 第二十六次重建（2026-08-09，含第 302 轮备份包含回收站）

- 合入：VaultExport 增 trashedNotes（导出/导入回收站条目 + 附件归属），
  read_attachment 允许活动/回收站笔记附件；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,423,360 B，
    SHA-256 `2B54E1F58AE723E885DCDE5122300E36BF0B9E7F19DC7D150DA86A927C0101D4`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,870,491 B，SHA-256
    `776211E3C78354F8C65F48ACA013F1B8B60A6CA5DE0DC65B035A90042D686D8A`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版 API 全链路：
    创建→附件→删除→导出（trashedNotes=1/attachments=1）→导入→回收站
    1 条→恢复→附件字节一致；临时数据全部清理，QVeris 5 条与测试
    笔记本数据完好；Rust 169 项（145+19+5）、前端 749 项测试全绿。

## 第二十七次重建（2026-08-09，含第 303 轮笔记搜索标题高亮）

- 合入：highlightSegments + HighlightedText，笔记树/筛选结果标题对查询
  词高亮；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,423,360 B，
    SHA-256 `24DDA0E524939C8C3018EC43B65233C71EFDF0D4EF4F6E988544D58EDE48B0EC`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,895,008 B，SHA-256
    `0AF4EBC7930397A1AA08DCA2F31301363192875F4462483305BCA19A81717A5C`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；CDP 实测输入"笔记"
    后 5 条笔记标题全部高亮、无溢出、无控制台错误；前端 752 项测试全绿。

## 第二十八次重建（2026-08-09，含第 304 轮笔记预览目录大纲）

- 合入：buildHeadingOutline 标题 id 分配 + Outline 粘性侧栏（桌面两栏/
  移动单列、点击平滑滚动）；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,423,360 B，
    SHA-256 `CFE52F3F0D69A56CA688EA574DD3AD35E987A307237796630C67775B6EAB1192`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,856,443 B，SHA-256
    `95CE3A3D5479A3696EFCE46EF7EC42CF537A753A08C413527B2B01729ACB5961`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；CDP 实测长笔记
    预览大纲列出 3 个 h2、标题 id 稳定、点击无错误、无溢出；前端 754
    项测试全绿。

## 第二十九次重建（2026-08-09，含第 305 轮笔记多选批量移动）

- 合入：selectMode/selectedNoteIds + 多选开关 + 批量操作条 + 移动到
  笔记本列表；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,423,360 B，
    SHA-256 `423D939EB61CDD84EE2253B38CE4277AA60AA200D946CB5E3B184B3A5C3617FE`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,865,066 B，SHA-256
    `6A3E6F27DD65E322FF6B66B51384B50CA67EE151ED2EEDE05ECBA1054A52A32F`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；CDP 实测多选两篇
    笔记批量移动到目标笔记本（源 0/目标 2、退出选择模式、无错误）；
    临时数据清理完毕，QVeris 5 条与测试笔记本完好；前端 756 项测试
    全绿。

## 第三十次重建（2026-08-09，含第 306 轮回收站保留期 + 帮助同步）

- 合入：回收站 30 天保留期惰性清理（list_trash_with_retention），帮助
  中心中英文同步搜索高亮/目录大纲/多选批量移动/保留期；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,424,896 B，
    SHA-256 `C2C3FEBEDFBDB5779A13DC8905B68339376D0503E38CB7C2F9A16B246573C459`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,866,294 B，SHA-256
    `8482F21C62889DCA03666FE89C03E87C5944570E2FE56F24912BCF96CAD10EB4`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测回收站
    文件回拨 31 天 → 打开回收站自动清除；帮助文章含 30 天/目录大纲/
    多选；临时数据清理完毕，QVeris 5 条与测试笔记本完好；Rust 170 项
    （146+19+5）、前端 756 项测试全绿。

## 第三十一次重建（2026-08-09，含第 307 轮设置密码框表单化 + 状态审计）

- 合入：设置页 ApiKeyEditor/TURN 表单化，新增 `docs/production-status.md`
  生产可用状态审计；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,424,896 B，
    SHA-256 `7556A44FD2EA0D426F407B525031AD5E1F90B53CF1505D6394733B58EF2AAA95`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,903,208 B，SHA-256
    `7478E3504EC2A6C23DF13F0787466111E61978A8D0DE409D8815ADD046D2D789`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测设置
    密钥编辑器为 FORM、密码框在表单内；全应用走查无控制台错误/横向
    溢出；前端 756 项测试全绿。

## 第三十二次重建（2026-08-09，含第 308 轮 chat-inbox 平台表单化）

- 合入：chat-settings-panel 飞书/企业微信表单化（密码字段纳入 form）；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,424,896 B，
    SHA-256 `785AD51C52865711D07A4D5E27A51F4890B7372F94D5DB6C667A977E85C8D284`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,833,911 B，SHA-256
    `93A5C047582006A76BBD0CF0B5CFBFCAEB734839E91E3660676A9D8FB09D5AD5`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测设置页
    全部密码框在表单内；前端 756 项测试全绿。

## 第三十三次重建（2026-08-09，含第 309 轮笔记多选批量删除）

- 合入：批量操作条删除按钮（二次确认）+ deleteSelectedNotes 进回收站；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,424,896 B，
    SHA-256 `DDAB13629BB326139D972A17AF17A0A0BFC95143807BD8AA29C1FF03422A3EF3`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,881,302 B，SHA-256
    `430FC5E97B09C2FDCCFC581D0705045035B1206DE53B0802758C9943285CD89A`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测多选
    两篇笔记批量删除到回收站（确认文案、选择退出、无错误）；临时数据
    清理完毕，QVeris 5 条与测试笔记本完好；前端 758 项测试全绿。

## 第三十四次重建（2026-08-09，含第 310 轮会话备份导出）

- 合入：/v2/sessions/export 只读导出 + 设置通用页"数据"区块导出按钮；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,441,792 B，
    SHA-256 `CC69E180B4777615CE538E133E88F1A47E02EE73EBADFC50B99A42026F74CBDC`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,926,408 B，SHA-256
    `0A6FA052B6EEA1F04A404690D7E2CBB6B65B53D9304022D24E83193C651C170C`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测
    /v2/sessions/export 返回 schema 1 + 8 个会话、设置页导出按钮与
    状态元素就位；Rust 171 项（147+19+5）、前端 759 项测试全绿。

## 第三十五次重建（2026-08-09，含第 311 轮帮助中心会话备份说明）

- 合入：security-data 帮助文章（中/英）补全会话备份建议；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,441,792 B，
    SHA-256 `6A7CB887726335FF31D295BBA543911BF4B148FB007A36C9509C5D45B572FEC3`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,847,219 B，SHA-256
    `F7343E9EF0DB24953AAB3360FC219261D8EEBBBC2FF4DB40E48B77CE0D6F61DF`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；帮助文章已伺服
    会话备份说明；前端 759 项、Rust 171 项测试全绿。

## 第三十六次重建（2026-08-09，含第 312 轮会话备份导入）

- 合入：/v2/sessions/import（校验/冲突跳过/归档根写入）+ 设置页导入按钮；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,479,168 B，
    SHA-256 `2597D56211BA947343B3A8F72CF3514B49AB2E2F6C016B0A49E4111AF742F68D`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,910,956 B，SHA-256
    `1A3CB44EDD455F205DCA9F46404941B3C961FF3850D731657EF971FE6257FFF7`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测导出 →
    导入新 id 会话（imported 1、会话列表 +1、写入 sessions/restored）→
    清理后复原；Rust 172 项（148+19+5）、前端 760 项测试全绿。

## 第三十七次重建（2026-08-09，含第 313 轮大纲滚动联动）

- 合入：findActiveOutlineId + capture 阶段 scroll 监听 + 大纲当前标题
  高亮（aria-current）；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,479,168 B，
    SHA-256 `522101CDDD59E58D98FADCB5B6586A5BAF9DB4AF2903AC468B89575F2A0B506E`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,903,047 B，SHA-256
    `FA10F336E454D5236003DC0A5BCBDF4821B09205D7C707FD1FD751A171E15EAF`
- 验证：
  - 安装目录与仓库 public 逐文件一致；`/S` 静默重装后从安装目录启动：
    网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；生产版实测长笔记
    滚动后大纲高亮切换（章节 1 → 章节 2）、无错误；前端 761 项测试

## 第三十八次重建（2026-08-09，含第 345–346 轮窗口大小记忆）

- 合入：桌面窗口大小记忆——`<data_root>/window-state.json` 保存主窗口
  物理尺寸，关闭时（CloseRequested）写入，启动时恢复（Ready 阶段再
  应用一次，避免初始尺寸覆盖）；低于 800×600 的非法值忽略；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,486,848 B，
    SHA-256 `4223910500D098F2A9BDD101E8B051EC4998512C3F343E6935A312D4B8ACA798`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,908,268 B，SHA-256
    `7B8CEC5BC18E811262D75C52C0DA7098C2AC97751ED441E6EEA55CE4068F2E98`
- 验证：
  - 安装目录与仓库 public 逐文件一致（0 缺失/0 哈希差异）；`/S` 静默
    重装后从安装目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）、中继在线；
  - 安装版实测窗口状态：预置 2000×1200 → 启动后 CDP 视口
    1600×960（=物理/1.25，恢复成功）→ WM_CLOSE 写回 → 删除状态文件后
    回到默认 1440×900；Rust 173 项（+1 窗口状态用例）、前端 764 项
    测试全绿；重载控制台零错误。

## 第三十九次重建（2026-08-09，含第 347 轮窗口位置 + 最大化记忆）

- 合入：`window-state.json` 扩展 `x/y/maximized`——关闭时保存
  `outer_position` 与 `is_maximized`，启动（Ready）恢复尺寸/位置并按需
  `maximize()`；非法尺寸忽略；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,488,384 B，
    SHA-256 `DA519B28EBEF4C62E2A926F74388750778B1671DCF64B7B3C507FC00AD5C7795`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,869,955 B，SHA-256
    `41B1B0559FA526D34C977371CCACEB41B87C8634F7AD293DFC1FAC82DC14A6A0`
- 验证：
  - 安装目录与仓库 public 逐文件一致（0 缺失/0 哈希差异）；`/S` 静默
    重装后从安装目录启动：`/health` 200（pi 0.83.0、协议 v2）、中继在线；
  - 安装版实测位置/最大化：先关实例再预置 `{width:1600,height:1000,
    x:100,y:80,maximized:true}` → 启动后 CDP 视口 2048×1210、screenX=0
    （最大化恢复成功）；WM_CLOSE 写回含位置与 maximized 的状态；测试
    状态已清理回默认；Rust 173 项、前端 764 项全绿。
    全绿。

## 第四十次重建（2026-08-09，含第 350 轮窗口离屏位置回退）

- 合入：`visible_position`/`centered_position` 离屏回退——恢复保存位置前
  先检查其是否与任一显示器工作区相交（至少 48px 可见条），完全离屏时
  回退主屏居中；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,490,432 B；安装包
    内嵌（安装目录副本）SHA-256
    `AA1E74B0227C0CB9AC3D87E2AFB79AA04248254CEFC4288C12699E46BA8D020B`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `6B7D39864FA68C8CE34F530BD1FE5583AACD03A6B5B1BDC67385E59B9233F351`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异，功能一致）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,893,778 B，SHA-256
    `7309635A6FD0E98235B44709689A36B39D059A8441D28C615E1CD1DD503DDB34`；
- 验证：`/S` 静默重装后预置 `{width:1600,height:1000,x:-2000,y:0,
  maximized:false}` → 启动即主屏居中（视口 1280×800、screenX=391、
  screenY=270），离屏回退在安装版生效；`/health` 200（pi 0.83.0、协议
  v2）、公网中继 `dev-ax2-01` 在线；验证后窗口状态清理回最大化正常状态；
  前端 764 项、Rust 174 项全绿。

## 第四十一次重建（2026-08-09，含第 352 轮桌面欢迎页撑满 + 窗口状态清理）

- 合入：`message-renderer.css` 桌面欢迎页重做——卡片 `flex:1` 撑满头部
  与输入区之间的全部高度，≥1024px 两栏玻璃面板（品牌/场景 + 快捷入口），
  图标/标题/快捷卡片随视口 `clamp()` 缩放，内容垂直居中；移动端 ≤768px
  布局不变；运行窗口恢复最大化并清理 `window-state.json` 离屏测试残留；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,494,528 B；安装包
    内嵌（安装目录副本）SHA-256
    `B7851CC06358FEDBCCC567FFBF8F15713ED009FD8A0C65C6B3F45AAD07FA608A`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `C6A537957AF2B3AD8C79877F1A6E2B0E914C45D2D00E719DFAA99AD7733BD5E3`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异，功能一致）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,889,002 B，SHA-256
    `5F1527F1286B0F7B1B761638AFD5F0DCAD345221C310C1A5C1EDC92BBD8E6C7C`；
- 验证：`/S` 静默重装后安装目录与仓库 public 297 文件 0 缺失/0 哈希
  差异；从安装目录启动：`/health` 200（pi 0.83.0、协议 v2、`lanUrl=
  https://relay.zicode.com/d/dev-ax2-01`）、公网中继 `dev-ax2-01` 在线、
  日志无 ERROR/WARN/panic；CDP 实测最大化 2048×1210：欢迎卡片
  1440×1004 撑满聊天列、图标 169px、快捷卡片 264×176、内容垂直居中；
  390×844 模拟仍为紧凑单列；前端 764 项全绿、设计 CSS 令牌检查通过。

## 第四十二次重建（2026-08-09，含第 360 轮 confirm 确认修复）

- 合入：`window.confirm` 改道到 dialog 插件已注册的 `message` 命令
  （OkCancel 原生对话框，`dialog:default` 已允许）；全部确认调用点
  await（场景/笔记本/产物删除、API key/渠道移除、Astro 发布、插件
  视图丢弃、插件管理卸载/回滚/吊销）；插件壳导航异步化 + 同目标并发
  去重；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,494,528 B；安装包
    内嵌（安装目录副本）SHA-256
    `0FEB2F6FA0BE690861CA2AF25D53AE77D5A5B69B1988AC281214ABAE46937EFA`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `EB04F4918FB6BE7D6307CDCE6BE02A3E7DCD7700DB3B5E326CFA3482C5219882`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,889,098 B，SHA-256
    `3223FC7B7F391A15F74B5B67016953D8D7FF0EA9C57B57C5CFED1F9DBFD97C93`；
- 验证：
  - `/S` 静默重装后安装目录与仓库 public 297 文件 0 缺失/0 哈希差异；
  - 安装版实测：`window.confirm` 弹出原生"确定/取消"对话框（#32770），
    确定解析 `true`、取消解析 `false`，无 ACL 拒绝与未捕获 Promise
    异常；场景删除端到端：取消→场景保留、确定→场景删除；
  - `/health` 200（pi 0.83.0、协议 v2）、公网中继 `dev-ax2-01` 在线；
  - 前端 768 项（134 文件）全绿、typecheck/Biome/设计检查/权限检查
    通过。

## 第四十三次重建（2026-08-09，含第 361 轮剪贴板复制修复）

- 合入：`public/ui/copy.js` 的 `copyText`（异步 Clipboard API 带 600ms
  超时 + `execCommand("copy")` 回退），消息/工具输出/代码块三处复制
  调用点替换；Rust 主窗口 `enable_clipboard_access()`；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,495,040 B；安装包
    内嵌（安装目录副本）SHA-256
    `40B109F40B3B8DD4FADB1548080AAAD7A6A90BABE894B7ECFBAFDD8EF0AB0CDE`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `01860D23234612D3DF86030306A14384BEF0E0D8606FAF05277C273C3D779AAA`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,881,882 B，SHA-256
    `51A86E38624BA3741090724D5E8D897E4FDEFC6C30B57B868B2E5B5308B6BDC4`；
- 验证：
  - `/S` 静默重装后安装目录与仓库 public 299 文件 0 缺失/0 哈希差异；
  - 安装版实测：真实点击消息复制按钮 → 按钮显示"已复制"，Windows
    系统剪贴板（`Get-Clipboard`）内容为刚复制的消息文本；confirm shim
    仍生效；全程零控制台错误；
  - `/health` 200（pi 0.83.0、协议 v2）、公网中继 `dev-ax2-01` 在线；
  - 前端 771 项（135 文件）全绿、typecheck/Biome 通过。

## 第四十四次重建（2026-08-09，含第 362 轮外部链接打开修复）

- 合入：`app.js` 全局 click 拦截，把 `target="_blank"` 的 http(s)/相对
  链接统一经宿主 `open_external` 命令交给系统浏览器（WebView2 拦截
  新窗口导航，此前 markdown/附件链接点击无响应）；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,495,040 B；安装包
    内嵌（安装目录副本）SHA-256
    `6B2D803B792CC47CA2235E71692E2625D0B704FA91B6DB4E5AF1A6D35DA064FA`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `1EAEF8B3F8A146CF259B4785BF675ACBD5C1DE69EA0F4E5204A201AE83E59EA7`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,932,349 B，SHA-256
    `AEC6225C28250994D79D6D5D264A54635F49A57202FA1EFFACA732B6EE5D6FCA`；
- 验证：
  - `/S` 静默重装后安装目录与仓库 public 299 文件 0 缺失/0 哈希差异；
  - 安装版实测：真实点击 `target="_blank"` 外部链接后默认浏览器
    （Edge）立即打开目标页，应用零控制台错误；confirm/剪贴板修复
    仍生效；
  - `/health` 200（pi 0.83.0、协议 v2）、公网中继 `dev-ax2-01` 在线；
  - 前端 771 项（135 文件）全绿、Biome 通过。

## 第四十五次重建（2026-08-09，含第 363 轮分享按钮 + 文件管理器修复）

- 合入：Tauri 桌面下隐藏 `navigator.share` 分享按钮（桌面 WebView 调用
  必然抛 `NotAllowedError`）；文件浏览器"在文件管理器中打开"修复
  `info?.info?.path` 路径层级（此前 root 恒空、`open_in_app("")` 失败）；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,495,040 B；安装包
    内嵌（安装目录副本）SHA-256
    `E8DD2254F9770ADC089AD5576709D76557E13B8E47541447C9C07DF429855A92`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `69E6F8B71B98290BAC858B311AC74F105A768CAC55FEE0F07E44679D58394AB8`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,884,296 B，SHA-256
    `50AD95E86174455DF5775C3E65CB311C29704F722B2FF78C80C89F0CFC02F3F7`；
- 验证：
  - `/S` 静默重装后安装目录与仓库 public 299 文件 0 缺失/0 哈希差异；
  - 安装版实测：桌面消息区分享按钮不再渲染（0 个）；点击文件浏览器
    "在文件管理器中打开"后 Windows 资源管理器打开工作区根目录
    `C:\Users\ax2`；confirm/剪贴板/外部链接修复仍生效；全程零控制台
    错误；
  - `/health` 200（pi 0.83.0、协议 v2）、公网中继 `dev-ax2-01` 在线；
  - 前端 771 项（135 文件）全绿、Biome 通过。

## 第四十六次重建（2026-08-09，含第 364 轮 Astro 发布工作区作用域修复）

- 合入：`publish_notes_notebook` 命令增加 `workspace_id` 并按作用域取
  vault（此前未作用域导致所有笔记本发布报 "Notebook does not exist"）；
  前端 publishAstro 传入 `workspaceId`；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,495,040 B；安装包
    内嵌（安装目录副本）SHA-256
    `D33D8629CF92C256D85B252AD0B7832C7B8FFF678E2851F983371CD7EE6A5426`；
    打包后 target 副本被回写 bundle 类型标记，SHA-256
    `7AB011C563D8A8D58925B349798CF5B0362561E47954877CACF1FB2E478BDA76`
    （与安装副本仅 `__TAURI_BUNDLE_TYPE_VAR_*` 3 字节差异）；
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,897,304 B，SHA-256
    `AFC1C79891D92197A9F3D3F6A8CD8F80D75EFC7A10EF23F70E8ED654820CE993`；
- 验证：
  - `/S` 静默重装后安装目录与仓库 public 299 文件 0 缺失/0 哈希差异；
  - 安装版实测：临时笔记本执行 `publish_notes_notebook` 成功——bun
    install + astro build 完成，`dist` 产物生成，publish.log 显示
    "[build] 2 page(s) built in 4.14s" + "Complete!"；"打开文件夹作为
    工作区"原生选择器正常；confirm/剪贴板/外部链接/分享/文件管理器
    修复仍生效；
  - `/health` 200（pi 0.83.0、协议 v2）、公网中继 `dev-ax2-01` 在线；
    全部临时数据已清理，vault 恢复 QVeris 5 篇 + 测试笔记本 0 + 回收站 0；
  - cargo check、typecheck、前端 771 项全绿。

## 第十九次重建（2026-08-09，含第 288 轮 Rust 门禁修复）

- 合入第 288 轮：`save_note` 参数 lint 允许 + 全量 `cargo fmt`
  （artifact_store/host_server/notes_vault/relay_server 纯格式改动），
  `check-rust.sh` 首次全绿；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `3EBD3D2B04F415F6026EAF72D097736E7B43C91CA4FDF7977F75B91FE595D7E6`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,838,285 B，SHA-256
    `6EFB40A52D0949CAD7268160837CDA2BDE3B3AC9DDD470C5A701BE03AFAE4D27`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。

## 第二十次重建（2026-08-09，含第 290 轮 Biome 全量清零）

- 合入第 290 轮：i18n 重复键、死 CSS 规则、未用导入、index.html 缺
  闭合 `</div>`、未用解构变量全部修复，`biome lint .` 447 文件首次
  0 错误 0 警告；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `F76C9EDF42D3F5C831924232A334390DCABB8FD27BB1B7DC5969C58BE3FD9EEF`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,854,474 B，SHA-256
    `EC16B2E9957434A9D63C5BE59C382198B93C3F98D970B05C34E0D5DCD79B7EC3`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。

## 第二十一次重建（2026-08-09，含第 292 轮显示思考过程开关修复）

- 合入第 292 轮：message-renderer.css 的思考块隐藏规则从
  `body.hide-thinking`（无代码设置）改为 `body[data-show-thinking="off"]`
  （设置面板实际写入的机制），开关首次真正生效；新增布局契约断言；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `A9E5C17B45E113DB8B48ABE11F438803A88CC7B254B824785A02E1277D767CBE`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,833,530 B，SHA-256
    `7241E77C928A9471962927F80CAE981B4108E52FD7A8CC6F7D6B7D22CEB18B7A`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。

## 第二十二次重建（2026-08-09，含第 294 轮自动压缩上下文接入运行时）

- 合入第 294 轮：settingsWidgetsStore 新增 `setAutoCompaction` 发送
  `set_auto_compaction` 运行时消息，toggle 时立即发送；app.js
  `adoptTarget` 在新会话启动时应用持久化偏好；操作类型放宽；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `F8C97357F641864C9A8C115E01B17066CF1B206281CE54A1563C21BFD8A081ED`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,859,247 B，SHA-256
    `554A5578B2ED9220CB92911AF3490DBEB4C1AD0FCBC730E7E5246255AFB8E147`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。

## 第二十三次重建（2026-08-09，含第 296 轮命令面板系统命令本地化）

- 合入第 296 轮：5 条系统命令 label/desc 全部经 t() 本地化，补 8 个
  zh-CN 翻译键，命令面板中文过滤恢复正常；新增布局契约断言；
- 产物：
  - `target/release/zicode-studio-desktop.exe`：41,320,960 B，
    SHA-256 `7404BA5881305D87808939D73956E7058413AE09CE803D7F8F38E43F6F79EA69`
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    346,844,660 B，SHA-256
    `81FC73917817FFF0AB56928F8344081D0FAF9FC01176391143E26334D0D35D62`
- 验证：
  - 安装目录 297 个文件与仓库 public 逐文件一致；`/S` 静默重装后从安装
    目录启动：网关 `/health` 200（pi 0.83.0、协议 v2、
    `lanUrl=https://relay.zicode.com/d/dev-ax2-01`）；日志无
    ERROR/WARN/panic。
