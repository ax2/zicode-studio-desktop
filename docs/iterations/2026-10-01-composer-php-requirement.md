# 2026-10-01 Composer PHP 版本要求

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- 环境页已识别 `composer.json`、PHP CLI 和 `.php-version`，但尚未展示清单中的 `require.php`。
- Composer 约束语法比现有 JavaScript semver 比较器更广；直接套用完整比较器会把部分写法解释错。

## 修改与决策

- 从有效 `composer.json` 的 `require.php` 读取字符串要求并保留原文；非字符串、空值和控制字符作为无效清单报告。
- 仅对精确 `X.Y.Z`、`^主.次[.补丁]`（主版本至少为 1）和 `>=主.次[.补丁]` 作只读比较。其余 Composer 写法显示待人工核对，不宣称匹配或不匹配。
- 比较对象是检测到的 PHP CLI；界面明确说明未检查 Composer `config.platform` 覆盖、PHP 扩展和依赖状态。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory，本轮修改的 Rust 文件单独通过格式检查。本轮不新增或运行测试。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- Composer 的完整约束语法、平台覆盖与真实 Windows/macOS/Linux PHP 运行仍待验收。
- 本次只更新本地代码与档案；未提交、推送或发布。
