# 2026-09-26 子项目终端

状态：实现与静态检查完成，运行验收待补。本轮不新增或运行测试。

## 目标与设计

- 项目终端沿用环境与命令视图的共享目录，新终端以所选子目录为 cwd，已有终端不移动。
- 使用独立 terminal_open_directory 操作，旧 Host 拒绝未知操作，不能把子目录请求静默当作根目录。
- 终端会话仍归属于注册工作区根；每工作区 2 个、每 Host 8 个活动终端的限制和读写/停止权限不变。
- Host 每次启动重新解析相对目录，复用禁止路径逃逸、目录链接与 Windows reparse point 的规则。
- Info 回传启动目录，仅描述启动时 cwd，不追踪 Shell 内 cd。显式 Python 环境沿用工作区设置，不自动激活目录内 .venv。

## 工作日志

- TerminalManager::open_in 分开工作区根与启动目录：目录解析在 PTY 创建前完成，process::shell 只接收校验后的 cwd；Session.root 保留注册工作区根，限额、读取、输入、停止继续按其匹配。
- Info 增加 directory。旧的根目录调用在测试编译目标保留转发包装，不新增测试。
- 新 terminal_open_directory 接入 Host 路由、控制网关、环境配置和远程禁止清单；必须提供字符串目录。旧 terminal_open 仅允许根目录，非空目录不会被悄悄忽略。
- terminal-start.ts 固定请求目录、为子目录使用新操作，并校验返回会话 ID、工作区和目录。旧 Host 的未实现错误转为明确升级提示；根目录兼容旧响应缺少 directory。
- TerminalDirectoryPicker 和 TerminalStartupDetails 独立组件复用目录发现，显示启动目录及显式 Python 环境。共享上下文提升到终端页，切换目录不向已运行 Shell 注入命令。
- 首轮 Biome 拒绝启动辅助函数的隐式 any，已补充 TerminalFrame 类型；最终类型检查和静态扫描通过。中英文帮助、导航和平台说明同步。

## 静态检查

- cargo check --locked --all-targets 通过，耗时 1m 35s；cargo clippy --locked --all-targets -- -D warnings、MkDocs strict 和差异空白检查通过。
- TypeScript、bun run check、React 构建通过；中英文覆盖 2422 键、0 缺失。既有 111 warnings、7 infos 与 xterm 内联尺寸提示保留。
- 证据前缀 E:\tmp\zicode-subproject-terminal-。

## 遗留与边界

- 未新增或运行测试、真实 PTY/Shell、UI 或跨平台验收；没有提交、推送或发布。
- 文件系统校验和进程启动不是防外部修改的原子事务；启动目录字段不是实时 Shell cwd。
- 自动 Python 模式仍不激活 .venv，显式选择沿用现有工作区规则。新协议不保证旧 Host 可执行子目录启动，也不自动根目录回退。
- 超时或异常响应可能已有启动副作用；界面仍按既有 finally 刷新列表，用户确认后再决定重试。
- 大型 Host/项目入口/控制网关仅作新操作和参数接线；新增 UI 与启动校验提取独立模块。
