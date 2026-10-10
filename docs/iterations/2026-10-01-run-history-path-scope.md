# 命令历史路径作用域工作日志（2026-10-01）

## 目标与发现

命令运行历史按工作区 ID 和项目目录路径计算 SQLite 作用域。现有代码先调用 `to_string_lossy()`：Unix 上两个字节不同但无法解码为 UTF-8 的目录名可能转换成同一个替代字符序列，导致历史摘要串项目。

## 修改与决策

- Unix 直接使用 `OsStrExt::as_bytes()` 计算路径摘要；普通 UTF-8 路径的字节与原先字符串一致，已有常规历史键保持稳定。
- Windows 路径逻辑未改。扩展 UNC 路径与普通 UNC 的归一方式可能不同，但直接改键会让旧历史不可见；需要同时设计旧键迁移或兼容读取后再修改。
- 这只影响历史作用域，不改变任务启动目录或 SQLite 摘要字段。

## 验证与遗留

`bun run check:rust:static` 退出 0，目标文件 `rustfmt --check` 通过；全仓格式检查仍报告既有漂移。本轮未运行测试。当前 Windows 编译不能证明 Unix 分支已编译或行为通过；Unix 非 UTF-8 真实目录、Windows UNC 历史迁移及三平台重启恢复仍待验收。

静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，删除 18,936 个再生成的构建缓存文件，Cargo 报告约 3.2 GiB；不包含源码或历史数据库。
