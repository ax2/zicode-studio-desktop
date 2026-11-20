# 当前 Windows：Markdown 文件可载入编辑副本

独立插件 `com.zicode.devtools.markdown` 0.1.1 候选02（源工具1.0.2）已安装、授权并启用。选择文件并确认提供后，可点击“载入为可编辑副本”；非空草稿先选择保留或替换。复制后的文字需重新确认提供才执行，原文件不写回。旧0.1.0候选及验收记录保留为历史。

本批仍计部分源范围：**自选导出文件名/路径尚待实现**。现有21包、100项能力操作、7个View，154源工具为5完整、50部分、99无映射；不因增加编辑操作提高完整工具数。签名、其他平台和原生computer use不阻挡当前Windows已证明范围。

## 实现和验证

- 文件读取严格使用已确认Host快照，32KiB分块至完整EOF，最多2MiB；完整SHA校验、严格UTF-8解码、采用前再次验证读取权限。取消、模式切换、选新文件、撤权或视图失效不采用迟到内容，失败保留旧草稿；没有绕过Host读取原路径。
- 新精确契约 `resource.wasi.markdown.v1 =1.0.0-preview.2` 增加由可信父页面管理的 `sourceMode`。文件移除一个UTF-8 BOM，草稿不重复移除。双BOM文件载入后保留一个，编辑前缀也保留；旧preview1继续接受且不启用新编辑入口。算法/256MiB内存/10秒/10亿fuel及2MiB输入、20万事件、16MiB HTML预算不变。
- 42项实际生产Worker向量与原生完整JSON/HTML逐字节一致，其中9项覆盖来源模式、双BOM、编辑及非法模式。提供方9项核心/适配测试、定向严格clippy通过；Host静态check/严格clippy退出0，19项相关Windows测试通过。既有fmt drift仅为advisory。
- 前端5文件35项检查通过；后续取消状态文字修正的3文件24项中23项重叠，因此共36个不同用例，不叠加为59。前端/设计检查退出0，i18n缺失0；保留既有163 warnings、10 infos及终端生成样式advisory。
- 当前安装版WebView2真实鼠标/键盘：选择/确认不会隐式读取或执行；保留旧草稿不读取，明确替换后才载入；复制撤销旧共享且执行按钮关闭，重新确认后可运行。双BOM/编辑前缀/语言切换、非法编码与超长文件保留草稿均通过。
- 实际挂起真实Host读取后，取消、切换模式、撤权再放行原请求，迟到内容不能替换旧草稿；未伪造读取响应。完整2MiB BOM文件载入2097149字符，再实际键入3字节至完整2MiB，经真实Host/Worker执行成功。360/640/1000客户区宽度输入可达、无侧栏遮罩。运行异常、操作期控制台消息、真正外部请求均0；截图已查看。Browser插件未提供，使用已有本机WebView2 CDP；未声称物理OS窗框或其他平台验收。
- 最后仅补充并发执行使复制失效时的取消状态文字及定向用例；该精确并发边缘有单元回归，不冒充另一次实机验证。完整载入/取消/撤权路径已实机通过。

候选0.1.1-01保留了过期README，未安装；候选02只纠正文档，WASM和42向量证明相同，61文件外部收据逐项验证。当前WASM454711字节，SHA256 `f952a20a049f21176da766e82399d48a8e45992c6c5f1975c8abf0978790bda3`。冻结候选不原地更新。此前完整10486640字节HTML保存/下载及20万事件阅读证据仍有效，未因无算法变化重复执行。

本批build:local成功，复用target/debug，无安装包/重复release。当前EXE SHA256 `CB4089A947FB82CED15065FD7A33D36B16E9594881FC2FB5B60333F6C456C550`，FileMode.Open原位更新保留Medium文件身份。普通启动token8192、一个真实Shell托盘图标、9227关闭、21包持续启用。09:32遮罩续验后最新普通实例28012；编辑批初次交付实例61820为历史记录。

前后3篇笔记和32原文件SHA一致，最近编辑及旧备份均保留，工作区登记/固定选择不变，SQLite integrity=ok。固定资料库 `D:/work/local-state/zicode-studio-desktop`，没有迁移、重建或恢复旧快照。没有定时任务、模型调用、生产服务、发布、外部消息或强停进程。预算扫描前后退出0，缓存保留。

本会话证据：`outputs/markdown-editable-copy-delivery.json`、`markdown-editable-copy-final.json`、`markdown-editable-copy-verified.png`、`markdown-draft-worker-20261030-090403/result.json`、`markdown-draft-host-policy/result.json`、`markdown-draft-data-normal-final.json`、`narrow-current-normal-final.json`、`narrow-current-data-final.json`。提供方交付收据 `docs/studio-local-deliveries/2026-10-30-markdown-editable.json`。广泛项目优化目标保持进行中。
