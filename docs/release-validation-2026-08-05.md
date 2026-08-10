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
