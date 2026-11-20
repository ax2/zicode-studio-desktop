# 图片结果易读展示：当前 Windows 验收

图片元数据工具执行后，默认显示格式与方向尺寸、原始/完整清理副本字节数、实际检测到的元数据类别及GPS目录标志。清理结果说明新副本未发现可识别元数据，并保留颜色、画质和未知私有数据的提示。完整图片和缩略图仍使用原有独立预览、共享及显式保存入口。

原始JSON默认折叠在“查看原始报告”内，展开后是只读文本框和“全选报告”；字符不经过翻译，也不会因语言切换重建文本框或丢失选区。损坏图片用简明提示展示，保留选择；换图、重新执行、撤销共享或权限失效会清空旧摘要和报告。

实现位于独立`public/native/plugins/image-metadata-result.js/.css`，目录执行器只负责生命周期接线。仅对精确metadata执行profile及inspect/clean能力启用；其他工具结果保持原流程。摘要核对格式、尺寸、字节、元数据分类与清理零计数，未知报告回退到可展开原文。补齐成功响应缺少协商输出frame的拒绝；Host业务失败无输出的情况继续支持。原始报告使用text/value，不解析为HTML。

## 验证及真实失败

- 五文件68项通过：报告展示/语言/选区/生命周期、原有目录执行、输出协商、调用状态及文件预览。前端检查、设计检查、语言覆盖和React/CSS构建通过；既有159warnings/10infos与终端样式advisory保留。
- 第一轮真实WebView发现：pre原文在语言切换后失去浏览器选区，而jsdom原用例通过。保留失败收据，改为只读报告框和显式全选，实际Windows复验文本框身份、完整字符、selectionStart/End及展开状态全部保持；没有放宽断言来隐藏问题。
- 当前Windows Studio WebView2经本机CDP，验证带EXIF方向PNG检查、清理、元数据类别、原文默认折叠及全选、中英文切换、损坏图片保留选择及重选恢复、1600万像素调色板PNG的48,007,728字节完整结果摘要和640缩略图。360×640、640×600、1000×700摘要无横向溢出、无遮罩且原选择保持；截图实际查看。无Runtime异常、console error或warning、框架错误遮罩，无自动保存。Browser插件未提供，不声称其他平台或OS窗框自动化。
- 实际服务的结果组件、执行器、输出校验、i18n和样式五文件SHA与当前源码匹配。只改前端，本轮没有Rust修改、EXE替换、插件重装或重复跑已通过的算法/原生全量套件。

## 数据与普通启动

前置三篇笔记32文件与上一批快照一致。期间第三篇笔记在08:55:43Z保存了一次更新，早于本轮最终WebView验证开始；Markdown514→512字节、vault元数据和变化日志更新，原2037字节日志完整为2328字节新日志的前缀。停止旧基线比较后，另存当前32文件快照到固定资料库`retained-backups/before-metadata-readable-2026-10-29`，上一批备份也完整保留；不把新编辑回滚到旧稿。

正常退出调试实例64240后恢复普通实例7944，20插件持久启用、9227关闭；三篇笔记通过实际Host可读，当前最新32文件逐项一致，固定选择/工作区登记不变、SQLite完整。EXE SHA仍`1084783C706C2E0C72A17B8C2BD5BA7F0924606DF21B4DEC540BB1A71563F85E`。没有定时任务、模型/生产调用、发布或原文件写入。全体工具集成仍为20包99能力+7View，154源工具5完整/49部分/100无映射，不增加完整工具计数。

本机证据位于本会话outputs及`D:/work/logs/zicode-local-setup/metadata-readable-2026-10-29`：`metadata-readable-live.json`首轮失败、`metadata-readable-live-final.json`最终实际验收、`metadata-readable-served.json`、`metadata-readable-normal-final.json`、`metadata-readable-data-normal-final.json`、`metadata-readable-verified.png`，以及本轮测试/检查/构建/预算日志。

大文件例外仅既有i18n字典新增条目和style.css增加一个功能样式导入；新逻辑独立模块，原目录执行器约200行内只增加接线，未触碰笔记实现。
