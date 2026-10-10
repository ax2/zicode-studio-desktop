# 2026-09-26 项目工具目录

状态：实现和 Windows 自动化验证完成；界面、macOS/Linux 实机待验收。

## 目标与决策

- 按注册项目保存本机工具目录顺序，统一环境诊断、命令运行器和新建 PTY 的 PATH；不修改 Host 全局环境。
- 本机 SQLite 保存目录与修订号，项目目录不写机器路径。使用修订号校验防止多窗口覆盖。
- 最多 8 个已存在的绝对目录，显式选择目录优先于 Host 默认工具。保存仅检查目录，不运行程序；启动和检查时重新校验。
- 运行中的任务/终端保持启动快照；配置变化使旧命令目录指纹失效，要求刷新后再启动。
- Python 命令继续优先使用命令目录的 `.venv`，工具目录用于其宿主解释器回退。任意环境变量、自动安装和 Pi 运行时替换不属于此配置。

## 验证计划与过程

- 验证持久化、项目隔离、冲突、失效目录、工具优先级、子进程 PATH 和远程写入拒绝。
- 前端覆盖加载、保存、冲突恢复和切换过期响应；执行统一平台检查与文档 strict 检查。
- Browser 再次调用 `cua.getState()` 返回 `Browsers: Error: nodeRepl.fetch request failed`，界面实机验收仍不可用。

## 实现与发现

- 新增 `project_environment` 存储与解析模块、Host 适配模块和独立 UI 表单。设置文件为本机数据目录的 `project-environments.sqlite3`，作用域包含注册工作区 ID 与规范化目录；不记录环境变量或凭据。
- 数据库使用事务和修订号 CAS，保存失败不会修改内存默认环境；数据库不可用时明确失败。清空目录仍保留修订号，避免旧窗口覆盖。
- 命令指纹加入配置快照，启动再次加载并比较。配置目录不可用时阻止新的启动和诊断，停止及历史读取不依赖该配置。
- 新增真实工具目录夹具（带空格）、Host WebSocket 请求、命令子进程与 PTY 检查。初次 PTY 批处理用例未能在项目目录生成预期文件；把 Windows 规范化的 verbatim 工作目录在进程边界转为普通 Win32 路径后，真实调用通过。规范化身份与目录边界校验保持使用原路径。
- 新增 Windows 工作目录前缀转换检查，以及 Python `.venv` 优先级和其他 PATH 目录保留检查。
- 表单明确加载、保存、清空、冲突和结果不确定状态。冲突保留草稿，重新加载后才能再次保存；切换项目丢弃过期响应。
- 主入口、Host 大文件与项目页面只增加接线；工具解析、持久化和界面状态放在专用模块。

## 检查结果

- `bun run check:rust` 通过，默认 Rust 361 passed、5 ignored；Clippy 通过。新增 6 个项目环境用例、1 个 Python 优先级用例和 1 个 Windows 工作目录用例。
- `bun run check:platform` 的 10 项必需检查通过；前端/网关 42 文件、498 项通过。新增 UI 覆盖显式保存、清空、冲突、加载与保存过期响应、数量限制、远程不可编辑，网关验证项目作用域和参数白名单。
- 真实 Cargo/Go 生命周期与 Python .venv 生命周期用例显式运行通过。项目目录优先级、子进程 PATH、Windows PTY 调用工具均有实际进程证据。
- i18n 2290 键、0 缺失；TypeScript、Windows 子进程约束通过。Biome 保持既有 111 warnings、7 infos，xterm 生成文件保留 1 个上游内联尺寸提示；设计检查退出 0。Rust 全仓格式漂移按既有 advisory 记录。
- React 资源已重建；MkDocs strict 和 `git diff --check` 通过。没有执行完整 Tauri/release 构建、安装包生成、提交或发布。
- 统一报告：`E:\tmp\zicode-tool-paths-evidence\win32-x64-6cdbdd68-9293-4a32-8754-0045c34020bd\summary.md`。报告明确标记 dirty 工作区；不能用基准 Git revision 代替未提交变更快照。
- Rust 检查日志：`E:\tmp\zicode-tool-paths-rust-verified.log`；UI 定向记录：`E:\tmp\zicode-tool-paths-ui-final.log`；文档：`E:\tmp\zicode-tool-paths-docs.log`。

## 未验证与后续

- 待验收流程：项目开发环境 → 编辑工具目录 → 保存 → 版本结果更新 → 启动命令/新终端 → 确认实际工具。Browser 的 fetch 连接失败，本轮没有页面身份、真实交互、控制台或截图证据，不以组件测试代替视觉验收。
- Windows 是实际测试平台；macOS/Linux 的 PATH、Shell、路径和工具分发仍需实机验证。
- `.venv` 优先级仍为固定规则；独立的任意虚拟环境选择、工具安装/升级、任意环境变量与项目工具链分发尚待推进。
- 整个平台目标仍在推进，下一步继续环境选择、跨平台运行和交付验收。
