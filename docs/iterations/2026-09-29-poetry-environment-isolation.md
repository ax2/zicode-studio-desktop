# 2026-09-29 Poetry 命令环境隔离

状态：实现与静态检查完成；真实 Poetry 运行与跨平台验收待补。

## 目标与发现

- Poetry 固定命令的设计要求由 Poetry 自行选择项目环境；项目显式选择的 Python 只应服务普通 `python -m` 命令。
- 实际任务运行器统一调用 `Environment::configure`，会把显式 venv/Conda 的 PATH、`VIRTUAL_ENV` 或 `CONDA_PREFIX` 注入 Poetry 进程。Poetry 可能据此改用另一环境。
- Poetry 可执行文件查找也会先经过显式 Python 环境目录，可能绕过项目配置的工具目录或宿主 Poetry。

## 修改与决策

- Poetry 命令单独使用工具目录与宿主 PATH，不加入显式 Python 环境目录；可执行文件优先从项目配置的工具目录选取，再沿用已有宿主发现规则。
- 启动 Poetry 前清除继承的 Python/Conda 激活变量、`PYTHONPATH` 和 `POETRY_ACTIVE`。普通 Python 命令及新终端继续使用各自现有的环境选择。
- 不在诊断读取时运行 `poetry env info` 或枚举外部虚拟环境；该命令可能加载 Poetry 插件。外部环境仍可通过已有显式目录选择，Poetry 固定命令则由 Poetry 自行解析。

## 验证与遗留

- `cargo check --locked`、`cargo clippy --locked -- -D warnings`、本轮 Rust 文件 rustfmt 检查及差异空白检查通过。本轮不新增或运行测试。
- 未用真实 Poetry 项目覆盖 Windows、macOS、Linux 的环境选择。宿主 PATH 若本身指向已激活的环境，其 Poetry 可执行文件仍可能来自该目录；此改动不管理用户的 Poetry 配置或安装依赖。

## 接续：宿主 PATH 中的已选 Python 环境

- 发现即使未主动把选中 Python 环境加到 Poetry PATH，Host 若已在同一 venv/Conda 中启动，继承的 PATH 仍包含该环境；后备可执行文件查找也可能先命中其中的 Poetry。
- `configure_poetry` 现从继承的 Host PATH 中过滤选中环境的可执行目录。项目显式配置的工具目录仍保留优先级，即使它与选中环境目录相同。
- Poetry 的后备查找在 Host PATH 中跳过选中环境的可执行目录；环境诊断与命令运行器使用同一过滤规则。目录比较对已有路径进行规范化，以识别别名路径。
- 本轮 `cargo check --locked`、`cargo clippy --locked -- -D warnings`、目标文件 rustfmt 与差异空白检查通过；未新增或运行测试，未在真实 Poetry 环境或 macOS/Linux 上执行。
- 若 Host 另有未被用户选中的已激活 Python 环境，仍可能从其 PATH 找到 Poetry；本轮仅隔离用户明确选中的那个环境，不改变用户显式设置的工具目录或全局 Poetry 安装。
