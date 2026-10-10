# 2026-10-01 PHP 与 Composer 项目接入

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- 开发环境页和项目命令页尚未识别 PHP 与 Composer；只有 `composer.json` 或 `.php-version` 的子项目也不会在目录选择器中出现。
- 现有版本管理器比较只接受精确的 `X.Y.Z`，不推断动态别名或宽松范围。
- `composer.json` 的 `require.php` 使用 Composer 自身的约束语法，不能直接按 JavaScript semver 比较。

## 修改与决策

- 增加 `php --version`、`composer --version` 诊断，并展示当前或工作区内最近的 `.php-version`；仅比较精确版本。识别 `composer.json` 并校验为 JSON 对象，但暂不解析 `require.php` 为匹配结论。
- 子项目目录发现纳入 `composer.json` 与 `.php-version`；版本文件本身不会生成固定任务。
- 有效的对象型 `composer.json` 提供用户主动运行的 `composer --no-plugins validate --no-check-publish` 与 `composer install`。命令设置当前子项目的 `COMPOSER` 路径，避免继承宿主的另一项目清单。
- 清单使用现有 256 KiB 读取限制与工作区路径边界；任务指纹包含清单内容。安装可能下载依赖、运行脚本并修改文件，界面明确提示。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory，本轮涉及的 Rust 文件已单独通过格式检查。本轮不新增或运行测试。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- Composer 脚本、插件、依赖完整性及真实 Windows/macOS/Linux 执行尚未验收；大于 256 KiB 的清单按现有任务读取规则报告不可用。
- 本次仅更新本地代码与档案；未提交、推送或发布。
