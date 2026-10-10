# 2026-09-26 Host 连接退出与资源回收

状态：实现与 Windows 自动化验证完成，原生退出及其他平台待验收。

## 发现与目标

- 上轮全套测试一次出现 P2P Host 临时目录占用，独立复跑通过；不能据此认定产品生命周期正确。
- 当前 Host 停止仅通知 HTTP 监听器，已升级 WebSocket 不接收退出信号，首帧等待也没有取消路径。
- WebSocket 结束时没有显式关闭 P2P PeerConnection，数据转发任务没有受控回收；重复 offer 还会覆盖旧 answerer。
- 建立独立生命周期模块，跟踪监听、后台任务和升级连接，增加可等待退出；应用退出触发取消，P2P 正常断开和替换都关闭旧连接。
- 退出超时必须返回未完成，不能把延长测试清理等待作为修复。

## 实现与关键决定

- 新增 `host_server/lifecycle.rs`，复用已锁定的 tokio-util TaskTracker/CancellationToken；跟踪任务析构完成后才唤醒等待者，避免仅用作用域计数提前返回。
- 新增 `websocket_session.rs`，将完整 WebSocket 会话处理从大型 Host 文件迁出，主文件仅保留升级入口、启动接线和兼容停止方法。
- HTTP/LAN/公网监听、运行时清理、relay/poll 后台工作与升级连接纳入生命周期。启动中途失败的 guard 会取消已启动的后台任务。
- WebSocket 首帧等待、握手确认及主循环可被退出信号取消；正在等待的异步请求也能离开会话循环，随后进入 P2P 清理。
- P2P 协商开始时即保留 PeerConnection 引用，以便协商失败或取消时关闭；旧 offer 替换、会话结束时关闭 PeerConnection 并 abort/await 消息转发任务。
- `stop_and_wait` 提供测试和消费型停止屏障；应用退出通过共享 `request_shutdown` 与 `wait_for_shutdown` 调用同一机制。等待上限 8 秒，超时返回错误并记录未完成，不声称资源已全部回收。
- 原有停止 API 和 Drop 保留兜底通知；项目命令 stop_all 与 NativePiManager 退出清理继续执行。
- Host 协议测试改为等待明确退出再清理临时目录；生产仍使用原有稳定端口策略，测试使用系统分配端口。

## 验证过程

- 新增生命周期单元测试覆盖取消后台工作、等待资源析构、超时不误报成功，以及启动失败取消后台工作。
- 新增真实 WebSocket 用例：客户端保持连接、未发 hello 的连接、已完成握手的空闲连接，以及应用共享状态退出路径；等待后检查原连接关闭、HostState 释放与临时目录立即删除。
- 原有真实 WebRTC/P2P 路由测试改为客户端仍在线时停止 Host；等待完成后检查状态引用释放，关闭客户端 peer，并立即删除目录，不再依赖重试清理。
- 首轮编译修正了 TaskTrackerToken 路径与 graceful shutdown future 的所有权。后续首次全套测试的“停止后 TCP 新连接必失败”断言在并行套件中失败，单独复跑通过；该断言不能隔离端口复用，改为核对原客户端连接与原 Host 的资源释放。
- 测试端口使用空范围的初稿触发 Clippy reversed_empty_ranges，已改为显式测试分支；后续 Rust 检查通过，最终代码继续执行统一门禁。

## 范围与遗留

- 回收屏障覆盖注册到生命周期中的连接、监听器与后台任务；外部持有的存储/运行时句柄，以及已启动且不能取消的 spawn_blocking 工作不等同于已回滚或已完成。
- 正在退出时取消客户端等待，不保证已发送的运行时命令或已经发生的文件副作用回滚；不会自动重发请求。
- 原 P2P 目录占用的单次历史失败没有足够证据证明唯一原因。此次修复针对已确认的连接生命周期缺口，并以新测试核实回收结果。
- Windows 已执行本地源码、协议和实际连接验证；Tauri 原生退出事件、多设备 TLS/relay、macOS/Linux 实机仍需单独验收。
- 本轮没有改动前端界面，没有新的布局/截图验收；未推送、发布或生成安装包。

## 统一检查结果

- `bun run check:platform` 的 10 项必需检查全部通过，状态 `passed_with_warnings`；Rust 全仓格式仍为既有 advisory。
- 前端/扩展/网关 36 个文件、472 项通过；Rust 默认测试合计 338 项通过、5 项忽略；真实 Cargo/Go 与 Python 虚拟环境生命周期用例通过。
- 类型、静态/设计、Windows 子进程规则、Clippy、2241 项翻译覆盖均通过。MkDocs 严格构建和差异空白检查通过。
- 统一证据：`E:\tmp\zicode-host-shutdown-evidence\win32-x64-1b2654f2-987e-4df0-909b-0df6b329e76b\summary.md`。
- 真实 P2P 关闭用例连续 5 次独立复跑通过，日志为 `E:\tmp\zicode-host-shutdown-p2p-1.log` 至 `-5.log`；最终 `bun run check:rust` 通过，日志 `E:\tmp\zicode-host-shutdown-rust-final.log`。整体开发者平台目标仍在推进。

