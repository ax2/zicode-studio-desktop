# 2026-09-26 Python 诊断与命令解释器一致性

状态：实现与静态检查完成，运行验收待补。本轮不新增或运行测试。

## 发现与决策

- 已有显式 venv 选择，无需重复实现。自动模式下命令优先使用根目录 .venv，而诊断忽略它，可能将宿主版本的兼容结论用于另一解释器。
- 提取共享解释器解析与环境注入，诊断返回真实选择来源、路径和状态。
- 保持诊断不自动执行项目内发现的程序这一既有边界：自动 .venv 标记为版本未检查，不使用宿主版本替代。用户可以在已有环境选择表单中明确选择该目录，再查询版本。
- 显式选择、工具目录及宿主解释器保持有界版本查询；根目录 .venv 损坏时显示环境不可用，不回退。
- 本轮仅对齐项目根目录诊断；命令子目录的 .venv 仍由运行器按执行目录解析，终端自动模式保持原规则。

## 工作日志

- 从 project_tasks/python_tasks.rs 提取 python_runtime.rs，共享解释器路径选择、边界校验和进程环境注入；任务层仅重新导出旧入口，保留现有错误代码和调用路径。测试源文件没有修改。
- Interpreter 记录 explicit-environment/project-venv/tool-directory/host 来源；Host Python 诊断使用该结果，不再单独按 python3/python 顺序选取不同解释器。
- 自动 .venv 返回 unverified 和调用路径；损坏环境返回 invalid-environment。二者不会执行版本程序，PEP 440 评估返回 unavailable，不作满足/不满足判断。
- 显式环境版本查询沿用 3 秒超时、每流 16 KiB 限制、临时工作目录和进程树回收；解释器调用路径保留，支持标准 Unix venv 符号链接。
- PythonToolSource.tsx 显示选择来源、未知旧 Host 来源和可执行的后续操作说明；前端类型新增可选 source，兼容旧报告。中英文帮助、导航和平台状态同步，修正“自定义标准 venv 尚未实现”的过期状态。

## 静态检查

- TypeScript、bun run check、中英文键覆盖通过；2401 键、0 缺失。111 warnings、7 infos 和生成 xterm 内联尺寸提示为既有结果。
- cargo check --locked --all-targets 通过，耗时 1m 40s；没有执行测试用例。cargo clippy --locked --all-targets -- -D warnings、React 资源构建、MkDocs strict 和差异空白检查均通过。
- 证据前缀 E:\tmp\zicode-python-diagnostic-。

## 遗留与边界

- 未新增或运行测试，未执行真实 Python/项目命令、UI 或跨平台验收，没有提交或发布。
- 显式选择损坏时沿用现有整个环境配置失败提示；不承诺自动恢复。旧 Host 未报告 source 时只提示更新，不把其结果当作新选择规则已生效。
- 自动发现 .venv 的用户可通过已有显式选择表单启用版本检查。本轮不提供新的一次性执行权限、自动安装、Conda/Poetry 发现或子项目环境诊断。
- 解释器解析与启动间外部文件仍可能变化；共享解析不等于可执行文件完整性或依赖验证。新模块不足 200 行，既有诊断模块不足 400 行，没有向大型入口增加业务逻辑。
