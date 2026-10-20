# Stage：Explorer 桥接 DLL 复用 Cargo 目标目录

日期：2026-10-18。范围仅 Studio 的 Windows 构建入口。

## 目标与发现

日常开发应复用一套 Cargo 输出。`scripts/cargo-path.js` 已将默认或显式
`CARGO_TARGET_DIR` 解析为绝对路径，Tauri 主构建和 Rust 检查使用该环境；
但 `dev-desktop.js` 与 `build-desktop.js` 给 Explorer 桥接 DLL 的 Cargo
命令仍显式传入固定的仓库 `target`。在使用目标目录覆盖时，Shell 构建会
产生第二套缓存；正式构建也会从固定路径取 DLL。

## 修改

- 开发和本地/正式构建的 Shell `--target-dir` 统一取已解析的
  `env.CARGO_TARGET_DIR`。
- 正式构建从同一目录定位已编译 DLL。默认配置仍指向仓库 `target`。
- 用户决定暂不启用 JSON 对象插件；本轮没有改变插件状态、权限或接收矩阵。

## 验证与遗留

`node --check scripts/dev-desktop.js`、`node --check scripts/build-desktop.js`
和针对两文件的 `git diff --check` 退出 0；静态核对发现两入口及 DLL
读取位置均使用同一已解析路径。未执行 Rust/Tauri 构建，不能据此声称
覆盖路径下的 Shell DLL 已真实运行，也没有释放现有占用。

现有旧增量输出的定向删除曾被自动审批拒绝，本轮不重试。保持当前完整
Debug/Release、可复用依赖缓存和技术档案；低空间时不启动新大构建。
只读预算扫描：`target` 30,041,815,353 B、非 scratch `.cache`
355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B，
未知项均为 0；E 卷空闲 116,232,192 B。脚本因低空间退出 1（建议）。
