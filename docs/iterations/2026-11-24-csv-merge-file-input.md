# CSV 合并与关联的双文件输入

打开左连接、内连接、按行追加或拼列，使用「导入左表…」和「导入右表…」分别选择两张表。检查连接键和输入，再执行操作。可撤销最近一次导入。左右两侧均为可编辑草稿，原文件保持原样。

两个输入需使用相同格式，支持 UTF-8 CSV、TSV 和 JSON。每个文件的限制为 8192 字节。右表放入 Compute 的选项字段，序列化后的选项上限为 16384 字节。加载文件保留另一侧和现有连接键。

## Windows 验收

- React 选文件回归连接生产 Worker，并分别使用冻结 Compute 0.1.0 候选 02 与 0.2.0 候选 01。左连接含重复键和缺失键、内连接、按行追加、拼列均逐字比对结果 CSV。各例覆盖 CSV、TSV 和 JSON。
- 格式不符、选择取消、右表序列化超限和撤销均保留上一份已确认输入。还复跑了共享的列变换文件导入。
- 复跑时设置 ZICODE_TEST_TRANSFORM_WORKER 和 ZICODE_TEST_TRANSFORM_MODULE，运行 ManualToolTransformApply.test.tsx。Windows 系统选文件窗口、结果另存和更大输入仍由 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28) 跟踪。
