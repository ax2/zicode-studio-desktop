# 2026-09-26 开发者个人平台工作日志

## 目标与现状

- 持续目标：全方位、跨平台的开发者个人平台应用。
- 开始时工作目录为 `D:\Work\zicode-studio-desktop`；环境切换后以
  `E:\zicode-studio-desktop` 为准，基线 `02bd9552`，继续前核对了已落盘修改。
- 开始时存在 Windows 打包、发布与 `main.rs` 等未提交修改，本轮保留。
- 当前源码已迁移多项 UI 到 `frontend/src/features`，旧 AGENTS 的纯 vanilla 描述已过时。
- 项目总览有笔记、产物、会话、文件、任务等聚合，Git 仅在旧 workspace info 提供分支名。
- 本轮增加独立的 Git 读取模块和项目面板，更新长期能力路线。

## 实现与关键决定

- 新增 `host_data/git_status.rs`：独立于 Pi 会话读取 Git；Host 按已注册 workspace ID
  解析路径，前端不能传任意路径或执行命令。Git 子进程继承统一的 Windows 隐藏窗口策略。
- porcelain v2 + NUL 分隔保留重命名前后路径、空格、中文和换行；显示分支、上游本地引用、
  暂存、未暂存、冲突、未跟踪状态。读操作禁用可选索引锁和 fsmonitor，不访问远程。
- 每次 Git 子命令最多 5 秒，每个输出流上限 2 MiB；最多展示 200 项，但保留完整条目计数。
  超限和失败显示独立错误。子模块内部改动不检查，未跟踪目录按一个条目计数。
- 新增独立 React Git 面板和 CSS；支持面板刷新与项目顶部刷新，复用设计令牌和中英文词典。
- 项目 store 对加载、搜索增加请求代次校验；目标变更时清理草稿和搜索结果，旧响应不能
  覆盖新项目数据。Git 面板也在切换目标/刷新时立即隐藏过期结果。
- `ProjectWorkspaceApp.tsx` 与 Host 分发文件超过 500 行，本轮只加入模块接线；
  新功能实现在独立文件。`main.rs` 仅等价合并一个旧的嵌套 if，以消除 Clippy 门禁错误。
- 设计门禁另发现既有 settings 表单 `gap: 2px`，改为同值 `--space-0-5`。
  同步构建项目 React 包与 CSS 包，并清理构建产生的无关 React 包变化。

## 验证证据

- `bun run typecheck`、`bun run build:react`、`bun run bundle-css`：通过。
- `bun run check`：通过；仓库仍有既有 lint warnings/info。新增模块和修改的数据网关、
  项目 store 的定向 Biome lint 无诊断。设计门禁通过。
- 项目、Git 面板、数据网关：26 项通过。覆盖晚到响应、项目切换、清理草稿、失败重试、
  中文提示、分离 HEAD、列表截断、特殊路径显示及网关成功/错误响应。
- 当前 Node 默认启用的 Web Storage 与旧测试使用的 jsdom localStorage 不兼容，首次
  项目测试在清理阶段失败；使用临时 `NODE_OPTIONS=--no-experimental-webstorage` 后通过。
  未更改系统 Node 设置，未替换测试存储实现。
- `bun run check:rust`：通过。Rust 共 287 项通过、3 项既有忽略；类型检查和 Clippy 通过。
  真实仓库测试包含普通目录、初始分支、暂存重命名、工作树改动、中文未跟踪文件、
  子目录作用域、分离 HEAD，以及检查前后索引字节保持一致。
- 新增真实 Host WebSocket 验证：注册项目返回分支和未跟踪文件；不存在及缺失的 workspace
  ID 分别返回 `workspace_not_found` / `invalid_workspace`；请求附带的路径、命令不被采用。
- Windows 子进程策略：通过。中文覆盖：2088 个词条、缺失 0。
- 默认 Python 未安装 MkDocs，使用隔离环境命令
  `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict` 后严格构建通过。
- `git diff --check`：通过。

## 未完成与后续

- 为实际渲染准备了仓库外模拟数据验收页；Chrome 连接不可用，Edge 建页及查询标签两次均
  返回 `nodeRepl.fetch request failed`。因此没有本轮页面截图、真实浏览器交互或窄屏验收
  结论。临时预览服务已停止；不能将组件测试解释为完整桌面 UI 验收。
- 本轮没有 macOS/Linux 实机、安装升级或新安装包证据，没有发布版本或推送远端。
- Cargo fmt 仍报告仓库既有格式偏差（脚本中为 advisory）；新增 Rust 模块已单独 rustfmt。
- 下一轮优先补视觉验收，推进 Git 差异、开发环境诊断和项目运行任务。
  平台整体目标保持进行中。
