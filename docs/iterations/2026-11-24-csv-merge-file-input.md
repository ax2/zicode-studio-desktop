# CSV 合并与关联的文件导入和结果另存

打开左连接、内连接、按行追加或拼列，使用「导入左表…」和「导入右表…」分别选择两张表。检查连接键和输入，再执行操作。可撤销最近一次导入。左右两侧均为可编辑草稿，原文件保持原样。

两个输入需使用相同格式，支持 UTF-8 CSV、TSV 和 JSON。每个文件的限制为 8192 字节。右表放入 Compute 的选项字段，序列化后的选项上限为 16384 字节。加载文件保留另一侧和现有连接键。

合并成功后，可在结果区选择「将 CSV 另存为…」或「将 JSON 另存为…」。选择位置后，Studio 会显示格式、文件位置和字节数，确认后创建新文件。CSV 保留 Worker 输出的原始 UTF-8 字节，JSON 保存结果的 headers 和 rows。长整数与同名已有文件保持原样。

## Windows 验收

- React 选文件回归连接生产 Worker，并分别使用冻结 Compute 0.1.0 候选 02 与 0.2.0 候选 01。左连接含重复键和缺失键、内连接、按行追加、拼列均逐字比对结果 CSV。各例覆盖 CSV、TSV 和 JSON。
- 格式不符、选择取消、右表序列化超限和撤销均保留上一份已确认输入。同一测试复跑共享的列变换文件导入。
- Host 另存验收使用同两版冻结插件，运行 data_transform_preview_frozen_host_results。四种操作的 CSV 和列式 JSON 分别核对写入、原字节回读、取消、跨格式、重放、撤权和同名文件保护。JSON 追加夹具覆盖有符号 64 位两端与无符号 64 位最大值。
- 复跑时设置 ZICODE_TEST_TRANSFORM_WORKER 和 ZICODE_TEST_TRANSFORM_MODULE，运行 ManualToolTransformApply.test.tsx。Windows 系统选文件和另存窗口、更大输入仍由 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28) 跟踪。
