# Intel Mac 平台检查与交付入口（2026-10-01）

状态：本地工作树已接线，真实 CI 和安装验收待完成。

## 目标与发现

跨平台目标包含 macOS，但原验证与 Release 矩阵仅覆盖 Apple Silicon。仓库已锁定 `pi-darwin-x64.tar.gz` 和 `bun-darwin-x64.zip`，手动 DMG 构建入口也能按 `x86_64` 选择原生 Rust 目标。缺口在自动验证、发布目标核对和草稿资产清单。

## 修改与决策

- 在平台验证矩阵加入 `macos-15-intel`，期望系统与架构为 `darwin/x64`。现有运行报告会拒绝 runner 实值与矩阵声明不一致的结果。
- 四个矩阵行同时声明 Rust 原生目标。报告格式升至第 5 版，记录 `rustc -vV` 主机、显式 `CARGO_BUILD_TARGET` 与匹配结论；CI 不匹配时保存失败报告并跳过耗时检查。
- 在 Release 矩阵加入 Intel Mac DMG，并将 `darwin-x64` 映射到 `x86_64-apple-darwin`。Pi、Bun 和 Rust 均按 Intel Mac 原生目标准备。
- 将草稿资产上限由四份改为五份，要求一份 ARM64 DMG 和一份 x64 DMG。Tauri bundler 2.9.4 的 DMG 文件名包含 `_aarch64` 或 `_x64` 后缀；上传后核验也检查本地 DMG 后缀与该 job 的 Pi 目标一致。
- 更新平台验证、产品要求和手动更新文档。自动更新产物仍关闭；两架构的 `latest.json` 合并与签名验证尚未实现。

## 静态检查与遗留

`bun run check`、三个修改的 JavaScript 脚本语法与格式检查、两份工作流的 YAML 解析和 `git diff --check` 退出 0。仓库静态检查仍显示既有 124 条 warning、7 条 info 与 1 条设计提示。本轮没有新增或运行测试，也没有执行远端 Actions、DMG 构建或实机安装。上线前需取得四个系统/架构矩阵行的真实报告，并验证五份安装包在对应设备上的启动与升级路径。

额外运行根 `tsconfig.json` 的只读类型检查，仍失败于 Pi 包声明缺失、部分测试类型与根路径别名等既有问题；本轮的独立平台类型门槛没有因此被宣称为全仓类型通过。
