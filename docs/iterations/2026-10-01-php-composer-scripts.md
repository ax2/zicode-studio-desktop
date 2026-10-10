# 2026-10-01 Composer 项目脚本目录

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- PHP 项目已有 Composer 验证和安装固定命令，但项目在 `composer.json` 中声明的常用脚本尚未进入命令页。
- 项目命令运行器已有工作区目录限制、清单指纹、固定任务 ID 和用户主动启动流程。

## 修改与决策

- 从对象型 `scripts` 中收录安全可作为固定参数传递的名称，以及非空字符串或非空字符串数组值；对象等复杂脚本声明不在目录中推断。
- 每个脚本使用 `composer run-script <name>` 和独立任务 ID；仍由用户主动启动，按当前子项目的 `COMPOSER` 路径运行。
- 100 个脚本以上按现有目录上限报告错误；清单内容已包含在任务指纹中。界面提示在启动前检查脚本正文。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory，本轮修改的 Rust 文件单独通过格式检查。本轮不新增或运行测试。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- 此处只验证目录收录边界，不解释 Composer 脚本语言或插件行为；真实 Windows/macOS/Linux 执行待验收。
- 本次只更新本地代码与档案；未提交、推送或发布。
