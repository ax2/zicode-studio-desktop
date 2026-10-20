# 接收端测试签名包与 Pi Debug 运行链路（2026-10-17）

## 目标与输入

核对 Studio 当前 Debug 运行目录能否通过插件接收端完成签名安装、按需调用和 Pi 工具代理。输入是 `.cache/task-scratch/signed-candidate-OEOMcY/first.zicode-plugin`，约 102 KiB；`package-verification.json` 标记 `testOnly=true`，签名来自临时接收端测试密钥，源修订为 `6b23a715` 且构建时有脏修改。它不是 Zi DevTools 正式发布的签名包。三份测试容器的 SHA-256 均与该收据一致；首包 SHA-256 为 `99aca06d74fe5566866a0a3c314d1b0db310faf1a6441c86398d3ab3bd9efc0b`。

当前 `target/debug/zicode-studio-desktop.exe` 与 `pi/pi.exe`、`extensions/plugin-broker.mjs` 位于同一运行目录。运行目录中的 Pi 报告 1.3.0，与 `scripts/pi-version.json` 一致。Debug 目录无冻结交付 `BUILD.json`，因此专项测试对 Debug 资源和版本做实际检查；原有冻结交付路径仍逐文件检查 `BUILD.json` 摘要。

## 修改

- `src-tauri/src/host_server/devtools_text_tests.rs`：两个原有 ignored 实际运行测试可显式传入 `ZICODE_TEST_SIGNED_ROOT`，改用接收端签名安装；无该变量仍使用开发夹具。
- Pi 专项可显式设置 `ZICODE_TEST_DEBUG_RUNTIME=1` 验证当前 Debug EXE、Pi 与 broker，避免把 Debug 目录误当冻结交付。测试 Pi 关闭用户扩展自动发现，并使用独立 `PI_CODING_AGENT_DIR`。

## 验证

- 接收端签名生命周期专项：1/1，通过安装、元数据升级/回退、篡改拒绝与数据保留。首次误带 `--exact` 导致 0 个用例运行，纠正后重新执行，0 个用例的输出不计作通过。
- 真实 Host HTTP/Worker 专项：1/1。隔离 Host 中安装首包，实际调用 JSON 格式化、Base64 编码/解码、JSON 压缩，并检查摘要与无效编码业务错误；四次正常调用约 528、622、595、546 ms。
- 实际 Pi→Host→Worker 专项：1/1，依次通过 `run`、`revoked`、`restored` 阶段。覆盖搜索、按需加载、执行、撤销后缓存调用拒绝及恢复。
- `bun run check:rust:static` 退出 0；Cargo check 与严格 Clippy 通过。`cargo fmt --check` 只报告既有格式漂移 advisory。
- 测试各自隔离目录在成功后由自身清理。未生成新 Release、ZIP 或另一套 target；未重试此前审批拒绝的删除。

## 证据边界与下一步

这些是当前 Windows Debug 的进程级证据，尚未在原生 Studio 界面确认插件发现、结果展示与用户操作。桌面隔离配置中的测试包安装等待操作时确认，不以本页代替该验收。Zi DevTools 提供方目录目前没有可用的正式签名 `.zicode-plugin`；154 项完整工具接受仍为 0，ZiFile 的完整功能接入也未验收。待提供方签发包后，按真实包重新跑同一链路并补齐原生界面、权限/保存以及其他系统的证据。
