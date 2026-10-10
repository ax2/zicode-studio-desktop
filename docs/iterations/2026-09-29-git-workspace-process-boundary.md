# Git 工作区进程边界（2026-09-29）

## 目标与发现

- 核对项目 Git 状态、暂存和工作区分支在跨平台启动时的进程环境。
- Windows 启动流程已通过 `configure_bundled_tool_path` 将随包 Portable Git 放入 PATH；没有发现必须依赖系统 Git 的缺口。
- Git 状态读取直接使用规范化工作区路径作为子进程工作目录，未复用项目已有的 Windows verbatim 路径转换。暂存命令已转换路径。
- 工作区分支读取直接继承宿主 `GIT_*` 变量，可能与状态读取使用不同仓库，例如宿主设置了 `GIT_DIR` 时。

## 修改与决策

- Git 状态读取在进程边界使用 `working_directory`，保留注册工作区的规范化身份路径。
- 将清除继承的 `GIT_*` 环境变量提为共享函数，状态读取、暂存写入和工作区分支读取统一调用。
- 工作区分支读取禁用可选锁、终端提示和惰性获取；读取符号引用不触发 fsmonitor。
- 后续接续：工作区分支读取改为异步调用既有 `run_git`，复用其 5 秒超时、输出上限和进程退出处理；Git 失败仍只使 `gitBranch` 为空，不影响工作区路径返回。
- 分支名改从 `symbolic-ref --quiet --short HEAD` 读取，使尚未提交的初始化仓库也能显示所选分支；分离 HEAD 仍返回空分支。
- 保留现有的 Windows 随包 Git、macOS/Linux 系统 Git 选择策略。

## 验证与遗留问题

- `rustfmt --edition 2021 --config skip_children=true --check` 对涉及的 Git 状态、暂存、Host 数据与 Host 路由 Rust 文件通过。
- 未运行测试或重新编译；本轮之前为释放空间清理了 Rust 构建目录，完整编译会重新生成该目录。
- 尚缺 macOS/Linux 与 Windows 安装包的实际 Git 工作区验收。工作区分支的读取现在有 5 秒超时和输出上限，尚未在真实慢仓库、损坏仓库与初始化仓库中验收。
- 未发布，未提交。
