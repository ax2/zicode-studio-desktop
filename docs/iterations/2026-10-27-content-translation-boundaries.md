# 用户内容与界面翻译的边界

2026-10-27，北京时间。上一轮遮罩实机复核完成；本轮继续日常可用度，修复已复现的预览原文误译。广泛目标“持续优化和增强项目”保持进行中，不以此声明全部工具集成完成。

## 问题与实际行为

当前 Windows 文件编码插件把本轮合成文件 `Settings` 转为 UTF-8，Host 返回预览原文仍是 `Settings`，中文页面的资源预览却显示“设置”。切英文显示原文，再切中文再次误译；同一输出 DOM 节点始终保留。这是共享 DOM 翻译器将原文当界面词条的问题，不是编码插件或磁盘原文损坏。

`outputs/content-i18n-before.json/.png` 是真实修复前证据；`content-i18n-after.json/.png` 证明修复后中文/英文/中文均保留原文。实际调用仅为本轮合成文件，明确选择、确认提供后执行，未另存结果，验证完已撤销授权。

## 实现

- `public/i18n-content-policy.js` 独立判断正文边界。尊重继承的 `translate="no"` 和嵌套产品控件的显式启用；默认保护 pre/code、textarea 默认值和可编辑内容。直接新增的 Text 节点与整棵 DOM 同样受保护，script/style 不处理。
- `i18n-dom.js` 保留上一轮 source/last 缓存修复。跳过内容时清理缓存；返回可翻译区域采用当前来源，不反向猜测中文含义。新增显式 `data-i18n-*` 产品源词条，解决代码复制控件从中文初始渲染切英文时没有规范英文来源的问题。只有可翻译的标签会使用这些来源；不能绕过正文边界。
- Notes 的预览、笔记/笔记本名称、标签、搜索片段、标题提示、大纲和关联标题加内容标记。聊天用户/助手/流式 Markdown、文章预览、文档预览和产物 Markdown 同样标记正文；未重挂整个 React 根节点。
- 代码复制动作明确启用翻译；`localized-copy-label.js` 管理按钮和状态的规范来源。正文和复制内容不变，Copy/Copying/Copied/失败等产品状态继续随语言变化。
- 大文件例外：NotesApp、ChatMessageList、ArticlesApp、DocumentsApp、ArtifactApp 只做必要内容标记；Markdown 大模块只加标记和标签接线，判断规则/标签状态辅助函数独立，未扩大业务流程或改存储格式。

这是一轮已审计显示范围的保护，不声称所有产品中的动态标题、第三方页面都已完成全面内容边界审计。

## 验证

- 先加入 7 个边界测试，旧实现 6 失败、1 通过，失败证据 `work/content-i18n-red.log`。最终相关 15 文件 279 项通过，另新增聊天内容/流式更新边界 1 项通过，共 16 文件 280 项不同测试；没有把重叠复测相加。
- 真实 Notes React 界面在当前 WebView2 内通过内存 gateway/draft/shortcut 挂载合成笔记。中文初始加载，EN/ZH/EN/ZH 后 Settings 标题/正文/大纲、Tools 标签、Copy 笔记本名与内联代码不变，同一 preview 节点保留，代码复制内容为 Settings。写入计数为0；剪贴板调用仅在测试期间截获并恢复，未覆盖用户剪贴板。这是实际组件显示验证，不冒充真实笔记 Host CRUD 或模型生成。
- 真实编码插件的上述前后流程通过；640×600、1000×700 客户区下预览可命中、无 sidebar 遮罩、无开放 dialog/框架错误遮罩。Browser plugin not available，沿用既有本机 WebView2 CDP；不声称物理外框缩放或其他平台验证。
- 真实编码调用与 Notes 验证运行时异常0，编码流程警告0。9个实际 HTTP 资源 SHA 与当前源码/构建产物完全匹配，`outputs/content-i18n-health.json`。
- Typecheck、check/design/Pi 对齐通过；最终delivery日志为159 warnings、10 infos（早期检查153），终端 inline-style advisory保留。React构建成功。Rust/EXE未改，不重复原生全构建。此处告警数量按原始最终日志更正，上一轮归档原件不改。

保留的观察修正：首个脚本误选资源接收工具下拉，后改为精确参数下拉及枚举序号；重复选择同文件已有授权时确认按钮正常禁用，先撤销本轮授权后重新选择。未改产品保护或为超时重启。Notes脚本先遇到模板字符串换行和DOM序列化引用过长，改为JSON注入合成数据及void引用赋值；未把这些观察失败当通过。Typecheck首次失败是测试直接导入JS无声明，改为现有shared/i18n入口后通过。

## 数据与运行状态

最终普通 Studio PID39392 单实例响应，9227关闭，19 DevTools启用，版本0.5.3，入口 `D:\work\start-zicode-studio.cmd`。EXE SHA仍 `CAFCDA17A4448CE7945B51B551F10BC36F7E03D40990E74BD14FDF22E2AC3995`。已从调试实例44616正常退出后恢复普通启动，无强杀、无替换原生文件。

资料库仍 `D:\work\local-state\zicode-studio-desktop`；前、界面后、最终核对26原文件SHA、工作区登记、固定位置选择均不变，SQLite integrity ok，两篇原note ID经真实snapshot.notes可读。未写原笔记/迁移/恢复/清空历史。无定时任务、模型调用、生产服务、发布、外部消息。磁盘预算前后扫描保留，无缓存删除。

证据在本会话 `work/content-i18n-*`、`outputs/content-i18n-*` 与 `D:\work\logs\zicode-local-setup\studio-content-i18n-2026-10-27` 的SHA索引；入口脚本与数据核验可沿用本会话既有helper。
