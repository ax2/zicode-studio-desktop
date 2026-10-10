# 2026-09-26 子项目环境诊断

状态：实现与静态检查完成，运行验收待补。本轮不新增或运行测试。

## 目标与发现

- 命令运行器已经支持有限深度的子目录发现，环境诊断仍固定根目录，无法展示 monorepo 子项目的清单或 Python 选择。
- 复用现有目录解析规则和发现接口；每次诊断重新校验相对目录，项目工具配置保持工作区级。
- 报告回传诊断目录；旧 Host 忽略目录时不能把根目录报告展示成子项目结果。
- 宿主工具查找继续排除整个工作区，自动发现的子目录 .venv 保持不执行版本查询。

## 工作日志

- Host 原环境检查分支移入已有 project_environment 专属模块；请求接受可选 directory，缺省根目录，非字符串拒绝。使用命令目录解析器拒绝父级跳转、绝对路径、目录链接与 Windows reparse point。
- environment.rs 分开所选目录与工作区根：前者用于清单和自动 .venv；后者用于宿主工具排除范围及工作区环境设置。报告 directory 原样回传已经校验的相对路径。
- 新增 SubprojectEnvironment 组合目录选择与报告；项目切换按 workspace key 重建，配置刷新保留本视图目录。复用发现接口和上限，不自行深扫仓库。
- 目录选择器结果绑定 workspace/revision，切换或刷新时不暂显旧目录清单；读取失败保留当前选择但显示重试提示。
- EnvironmentPanel 报告按 workspace/directory/revision/retry 归属；子目录必须收到准确回传目录才显示，根目录兼容旧报告缺少 directory。
- 目录发现刷新与版本查询刷新分开，避免重扫目录重复启动工具版本查询。
- 新增诊断目录摘要、目录不可用/旧 Host 提示；Python 来源文案从根目录改为所选目录。中英文帮助和导航同步。
- 第一轮 TypeScript 检查发现空 result 判断不完整，已改为可选链；移除不再需要的 lint 抑制注释。最终类型、静态扫描、中英文覆盖和 React 构建通过。

## 静态检查

- cargo check --locked --all-targets 通过，耗时 2m 30s。cargo clippy --locked --all-targets -- -D warnings、MkDocs strict 和差异空白检查通过。
- 翻译覆盖 2410 键、0 缺失；静态扫描维持既有 111 warnings、7 infos 与 xterm 内联尺寸提示。
- 证据前缀 E:\tmp\zicode-subproject-environment-。未新增或运行测试，未执行真实项目命令或版本程序，也未进行 UI/跨平台运行验收。

## 遗留与边界

- 选择是当前视图状态，与命令运行器目录独立；不持久化，不替换已运行命令/终端环境。
- 发现沿用已有五种命令清单（package.json、Cargo.toml、go.mod、pyproject.toml、requirements.txt）；仅含其他清单的目录不保证出现在列表，可单独打开为工作区。
- 继承解析仍沿用单清单规则，不宣称识别完整 package workspaces、Cargo workspace 或 monorepo 依赖图。
- 文件系统校验不是跨外部修改的事务。现有版本查询仍执行显式选择/宿主工具；自动发现 .venv 不执行。
- 大型 host_server/项目入口/store/gateway 只作最小调用和参数接线；新界面与 Host 逻辑各自独立。没有提交、推送或发布。
