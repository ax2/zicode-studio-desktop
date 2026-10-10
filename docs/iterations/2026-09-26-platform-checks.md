# 2026-09-26 跨平台开发者能力检查

状态：统一入口和三平台工作流已实现，Windows 本地完整执行通过（含已有格式 advisory）。
远程 CI 尚未运行。上一轮完成多语言命令接入与 Windows 临时工程运行验证，属于实质进展。

## 本轮发现

- 普通 PR 工作流只运行 Linux 前端检查；Rust 三平台检查位于发布工作流。
- 现有本地 Rust 检查依赖 Bash，不能直接提供按平台分组的机器可读证据。
- Cargo/Go 实际工具链用例默认忽略，普通测试通过不能证明该用例已执行。

## 计划

- 新增独立 Windows/macOS/Linux PR 检查，不改动既有发布流程。
- 提供统一本地入口，直接调用 Bun/Cargo/Go，不依赖 Windows Bash 或 WSL。
- 记录操作系统、架构、工具版本、Git revision/dirty 状态、逐步骤退出码及日志。
- 明确执行工具链专项用例；把未完成、缺失工具与启动错误当作失败。
- 格式漂移沿用 advisory，单独记录，不混为完全通过。
- 当前仅能现场验证 Windows；未运行的远程 CI 和其他系统仍保留未验证状态。

## 实现记录

- 新增 `scripts/developer-platform-checks.mjs` 与 `bun run check:platform`。
  使用 native spawn、固定参数、隐藏 Windows 窗口和文件日志，不通过 Bash 或拼接 shell 命令。
- 每次创建独立证据目录；逐步保存 `results.json` 和 `summary.md`，中断保留 running。
  超时、信号终止、缺失工具、启动错误和未知状态均不能归为 passed。
- 新增三项检查器单测，覆盖失败分类、实际工具链用例必须执行、锁文件约束和原生子进程启动。
- `.github/workflows/developer-platform.yml` 使用只读权限和不持久化 checkout 凭据；
  三个平台独立检查并保留日志，未修改既有 release 工作流。
- 工作流 YAML 解析及三个系统、只读权限、fail-fast 关闭、失败后日志保存断言通过。
  这属于配置验证，不代表远程执行结果。

## 本地执行证据

- Windows x64；Node 26.10.0、Bun 1.3.14、Rust/Cargo 1.88.0、Git 2.47.0、Go 1.23.4。
- 证据目录：`E:\tmp\zicode-platform-evidence\win32-x64-72d8ca9b-2fbd-4dc0-ac53-32d7696e8419`。
  工作区 dirty 状态为 true，报告不能当作干净 commit 的通过证明。
- 九项必需检查通过：类型、lint/设计、项目 UI/网关、子进程策略、i18n、Rust check、
  Rust 默认测试、实际 Cargo/Go 生命周期、Clippy。
- 前端/网关/检查器 73 项测试通过；Rust 默认 310 项通过 / 4 忽略；
  工具链专项另行执行 1 项通过，实际 cargo check 与 go test 均退出 0。
- Rust format 记录为 warning，整体结果为 `passed_with_warnings`；未把格式漂移隐去或宣称全部检查无告警。
- 严格 MkDocs 构建通过。完整使用说明见[跨平台验证](../platform-verification.md)。

## 遗留

- 工作流尚未提交、推送或触发，macOS/Linux 的编译、运行结果仍缺失。
- 没有新增视觉/WebView、安装升级卸载或发布证据；没有生成应用安装包或 ZIP。
- 后续应在实际 CI 运行后记录各平台 URL、revision、测试结果，再处理平台特有失败。
