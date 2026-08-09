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
