# 2026-09-30 Go 工作区版本声明

状态：实现和静态检查已完成；真实项目验收待办。

## 目标与发现

- 项目环境报告已识别根目录 `go.work`，项目任务目录发现也能读取其 `use` 成员，但环境页此前没有从该文件提取 Go 版本声明。
- `go.work` 与 `go.mod` 都支持顶层 `go` 和 `toolchain` 指令；现有 `go.mod` 有界解析器仅提取这两类声明，不执行 Go 命令或读取依赖。

## 修改与决策

- 对已安全确认在当前项目根目录内的 `go.work` 使用同一有界解析器，向环境页返回最低 Go 版本及推荐工具链。
- 保留 256 KiB 清单读取上限、200 字符要求长度上限、重复指令拒绝和 Host 默认 Go 版本比较语义。
- 不自动把祖先 `go.work` 声明套用到任意子目录；成员关系和工作区边界需要单独确认后再扩展。

## 接续：明确成员的祖先工作区声明

- 对选中的 Go 模块根目录，沿注册工作区内的祖先目录查找最近的 `go.work`。只有现有有界读取器完整解析成员列表、并且 `use` 明确列出该模块目录且其 `go.mod` 可安全读取时，才把工作区版本要求加入环境报告。
- 最近的 `go.work` 若未列出该模块或解析不完整，不继续从更远祖先猜测继承；普通子目录也不自动认定为模块根目录。
- 当前模块目录已有自己的 `go.work` 时优先显示本地文件，即使本地文件不可读，也不借用更远祖先的声明。
- 报告使用相对注册工作区的 `go.work` 路径，避免把祖先清单误标为当前目录文件。
- 接续后 `bun run check:rust:static` 再次通过 `cargo check --all-targets` 与严格 Clippy；advisory 格式检查仍提示仓库格式漂移，定向 `rustfmt --check` 只指向未触及的环境契约测试文件末尾空行。
- 检查结束后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本轮产生的 3.2 GiB 构建产物。未新增或运行测试；真实多模块 Go 工作区仍待验收。

## 验证、偏差与风险

- `bun run check:rust:static`：`cargo check --all-targets` 与 `cargo clippy --all-targets -- -D warnings` 通过；advisory `cargo fmt --check` 提示仓库格式漂移。
- 检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本次生成的 3.2 GiB Rust 构建产物。
- 本轮不新增或运行测试。
- 尚未用真实多模块 Go 工作区及 Windows、macOS、Linux 桌面界面验收。
- 本轮只更新本地源码与档案；未提交、推送或发布。
