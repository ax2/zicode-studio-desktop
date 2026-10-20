# 发布者信任库读取失败时停止签名安装（2026-10-17）

## 目标与发现

Studio 的签名插件未来将接收大量独立提供方。检查 `src-tauri/src/plugin_package.rs` 发现，旧 `load_trust_store` 对读取失败和 JSON 解析失败都返回默认空库。若用户随后明确建立新发布者信任，空库会写回原文件，丢失已有信任和撤销记录；预览也会把真实存储错误误报为“未信任”。

## 修改

读取信任库现在返回 `Result`。只有文件确实不存在时才创建内存中的空版本 1 库；其他 I/O 错误、损坏 JSON、缺少必要字段或不支持的版本均显式报错。预览、建立信任、撤销和失败回滚传播错误；已有包的布尔信任查询遇到错误时按未受信处理。拒绝路径不覆写原文件。保留原签名、包验证、安装顺序和版本号。

## 验证证据

- 定向 `cargo test --manifest-path src-tauri/Cargo.toml plugin_package::tests::corrupt_trust_store_blocks_mutation_without_losing_existing_data`：1/1 通过；覆盖截断 JSON、缺失 `publishers`、版本 2，以及预览、新信任、撤销、回滚和已安装包信任查询。另一个初始命令误用 `--lib`，因该包无 library target 立即退出，未执行测试。
- `bun run check:rust:static`：Cargo check、Clippy 均通过；全仓库 rustfmt 仍报告已有格式漂移。对本轮文件单独运行 `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/plugin_package.rs` 为 0。
- 构建前后只读存储扫描均完整，未知条目 0：`target` 29,421,211,561 → 29,423,948,875 逻辑字节，增加 2,737,314 字节；task-scratch 保持 932,850,915 字节。E 卷空闲量 37,015,470,080 → 36,894,736,384 字节，卷级变化可能有其他进程参与，不归因于本轮。未新建 target、完整运行目录或 ZIP，也未清理现有缓存。

## 边界

本轮验证的是本机签名信任库故障，不是 DevTools 正式签名包安装验收。新包仍须实际签名、独立构建、逐文件收据、Host/Worker/Pi 运行及多平台验证。没有 UI 改动或截图；DevTools 全量接受仍为 0/154，ZiFile 108 格仍为 0。信任库备份和恢复机制未在本轮实现。
