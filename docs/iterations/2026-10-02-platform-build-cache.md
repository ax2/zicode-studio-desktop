# 跨平台构建缓存目录（2026-10-02）

## 发现与修改

空间清理后重新检查跨平台交付流程。根目录 `.cargo/config.toml` 设置 `target-dir = "target"`；本机 `cargo metadata --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml` 返回工作区 `src-tauri/` 和构建目录根级 `target/`。

开发者平台四个运行器及发布工作流此前都给 `Swatinem/rust-cache@v2` 传入 `workspaces: src-tauri`。按该 Action 文档，省略映射目标时使用工作区内 `target/`，与本项目实际目录不一致。两处改为 `src-tauri -> ../target`，保留原有平台缓存键。

资料依据：[Rust Cache Action 的工作区目录映射说明](https://github.com/Swatinem/rust-cache#example-usage)。目标路径相对于工作区，不相对于仓库根目录。

## 核对与边界

本轮用 Cargo 元数据核对实际输出位置，并检查两份流程的改动和文本差异格式。未编译 Rust，未新增或运行测试；本地编译目录仍保持已清理状态。未触发云端流程，缓存恢复/保存命中与耗时改善尚无运行证据。Windows、macOS 两种架构和 Linux 安装及后台 worker 实机验收仍未完成。
