# 跨平台检查的 Worker 目标目录对齐（2026-10-18）

## 目标与发现

`developer-platform-checks.mjs` 的 Cargo 构建继承 `CARGO_TARGET_DIR`，但四个真实 Worker 专项仍固定从仓库 `target` 推导 EXE。显式复用其他 Cargo 目标目录时，构建成功也会使专项读取错误的 Worker 路径，影响跨平台平台门槛和单一缓存目标策略。

## 修改

`workerBinaryPath` 现在接收可选的 Cargo 目标目录：绝对覆盖路径原样使用，相对覆盖路径基于项目检出目录组合；缺省仍为原 `target`。资源 Worker、Inspect Pi、JSON Host/Worker 和 JSON Pi 四项均从执行环境传入同一 `CARGO_TARGET_DIR`。`CARGO_BUILD_TARGET` 的平台目标子目录仍保留。不更改构建目标、缓存内容或 EXE。

## 验证

- 增加默认、相对覆盖、绝对覆盖、Rust target 子目录及四项环境传递断言。
- 初次定向测试 8/9：使用 `resolve` 使 Windows 上类 Unix 测试路径被补上当前盘符，原默认路径断言失败。改用绝对路径判别及相对组合后重跑 9/9 通过；保留首次失败作为修正证据。
- `bun run check` 退出 0。全仓 lint 仍有其他文件 147 条 warning、10 条 info；设计检查有一条既有 inline-style warning。
- 未运行 Rust 构建或真实四平台 CI。因此本次只证明路径选择与环境传递，不证明覆盖配置中的平台构建已通过。DevTools 154 项、ZiFile 108 格完整接受计数不变；JSON Object 仍禁用。

## 磁盘与发布

前后只读预算扫描的 `target` 均为 30,041,815,353 逻辑字节、`.cache/task-scratch` 均为 1,411,021,038 字节，未知项均为 0；E: 可用从 164,765,696 到 163,094,528 字节。两次因低于储备线退出 1；卷余量变化来源未确认。未删除 task-scratch、此前被审批拒绝的 `target/debug/incremental` 或其他缓存。无版本变更、无发布产物。
