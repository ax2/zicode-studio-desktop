# 2026-10-01 PHP 与 Composer 诊断隔离

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- 项目命令启动时已将 `COMPOSER` 固定到所选子项目的 `composer.json`，但环境页的版本探测仍可能继承宿主 `COMPOSER`。
- 宿主 `PHPRC` 与 `PHP_INI_SCAN_DIR` 可能让 `php --version` 读取与当前项目无关的配置。
- 版本探测统一在临时工作目录运行，且已有 Node、Python、Ruby 的环境变量清理边界。

## 修改与决策

- 在只读版本探测子进程中清除 `COMPOSER`、`PHPRC` 与 `PHP_INI_SCAN_DIR`；不改变用户主动启动的 Composer 项目命令及其私有仓库认证配置。
- 系统默认 PHP 配置及版本管理器自身行为仍由本机安装决定；本轮只阻断宿主显式重定向。

## 验证、偏差与风险

- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory，本轮修改的 Rust 文件单独通过格式检查。本轮不新增或运行测试。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- 真实 PHP/Composer 发行版及 Windows、macOS、Linux 运行待验收。
- 本次只更新本地代码与档案；未提交、推送或发布。
