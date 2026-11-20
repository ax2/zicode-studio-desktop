# 2026-11-18：JSON 文件格式化、压缩和校验

关联 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)。实时 Project 保持开发中、P2、v0.6.4，本次仅推进 JSON 的文件子范围，不改用户优先级、版本、全量安装计数或已冻结 v0.6.4。

## 范围与来源

核对当前独立版 `ToolKind::Json` 的三操作、共享 `zi-text-core`，以及 Studio 最新集成 `55adf1ee` 后，确认路径/有序/无序对比已交付，本批不重复。格式化、压缩、校验原先仍是8 KiB内联文本；本批新增独立文件插件和明确确认后的完整另存。[合同](../plugins/json-file-transform.md)列出所有限制。

提供方源码 `8476912755c0373660296aae358380df4f261689`。冻结无签名候选02为7文件、189,064字节，目录索引 `2bfa0a11291d4c291f50b2ecca042b42256817a5ff33b24861d5f4040107e2ad`，模块 `244ac722fce1b1fec7d1d34ad79e7c21d8936aa56480cc12e0d8c307742af312`。外部收据再次逐文件复核7/7，未覆盖候选01。

## 验证

- 提供方 `cargo fmt --all --check`、25项共享核心测试、两个包原生严格Clippy、原生release适配器及WASI检查/构建通过。使用既有Windows工具链 `rustc 1.99.1 (58cf8f9c3 2026-10-13)`，两仓库各自共享target。
- [38项真实Windows Worker正反例与2项身份/profile拒绝](evidence/2026-11-18-json-file-worker.json)通过。Unicode、各类根值、三个恰好1 MiB操作、524287元素稠密输入、64/65层、重复键、超过u64整数、超长小数及下溢均有独立预期。恰好8,388,608字节的JSON结果与Python逐字节一致，SHA-256 `6ee3a2a4f06c8f086f6533bcf6dc77757179b048bfdb7e3b400f93761238602e`；加一字节拒绝、无输出。
- 实际HTTP Host安装/启用/发现三个入口，执行三操作并确认另存，未确认拒绝写入、重复确认收据一致；恰好8 MiB结果实际写入合成工作区并读回逐字节核对，源输入不变。1 MiB输入、超限、额外输入和撤权拒绝通过。旧JSON文件查询/对比也回归通过，共两个真实HTTP测试。
- Host独立复核防伪造有效报告、有损数字输出及旧深度边界：5个不同Rust测试通过（数字单位检查在命令组中重复一次，不重复计数）。执行使用 `RUST_TEST_THREADS=2`。
- 49项前端通过，覆盖三个文件入口各自1 MiB预读拒绝、完整8 MiB JSON预览及既有选择/调用行为；`bun run check`通过，保留仓库已有告警。未运行原生桌面程序，不额外创建定时任务。

独立版默认模式真实对照仍可能将重复键折叠、将超过u64整数及超长小数规范化为有损值；本批不改变其默认行为。文件模式全部明确策略拒绝，不生成丢值产物。语法错误用 `INVALID_JSON`；支持范围限制用 `JSON_POLICY_REJECTED` 并说明键唯一、深度、安全整数和精确十进制往返，不误报为语法错误。

## 保留的失败与限制

初版超限样例只有约6.6 MiB输出，断言失败后按实际输出构造超过8 MiB样例；未修改预算。旧提供方十六进制奇偶表达式触发现有Clippy规则，使用当前提供方已经采用的等价 `is_multiple_of(2)` 修正。首轮前端启动因系统临时目录权限失败，使用既有Node和受管TEMP后通过。Worker首轮将插件输入超限码与外层预执行拒绝码混同；修正精确协议断言后通过。Host首轮将单源 `derivedFrom` 误写为多源字段断言，修正夹具后通过，未改产品来源逻辑。

候选01保留，其运行计算通过但策略拒绝只返回INVALID_JSON，不作为最终候选；候选02加入明确错误分类和说明。Studio全仓fmt检查仍非零，仓库已有大量格式差异；新增Rust模块和新HTTP测试单独rustfmt通过，接线沿用既有文件样式，未批量格式化其他源码。

新profile仅在独立开发分支可用，未改日常资料库、安装程序或已冻结v0.6.4文件。UI原生文件选择/保存交互由主会话统一验收，后续集成版本安装由主会话推进。无签名和其他平台不作为本机门槛；本批不宣称完整JSON源工具或154项工具完成。

续接日志位于本会话工作台 `outputs/issue28-json-format-*`；真实Host复现入口为 `work/issue28-json-format-acceptance.cmd`，提供方可移植脚本 `scripts/verify_json_file_format.py` 需显式传入Worker/native/module/output路径。独立8 MiB合成边界夹具保留在此工作树 `.cache/task-scratch/json-format-boundary`；无用户文件内容。
