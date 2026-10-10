# 项目空间清理记录（2026-09-28）

## 范围与依据

在 `E:\zicode-studio-desktop` 盘点忽略规则与文件大小。`target/debug` 约 31.8 GB，主要是 Cargo 依赖、增量编译、构建中间文件和复制的打包资源。目录中没有独立发布的桌面可运行版本；`target/zicode-cli/release` 是单独的 CLI 产物。

## 操作与结果

- 在 Rust 编译、Clippy、格式及文档检查完成后，使用 `cargo clean --manifest-path src-tauri/Cargo.toml --profile dev --target-dir E:\zicode-studio-desktop\target` 清理可重建的 dev profile 产物。Cargo 报告移除 36,087 个文件、29.6 GiB。
- 清理后 `target` 约 3.7 MB，仅保留独立 `zicode-cli` 产物及少量元数据；当前 E 盘空闲空间约 91.8 GB。空闲空间变化可能还包含同盘其他操作，不能全部归因于本次清理。
- 保留源码、Git 工作树、`node_modules`、打包所需的 `src-tauri/resources`、文档截图与旧 QA 记录。`site` 约 26.7 MB、`.cache` 约 460 MB 仍在；它们比 Cargo 缓存小得多，且部分缓存保留了历史构建与截图资料。

## 限制

自动审查以 `blocked by policy` 拒绝了对 `target/debug` 和 `site` 使用 `Remove-Item -Recurse` 的命令。改用 Cargo 官方清理命令安全清除了调试产物；`site` 没有被删除。本轮未运行测试或重新构建应用。

## 后续盘点

清理后再次统计，项目内较大的剩余目录为 `src-tauri` 约 0.775 GiB、`.cache` 约 0.429 GiB、`node_modules` 约 0.287 GiB、`site` 约 0.025 GiB。`src-tauri/resources` 中的 Portable Git、WebView2、Pi 和 Bun 是当前打包资源，予以保留。

`.cache` 中识别出约 436 MiB 可重新下载的归档：WebView2 安装包约 194 MiB、多个 Pi 版本压缩包约 186 MiB、Portable Git 安装包约 56 MiB。尝试仅按精确文件路径删除这些归档时，自动审查仍以 `blocked by policy` 拒绝了命令；这些文件没有删除。`site` 和 QA 截图也继续保留。
