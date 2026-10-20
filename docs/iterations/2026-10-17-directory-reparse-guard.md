# 插件目录读取的 Windows 重解析点门槛（2026-10-17）

## 目标与发现

Zi DevTools 文件、目录统计、去重和目录对比工具需要可信的目录读取。Studio 当前 `resource.local-directory.draft1` 只交付项目内单层名称和类型。代码对最终目录句柄已有 Windows 重解析点检查，但逐级相对目录和枚举条目只判断符号链接类型，不能把该判断当作全部 Windows junction/重解析点防护。

## 修改

- 对逐级目录元数据显式拒绝 `FILE_ATTRIBUTE_REPARSE_POINT`，再继续打开子目录。
- 对每个枚举条目用相对目录句柄读取不跟随链接的元数据，显式拒绝重解析点，然后确认普通文件或目录；保持原有 4096 项、2 MiB、30 秒与一次性确认边界。
- 本地目录测试夹具写入 owner 标记，成功时精确清理；失败保留证据。
- 未修改提供方代码、协议版本、插件包或应用版本。

## 验证

- Windows 实际创建目录符号链接，`open_directory` 中间路径返回 `resource_directory_path_invalid`，单层 `snapshot` 返回 `resource_directory_entry_unsupported`；回归没有走权限不足跳过分支。
- `cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop local_directory::tests:: -- --nocapture`：3/3。
- `http_desktop_file_confirmation_permission_change_cancel_and_replay_boundaries`：真实 Host HTTP 1/1，原授权、确认、撤销路径仍通过。
- `bun run check:rust:static` 退出 0，Cargo check 与严格 Clippy 通过；rustfmt 仍仅提示既有格式漂移。
- 首轮因 `cap_std` 元数据的 Windows 扩展 trait 与 `std::fs` 不同而编译失败；修正导入后同项通过。成功测试后核对 `.cache/task-scratch/local-directory-*` 为 0。
- 前后只读空间扫描完整、未知项 0：target 29,420,789,673 → 29,420,797,353 B；task-scratch 均为 932,850,915 B；E 盘可用 42,978,680,832 → 43,014,778,880 B。本轮没有清理其他文件，卷空闲量变化不能归因于此改动。

## 边界

该候选仍只共享单层目录元数据；未读取文件内容、未递归、未写入或删除。Windows 符号链接样例不证明所有 junction 类型与并发路径替换场景；cap-std 的句柄相对访问仍是防止目录逃逸的主体。正式 DevTools 包未交付，本阶段没有提高 `fullToolsAccepted`，仍为 0/154。没有界面改动，无新截图。
