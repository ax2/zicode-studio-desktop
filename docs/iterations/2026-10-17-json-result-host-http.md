# Stage：JSON 对象结果的 Host HTTP 与真实 Worker 核验

日期：2026-10-17。仅改 Studio，保留其他未提交工作和冻结 DevTools 夹具。本阶段继续[显式 JSON 结果候选](2026-10-17-json-result-transfer.md)。

## 目标与实现

上阶段只有捕获、映射、聊天入口的单元/组件证据，尚不能证明 Host HTTP 的对象保存或真实 WASI 结果捕获。新增独立 Rust 专项 `plugin_results/json_http_tests.rs`：在本项目 scratch 中复制冻结 Text WASI 夹具并改为派生身份，声明 `result.json.v1`、`output.schema.v1` 和真实结果形状；原夹具字节不动。测试只从派生清单捕获 `base64.encode` 的成功对象，查询 object 字段接收端、准备映射并拒绝未确认执行，再经保存预览、明确确认、成果库重新读取和同 grant 重放验证 JSON 内容及 MIME。

另设需显式指定 `ZICODE_TEST_WORKER_EXE` 的 ignored 专项：调用真实 Studio Host→WASI Worker 而非直接注入结果，之后走同一套 HTTP 接力预览和持久化检查。派生接收清单沿用旧 Text WASM，仅验证目标目录/字段映射与未确认拒绝；没有确认执行该接收 Worker，因此不能称为真实跨工具对象执行闭环。

## 验证与发现

- 普通 Host HTTP 专项先 1/1 通过，补充成果库实际读取和同 grant 重放后再 1/1 通过。
- 首次真实 Worker 专项返回 `worker_protocol_error`，原因是本阶段派生 `outputSchema` 漏掉冻结 WASI 成功结果的 `contractVersion` 与 `error:null`；Host 正确拒绝不满足输出协议的结果。按冻结结果 schema 补齐派生清单后，普通 Host HTTP 与真实 Worker 两项同轮 2/2 通过。运行命令：`ZICODE_TEST_WORKER_EXE=<本项目 target/debug/zicode-studio-desktop.exe> cargo test --manifest-path src-tauri/Cargo.toml --locked --bin zicode-studio-desktop structured_result_ -- --include-ignored --nocapture`。EXE 是上阶段保留的本地 Debug，未新建运行目录或改版本。
- 两次成功测试的 scratch 由专项验证其绝对路径位于 `.cache/task-scratch` 后自动清理，未留下新成功夹具。
- 定向新文件经单独 `rustfmt` 格式化；最终 `bun run check:rust:static` 退出 0（Cargo check 与严格 Clippy 通过，仓库级 fmt 漂移仍为 advisory），相关文件 `git diff --check` 退出 0。
- 构建/测试前后只读空间扫描：`target` 30,018,773,917 → 30,021,592,595 B，非 scratch `.cache` 均 355,458,670 B，task-scratch 1,176,746,096 → 1,177,316,667 B；未知项均 0。scratch 增量正好等于保留的 570,571 B 失败夹具。E 卷可用 15,045,885,952 → 12,817,940,480 B；另一个开发会话正在同卷构建，不能把卷级变化归因于本阶段。容量门槛仅作 advisory，不清理可复用缓存。

首次失败遗留目录：`E:\zicode-studio-desktop\.cache\task-scratch\json-result-http-7592bcce-e8c3-46b3-ae50-6c2a22ac617b`，owner 为 `Studio JSON result Host HTTP test`，32 文件、570,571 B。已核对其解析路径位于本项目 scratch 内；精确 `Remove-Item` 命令在执行前被自动审批策略以 `blocked by policy` 拒绝，实际删除 0 B。**不要自动重试或换方式删除**；该目录是人工清理候选，保留失败记录。

## 待验收

DevTools 原会话尚在打独立 JSON 包：需核对收据、安装、工具目录、真实 JSON 提供方和对象接收方的确认后 Worker 执行、结果展示及保存，外加撤权/超限/失败隔离、Pi 和原生窗口。此处的派生身份夹具和本机 Worker 不计入 DevTools 154 项正式接受；ZiFile 108 项也未因本阶段变化。本地版本 0.4.2 不变，不发布或生成 ZIP。
