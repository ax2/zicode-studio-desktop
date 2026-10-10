# 项目终端启动意图与安全重试（2026-09-30）

## 目标与发现

终端启动请求超时或断线时，旧客户端只能刷新列表，无法确认 Host 是否已创建 Shell。用户再次点击新建可能产生第二个终端。Host 原先为每次启动随机生成会话 ID，没有识别重复创建意图的依据。

## 修改与决策

- 桌面客户端仅在终端列表明确报告 `openIntentSupported` 时，为一次创建生成 UUID，并随启动请求传给 Host；旧 Host 保持旧流程。
- Host 在终端管理器锁内先查已有意图，同工作区与目录返回原会话，冲突目录或工作区拒绝。新会话返回意图 ID，列表与读取也保留它。意图输入必须是 UUID。
- 已淘汰会话的近期意图最多保留 512 项，再次收到同一意图时拒绝创建。超过此窗口不承诺永久去重。
- 启动结果不明确后仍要求显式刷新。列表若找到同一意图，直接选中原会话；若未找到且 Host 支持该协议，按钮改为重试原目录与同一 UUID。当前页面生命周期结束时清除待重试意图。
- Host 不自动重试 Shell；旧客户端与旧 Host 仍可互通。新客户端不会向未声明支持的 Host 发送意图 ID。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、`cargo check --all-targets`、`cargo clippy --all-targets` 和本轮 Rust 模块的 `rustfmt --check` 通过。未运行测试或真实 PTY/Shell，也未在 Windows、macOS、Linux 验证超时与断线竞争。近期意图保留窗口不是跨 Host 重启的永久幂等记录；Host 退出时终端本身也会结束。
