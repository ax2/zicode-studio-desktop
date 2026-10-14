# 开发者平台跨系统验证

ZiCode Studio Desktop 的目标桌面系统为 Windows、macOS、Linux。源码检查、实际运行、
界面验收和安装升级需要各自的证据，不能用某个平台的单元测试结果替代全部验收。

## 本地统一入口

准备 Node、Bun 1.3.14、Rust（含 Clippy/rustfmt）、Git、Go 1.22 或更高版本，以及带 venv 的 Python 3，
先执行 `bun install --frozen-lockfile`，然后运行：

```powershell
bun run check:platform --out E:\tmp\zicode-platform-evidence
```

macOS/Linux 可改用 `/tmp/zicode-platform-evidence`；省略 `--out` 时写入系统临时目录。
每轮创建独立系统/架构/UUID 子目录，不覆盖以前的结果。该入口直接调用工具，
不依赖 Windows Bash/WSL，不执行 Tauri release build，也不生成安装包。
Linux 需要与 `.github/workflows/developer-platform.yml` 一致的 WebKit/GTK 系统开发库。

入口现在先按锁定版本准备内嵌 Pi（必要时联网下载并校验摘要），再构建扩展 ESM，用于真实 Pi→Host 插件调用用例；不生成桌面安装包。

输出包括：

- `results.json`：系统、架构、开始/结束时间、Git revision、工作区 dirty 状态、工具版本、逐步结果；在 GitHub Actions 中还记录仓库、运行编号、尝试次数、事件、ref、触发 SHA 与检出源码的核对结果。
- `summary.md`：结果导航与日志链接。
- 每一步的 `.log`：原始检查输出。报告不保存环境变量、令牌或凭据配置。

未提交工作区的结果会明确记录 `dirty: true`；它不能单独证明同名 Git revision 中的代码已通过。
CI 报告要求仓库与 `scripts/release-repository.json` 中的目标一致，运行编号、尝试次数、事件、ref 均可识别，且触发 SHA 等于检出 HEAD、工作区干净；还要求实际系统、架构及 `rustc` 主机目标等于矩阵行声明，显式 `CARGO_BUILD_TARGET` 若存在也须匹配。任一不符就立即停止平台检查并将报告标为失败。
报告在每一步后保存；被中断的执行保留 `running` 状态，不算完成或通过。

## 检查范围

| 检查 | 内容 |
| --- | --- |
| TypeScript / lint / design | React 前端类型、三个外部数据客户端、平台核心与 41 个扩展源码文件的严格类型，静态规则和设计系统；测试文件另由测试流程处理 |
| 完整 JavaScript 入口 | 必需执行 `bun run test`，覆盖全部 public、frontend、extensions 与 scripts 测试，再执行权限、Windows 子进程与词典规则；下列前端/网关步骤另保留定向日志 |
| 前端 UI / 网关 | 完整 frontend/src 测试目录，包括项目、知识、任务、自动化、设置、金融及共享组件；另保留选定原生网关、扩展任务存储版本校验、真实双进程竞争、草稿磁盘恢复与派发隔离 |
| Tauri 命令权限 | 已注册原生命令、具体权限声明、默认集合及 capability 引用的一致性；缺失为必需检查失败 |
| 真实 Pi / Host 插件链路 | 显式执行资源依赖的集成用例，NativePiManager 启动内嵌 Pi，打包插件 execute 调用真实 Host 搜索临时笔记并确认结果；不调用模型与外部账户 |
| 真实资源 Worker HTTP 链路 | 普通 Cargo 测试先生成并检查当前平台的桌面二进制 Worker 入口，再显式运行默认忽略的 Host 专项：资源授权、WASI 输出、未协商类型拒绝、确认保存、跨插件接力、取消与失败隔离。每个平台必须生成可解析且 `passed=true` 的结构化收据，否则即使测试进程退出 0，平台检查也失败；这不是 WebView 或提供方实包验收 |
| Windows 子进程规则 / i18n | 进程启动约束和中英文覆盖 |
| Rust check / test / Clippy | 锁文件约束下全目标编译检查与默认测试，含项目工具目录持久化/隔离/CAS、真实 PATH 子进程与 PTY、终端输入/尺寸/停止/子进程回收、模型工具的真实本地 HTTP 调用和 Host 权限检查；插件运行时 HTTP 路由覆盖身份、会话、过期、停止与当前授权，运行时使用内存替身 |
| Cargo/Go 生命周期 | 显式执行默认忽略的真实临时工程用例，运行 cargo check 和 go test |
| Python 虚拟环境 | 创建不带 pip 的临时 .venv，检查 unittest 的 sys.prefix、VIRTUAL_ENV 和 PATH |
| Rust format | 沿用仓库既有 advisory 约定，漂移单独记为 warning |

