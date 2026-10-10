# 2026-09-29 配对二维码凭据

状态：代码与前端产物已更新，Windows 本地编译和静态检查通过；实际窗口与手机配对待验收。

## 目标与发现

- WebSocket 桌面握手已要求由原生窗口注入的随机令牌，但 `/v2/lan-qr` HTTP 入口此前只核对回环 IP。
- 该入口会签发一次性配对链接；普通本机浏览器在没有 `Origin` 或 Fetch Metadata 标记时仍可能触达。
- 二维码界面直接调用该 HTTP 入口，前端可把已有窗口令牌放入请求头。

## 修改与决定

- `/v2/lan-qr` 在回环 IP 之外还校验 `x-zicode-desktop-token` 与本次 Host 的窗口令牌；缺失或不符时不签发链接。
- 二维码界面从原生应用启动信息接收令牌，加载二维码时发送该请求头；刷新入口时若无令牌则隐藏按钮。
- 同步更新原有前端夹具的请求形状，并重新生成 React 页面产物。本轮不新增或运行测试。

## 验证与遗留

- `bun run typecheck`、目标前端文件的 Biome lint、相关 JS 语法、`bun run build:react`、`cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、Host rustfmt 与差异空白检查通过。整文件 Biome check 仍受该页面现有导入排序和格式漂移影响。
- Windows、macOS、Linux 原生窗口及真实手机配对尚未验收。本地模型网关仍由本机 Pi 运行时调用，其鉴权模型需单独审查。
