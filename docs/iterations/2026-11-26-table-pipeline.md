# v0.7.9 · 运行表格管线并保存 CSV

在 Studio 插件管理选择「安装本地插件」，打开[完整冻结候选](../../tests/fixtures/devtools-windows-file-tools/table-pipeline-0.1.0-candidate-01)，审核并启用 `resource.read`。从源码仓库取得候选和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/table-pipeline-0.1.0-candidate-01-verification.json)，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)校验原始字节。

在工具中心搜索「运行表格管线并保存 CSV」。选择一份独立版管线 JSON 配方和一份 UTF-8 CSV、TSV 或 JSON 表格，核对列表里的文件名并确认共享。按列表顺序填写配方的位置 1 或 2，默认第 1 份。数据格式默认 CSV，可改为 TSV 或 JSON。手动执行后检查步骤、行列数和 CSV 产物，再通过「预览保存」和「确认保存文件」创建新的 `result.csv`。Studio 保留两份输入文件的原始内容。

同源执行支持格式 1–3 的列变换、选列、筛选、稳定排序及保留首条去重。CSV 始终启用原生文本公式保护。可使用未设置输出格式或明确启用 CSV 公式保护的配方。SQLite 输出、流程编辑、单步应用与撤销、多实例及更大输入继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

两份文件各最多 16 KiB，最多 96 行、16 列。小表最多执行 32 步，合成 96×16 表已验证 5 个混合步骤。中间表上限 16 KiB，按逐步处理的字节、单元格、排序键和非 ASCII 大小写转换计算的累计工作上限为 131,072 单位，CSV 上限 32 KiB。超限可拆分表格或配方后重试。

## Windows 验收

- 提供方 [ZiDevTools #50](https://github.com/ax2/zi-devtools/pull/50) 合入 `367cb2e5a51b01970a624401e69303f806bcc967`。冻结直接来源 `23a457b1dac370bb59e1d63386364ca5425ffae5`。吸收 Compare #49 后在送审 `860dad184d634776691891fc82261f3817fff5b3` 局部重建，WASM 与原冻结逐字节一致。共享核心回归 12 项通过，独立版工作台 97 项通过、1 项既有忽略，定向严格检查通过。
- 已在实际 Windows Worker 执行 48 项固定用例，覆盖精确 16 KiB 输入、工作量边界、Unicode 大小写、四键排序、精确大整数、CSV 公式保护、原件摘要和错误无输出。其中三项验证 Worker 拒绝重复资源身份和内容摘要不匹配。保留早期密集管线的 fuel 失败记录，最终使用原 Worker 限额。回执 SHA-256 `aaf036078a1b8e62e66ce61995cdee35e4cd7c6cd313c705102ee555ae5a0172`。
- 冻结包 8 件、572,826 字节。目录索引 SHA-256 `987903675e0fe04bf53c3ad1062f5af941f197f577aaa09226fb45d0ce7da6f5`，WASM `0420a5aa70e4271c6aa46c6256c3131ad8135f5c98405df698bd0f6a67b1e28c`，逐件收据 `1476b914a2e2bb6b28aa4096f5bd667b21ae3f0491ce7109d0c53f0656c59915`。
- 复用隔离 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`。正常工具中心核对两份反序选择，明确第 2 份是配方，七步将 5 行转换为 3 行；取消共享和保存、单份源与坏配方拒绝、TSV 执行、确认写入和撤权均通过。重启后独立解析同一份 64 字节 CSV，包含「城市」表头、引号内逗号和以单引号保护的计算式。结果 SHA-256 `5cf2c85934f83b2c58b6e66a89afa1129751984d0f2530cfaf53a5c9e90be631`，两份原件摘要均保持。自动化使用实际应用表单及合成文件，系统原生文件窗口和任意位置另存留集中验收。
- 首装、重启及独立读回回执 SHA-256 依次为 `00617098c2bbbebc333106b557adc01bfe505938bdef079827a516723ac06d4b`、`47f1d0b08a004f50f9e6d42368a14a6c83539bac932f4471d5a7f93a27d0323b` 和 `39e6ada9850f4fd6300a184a514b0a4870f091811ef52aa3aecf1b9c3ddcf1d3`。
