# 2026-09-30 Python 版本文件

状态：实现及静态检查完成；跨平台实机验收待补。

## 目标与发现

- 环境页已经读取 `pyproject.toml` 的静态 Python 要求及 `.tool-versions`，但尚未显示 pyenv 常用的 `.python-version`。
- Python 环境探测会考虑项目虚拟环境和显式选择；版本文件本身不能证明 pyenv 最终选择的解释器。

## 修改与决策

- 读取选中目录的 `.python-version`；本地文件不存在时，只在注册工作区范围内向上查找最近的祖先文件，最多 32 层，并显示相对路径。
- 复用 256 KiB 有界读取与规范路径边界。空声明及超过 16 个候选版本视为无效；单一完整数字版本沿用 `.tool-versions` 的实际探测比较，多候选或动态名称显示无法判断。
- `.python-version` 与 `.tool-versions` 若同时存在，分别显示来源，不假定两个版本管理器的优先级，也不自动切换解释器。
- 同时将 `.tool-versions` 工具名限制在 64 字节内，避免单个异常名称绕过已有条目数和版本文本上限。

## 验证、偏差与风险

- `rustfmt --check`（本轮涉及的清单与版本文件模块）和 `bun run check:rust:static` 通过。本轮不新增或运行测试。
- 全仓库 Rust 格式检查仍提示已有格式漂移；本轮相关文件的定向格式检查通过。
- 静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，清理 18936 个可再生构建文件，释放约 3.2 GiB。
- pyenv 环境变量覆盖、全局版本、插件安装状态与虚拟环境真实选择仍需在目标系统上核对。
- 尚未在 Windows、macOS、Linux 的真实 Python 项目中验收。
- 本轮只更新本地源码及档案；未提交、推送或发布。
