# Stage：Pi 本机插件 Host 直连代理规则

日期：2026-10-18。目标：普通桌面会话使用系统 HTTP 代理时，嵌入 Pi 的插件目录请求仍直连本机 Studio Host。JSON 对象插件按用户决定暂不启用，未改权限或插件状态。

## 发现与修改

隔离 Pi RPC 探针在继承本机 `HTTP_PROXY`/`HTTPS_PROXY`、没有 `NO_PROXY` 时，对合成 `127.0.0.1` 目录服务的首次请求返回 503，服务端未收到请求。只补 `NO_PROXY=127.0.0.1,localhost` 并保留代理变量时，同一真实 Pi 与 Studio 编译扩展的搜索→加载→超预算通用降级→调用通过；5 次请求均到达本地服务并通过绑定核对。补验探针与结果在技术博客本 Stage `evidence/catalog-*`，四文件逐一 SHA-256 匹配工作副本；驱动 SHA-256 `C6C736BDFFEB9FF0A82C5CDD60E87FD14B4D5A2A90B94A487334CC7C0A193A20`。

`configure_plugin_broker_for_state` 现在合并启动配置及普通进程继承的 `NO_PROXY`/`no_proxy` 列表，去重并补入 `127.0.0.1`、`localhost`、`::1`，以两种变量名交给 Pi 子进程。隔离桌面配置不读取父进程代理排除列表；外部模型请求仍可使用原代理。真实 Host/Pi 回环测试去掉测试预设的 `NO_PROXY`，要求生产配置自动补齐。

## 验证与空间

- `bun run check:rust:static` 退出 0：`cargo check --all-targets`、`clippy -D warnings` 通过；`fmt --check` 只给出仓库格式漂移的 advisory。
- `RUST_TEST_THREADS=2 cargo test --manifest-path src-tauri/Cargo.toml embedded_pi_invokes_the_real_host_plugin_broker -- --ignored --nocapture` 退出 0：目标测试 1/1，通过真实 Pi、真实 Studio Host 与内置 Notes 夹具完成目录搜索、加载、执行、结果通知。其他目标 0 项，不能计作额外通过。
- 构建/测试前后的只读预算：`target` 30,040,567,930 → 30,041,815,353 B（+1,247,423 B），task-scratch 1,412,478,887 B 不变，非 scratch `.cache` 355,458,670 B 不变，`site` 29,644,753 B 不变，所有扫描未知项 0。E 盘空闲 5,256,790,016 → 1,139,048,448 B；卷空闲变化远大于上述树的逻辑变化，原因未查明，不能归因于本次测试。低于保留阈值仅作提示，未清理可复用缓存。

后续只读查询时 E 盘空闲又降至 679,440,384 B；同时能看到其他 Cargo release 构建进程仍在运行。没有证明这些进程造成空间变化，也没有中断或清理其他工作。本 Stage 不再启动新构建。

## 空间压力后续核对

空闲空间继续下降至 120,262,656 B。最近 30 分钟的只读文件清单显示 Studio `target` 内有 1,581,154,398 B 的近期修改文件，包括本轮测试二进制与其 PDB；ZiDevTools `target/release` 也有 269,292,112 B 近期修改。修改时间与体积不能解释全部卷空闲变化，不据此删除其他项目内容。

本轮测试专用符号文件 `target/debug/deps/zicode_studio_desktop-760be136197f2978.pdb` 为 336,203,776 B，当前 Debug/Release 运行 EXE 均存在；按可执行文件路径未发现该测试进程仍运行。对**这一精确文件**发出的单文件删除被自动审批策略以 `blocked by policy` 拒绝，实际删除 0，复核文件仍存在。没有换命令重试。用户若手工移除此 PDB，可释放其实际占用，但以后调试该测试二进制将缺少符号；保留相应测试 EXE 与当前 Debug/Release 运行 EXE。

## 边界与遗留

真实 Host/Pi 测试使用内置 Notes 夹具，并直接调用捕获的工具定义；未通过模型调度，也不是 ZiDevTools Worker 或全目录验收。DevTools 0/154、ZiFile 0/108 不变。原生普通桌面进程、macOS/Linux 代理环境和真实外部提供方仍待验。此前被自动审批拒绝的暂存目录没有重试删除；本轮没有生成 ZIP、发布或更改版本号。