必需检查或工具版本读取失败时入口退出 1；仅存在 advisory 时记录 `passed_with_warnings`。
没有执行完、子进程被终止、缺少工具或无法启动命令都不能算通过。
本地 Node 25+ 运行 jsdom 时自动关闭默认 Web Storage，避免与测试环境冲突；普通 Vitest 默认 forks 入口也在配置中应用这一参数，见[本地入口日志](iterations/2026-10-02-local-vitest-storage.md)。CI 固定 Node 22。
CI 同时安装 Python 3.12；Python 真实环境用例默认忽略，但统一入口会显式执行。

## PR 与 CI

独立工作流 `.github/workflows/developer-platform.yml` 使用只读仓库权限，
在 PR、main 推送和手动触发时分别检查 Windows 2022 x64、macOS 15 ARM64、macOS 15 Intel x64、Ubuntu 22.04 x64。
矩阵关闭 fail-fast，一个平台失败不取消其他平台；执行超时为 90 分钟。
每个平台无论成功或失败都保留已有日志和报告 14 天。

该工作流配置存在不代表已经执行。记录真实 CI URL、commit、平台和结果后，才可把对应系统列为已验证。
本地新增工作流不自动触发远程运行，也不修改既有发布流程。

## 仍需单独验收

- Tauri/WebView 启动、渲染、键盘与触屏交互、各主题及视口截图。
- 干净机器上的内置运行时、系统路径、凭据存取与文件权限。
- Windows EXE/完整可运行目录、macOS 应用、Linux 交付物及安装、升级、回滚、卸载。
- 远程与移动端的真实连接和权限交互。

当前各阶段结果与缺口见[平台推进计划](developer-platform.md)和[本轮工作日志](iterations/2026-09-26-platform-checks.md)。

2026-09-29 只读核对到旧版 `v0.1.0` 的四个公开安装包及 GitHub 摘要，见[远端 Release 证据](iterations/2026-09-29-remote-release-evidence.md)。该版本属于 2026-07-30 的 tag；当前 HEAD 的最近可见 Release 工作流运行失败且未列出 job。旧资产不能替代当前工作树的三平台 CI 与实机验收。

2026-10-01 显式按 `ax2/zicode-studio-desktop` 查询，远端默认分支仍找不到 `developer-platform.yml` 工作流；最近可见 Release 运行仍为 2026-08-23 的失败记录且 Job 清单为空。当前克隆另有只读 `upstream`，未指定仓库的 `gh` 曾选中上游，因此后续 GitHub 查询应显式使用 `-R ax2/zicode-studio-desktop`。见[仓库上下文记录](iterations/2026-10-01-github-repo-context.md)。

2026-10-01 再次只读查询，最近的 Pi 更新运行 `36736922526`（2026-09-30）在旧提交上因缺失 `dependencies` 标签失败；本地工作流另加入上游版本格式与 Release notes 文件边界，仍需提交后由真实运行确认。见[上游输入边界日志](iterations/2026-10-01-pi-update-release-input.md)。
