# 当前 Windows：图片元数据报告内容修正

图片元数据结果的“查看原始报告”此前显示整个执行响应，包括`ok`、`operation`和`previewIndex`外层；用户全选复制后得到的不是独立`image-metadata-report`文档。现在成功且通过原有校验的检查/清理结果显示`report`本身的完整、格式化JSON，保留提供方所有字段、来源指纹与隐私说明。无效结果或业务错误仍保留原始响应，不伪造成功报告。

本次仅调整Studio父页面，未改变提供方算法、冻结插件、Host权限、原图或执行结果；未新增自动写入、模型或网络行为。此改动便于全选复制报告，**尚未实现独立JSON文件另存、原生备忘录接力或图片工作区实例新建/替换**，图片元数据仍按部分源范围记录。现有21包、100能力+7View，154源=6完整、49部分、99无映射。

- 3文件41项前端检查通过，涵盖检查/清理、错误、全选、语言和资源执行；前端/设计检查退出0，既有告警保留。未修改Rust，不重复原生构建。
- 当前安装版Windows WebView2真实Host/Worker执行静态PNG的检查和清理：两个可全选JSON均逐字段等于各自实际Worker报告，外层执行字段不混入；检查报告没有清理预览，清理报告含复检结果。语言切换保持报告文本、选区和展开状态。
- 360×640、640×600、1000×700客户区内容可见、无水平溢出或侧栏遮罩；无运行异常和console error。Browser插件不可用，使用本机WebView2 CDP；未宣称物理OS窗框或其他平台验证。测试素材摘要不变，未触发文件保存。
- 3篇笔记与32原文件前后SHA一致，SQLite完整、工作区登记和固定选择不变，没有恢复旧快照。固定资料库仍`D:/work/local-state/zicode-studio-desktop`；调试实例37284正常退出，最终普通实例68776响应、调试9227关闭、21包启用、两工作区笔记2+1可读。普通Host实际提供的报告脚本与当前源码SHA一致。未创建定时任务，未强停进程。

证据在本会话`outputs/image-report-standalone-live-final.json`、`image-report-standalone-verified.png`、`image-report-standalone-normal-final.json`、`image-report-standalone-served.json`、`image-report-standalone-data-before.json`/`-data-after-ui.json`/`-data-final.json`及`work/image-report-standalone-tests.log`、`-check.log`。磁盘扫描前后完成，保留有效缓存和所有用户数据。
