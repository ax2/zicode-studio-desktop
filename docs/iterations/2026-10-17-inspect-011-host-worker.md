# Inspect 0.1.1 隔离 Host/Worker 实际执行（2026-10-17）

## 目标与隔离

在只读收据核对之后，验证当前 DevTools Inspect 0.1.1 **无签名候选**能否通过 Studio 真实 HTTP Host 调用生产 Worker；不使用用户已安装的 Studio 会话，也不把开发目录当正式签名插件。新增默认 `ignore` 的专项测试，只有显式提供候选目录、外部收据及当前保留的 Worker EXE 路径才执行。测试使用项目 `.cache/task-scratch` 中独立 profile；成功后移除自己创建的临时目录。没有修改 DevTools，也没有复制正式完整运行目录。

## 实现与验证

测试先调用 Studio 原有的 `verify:devtools-package` 核对外部 606 文件收据和目录索引；开发目录安装到隔离管理目录后，按同一外部收据再次核对复制结果。然后启用插件，通过真实 `/v2/plugin-capabilities/invoke`、当前源码 Test Host 和保留的 Windows Debug EXE Worker，逐项执行颜色 1、YAML/JSON 2、CIDR 1、JWT 1、Unicode 3，共 8/8；结果文本逐字对照提供方样例。无桌面令牌请求得 403，非法 YAML 返回 `INVALID_INPUT`，停用插件后调用被拒绝。此专项不启动 Pi，也不验证原生工具中心界面。

定向测试两次实际运行均通过，第二次原始输出归档在技术博客 `iterations/inspect-011-host-worker-2026-10-17/cargo-test.log`，SHA-256 `5bdf002f7bca0b0286ce42a561848a463222b7a94f0feff2adb1935fe423f1e1`。Worker EXE `target/debug/zicode-studio-desktop.exe` SHA-256 `af44dd1392fa156d8ff002ea3adb0d2e48bb504b400ff795877920c3b84e79d3`。Host 测试编译来自 HEAD `72f4b0ee99dff4778d407a66a78330a275593341` 加当前未提交工作树；没有将它误标成正式发布版本。第一次尝试因测试文件的 `Path` 被 Axum 类型遮蔽而编译失败，改用 `std::path::Path` 后通过；该失败未运行测试或安装候选。

`bun run check:rust:static` 的 Cargo check 与 Clippy 通过。全仓库 rustfmt 仍有既有漂移，新测试文件单独 rustfmt check 通过。前后只读扫描：`target` 29,423,948,875 → 29,423,996,501 逻辑字节（增加 47,626）；task-scratch 保持 932,850,915 字节、31866 文件，且没有 `inspect-011-host-*` 遗留目录。E 卷可用 36,196,917,248 → 36,150,435,840 字节，卷级差异可能来自其他进程，不归因于本轮。

矩阵更新后 `bun run vitest run scripts/devtools-pi-evidence.test.js` 4/4 通过；JSON 解析确认 154 工具、完整接受 0、Inspect 0.1.1 的 8 能力及 5 个来源工具引用。测试后的另一次只读扫描确认 `target` 和 task-scratch 逻辑大小与上文结束值相同。

## 矩阵与剩余验收

完整 154 工具矩阵保持 `fullToolsAccepted=0`。本轮把颜色工具从“等待提供方候选”移到“已收到候选”，五个来源工具均指向新的 0.1.1 Host/Worker 证据；保留 0.1.0 历史候选证据。仍缺正式签名 `.zicode-plugin`、升级/回退/撤权、Pi 授权与权限生命周期、Tool Center 真实 UI、结果接力/确认保存、边界与超时/取消、macOS/Linux。ZiFile 108 格不变。本轮无 UI 修改、截图、版本号变更、ZIP 或发布。
