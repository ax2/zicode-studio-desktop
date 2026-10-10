# 2026-09-27 显式 Conda 环境

状态：实现与静态检查完成，运行验收待进行。

## 发现与设计

- 现有 PythonEnvironment 只接受 pyvenv.cfg 与 Scripts/bin，且所有显式环境均设置 VIRTUAL_ENV，不适用于 Conda。
- 扩展显式目录选择：venv 使用现有布局；Conda 使用 conda-meta/history 标记与平台解释器位置，拒绝混合标记、失效解释器和越界元数据/路径目录。
- Conda Windows 路径按 prefix、Library/mingw-w64/bin、Library/usr/bin、Library/bin、Scripts、bin 顺序；Unix 使用 bin。只加入已有且位于 prefix 内的目录。
- 共用进程环境配置，区分 VIRTUAL_ENV 与 CONDA_PREFIX，清除遗留激活状态；不执行 conda activate、activate.d、环境安装或自动扫描用户环境列表。
- 自动 .venv 规则保持；显式 Conda 选择用于命令、诊断与新终端，既有进程不变。记录类型、路径对命令指纹的影响。
- 不新增或运行测试，实施后做静态检查并记录未验收范围。

## 工作记录

- python.rs 在显式路径中区分 venv 与 Conda，校验 pyvenv.cfg 或 conda-meta/history、实际解释器、元数据与目录位于 prefix 内。保留 venv 的 Unix 解释器链接调用方式；Conda 解释器要求解析后仍位于 prefix 内。
- python_process.rs 集中设置子进程环境：venv 使用 VIRTUAL_ENV、Conda 使用 CONDA_PREFIX；清理 PYTHONHOME、遗留 VIRTUAL_ENV/CONDA_PREFIX/CONDA_DEFAULT_ENV/CONDA_SHLVL/CONDA_PROMPT_MODIFIER 和继承的 CONDA_PREFIX_*。不修改 Host 进程环境，也不调用激活脚本。
- Environment.path 和 selected 按已存在且位于 prefix 内的候选目录设置 PATH；新命令、版本诊断、新终端共用。自动 .venv 继续只读发现；显式 Conda 查询版本。settings、类型、解释器与有效路径进入环境指纹，切换或修复路径后原清单失效。
- ProjectToolPaths 说明两种显式目录布局，PythonToolSource 标注 Conda 来源和激活边界；中英文帮助、平台说明与 MkDocs 导航同步。大文件 project_environment.rs 仅保留接线和路径汇总。
- TypeScript、bun run check、i18n、React 构建通过；2524 个词条、0 缺失。保留既有 111 warnings、7 infos 与 xterm 内联高度提示；恢复构建前干净的无关前端产物。Cargo check --locked --all-targets 与差异空白检查通过。日志前缀 E:\tmp\zicode-conda-。

## 尚待验证

- Clippy --locked --all-targets -- -D warnings 与 MkDocs strict 已通过；无真实 Conda prefix、UI、Windows DLL 加载、macOS/Linux 或终端实机验收。没有新增或运行测试，也没有启动实际项目命令。
- 这实现了显式目录选择和基本进程上下文，不代表完整 `conda activate`：activate.d、conda env config vars、包状态和依赖完整性未加载/检验；环境可能依赖这些设置。
- 关闭或更改选择不改变已启动进程。环境目录可能在保存和启动之间变化，启动前仍需重新解析配置；不能保证目录文件系统的原子快照。
- 未生成安装包或 ZIP，没有提交、推送或发布。自动发现环境列表、Poetry 和跨平台运行验收待推进。
