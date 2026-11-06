# 当前 Windows：Markdown 预览和 HTML 导出已可用

当前安装版0.5.3已原位更新，EXE SHA256 `A4E1133BC878FEE694DBF1D9B52E557AA5F15EE6C64C9004200DC283AA513F28`。独立插件`com.zicode.devtools.markdown`0.1.0候选01已安装、授权并启用。在工具目录搜索“Markdown”，可粘贴文本或选择UTF-8文件，确认提供后执行，阅读文档结构、查看/全选完整HTML，再明确确认另存副本。执行JSON折叠到“执行详情”。

当前21包、100项按插件身份区分的能力操作和7个View；154源工具中5完整、50部分、99无映射。Markdown按部分范围记录：**从已选文件直接载入可编辑草稿、自选导出文件名/路径尚待迁移**，当前为独立粘贴或文件执行、项目内生成名称另存。没有以一批可用操作代替全部源工具接受。签名、其他平台和原生computer use均不阻挡已验证的当前Windows范围。

## 实现和验证

- 原生/算法/WASI及预算见[候选记录](2026-10-30-markdown-resource-candidate.md)：33真实Worker检查、原生完整HTML逐字节一致、2MiB输入/20万事件/16MiB HTML上限。模块及61文件冻结候选未修改。
- Host手工详情为精确Markdown接口注入可信单文本角色，manifest不能自行伪造角色；未知接口不因此获得粘贴入口。文件仍按UTF-8内容接受，不以扩展名或传输MIME缩小原生范围。
- 完整输出经逐块读取与SHA校验，16MiB读取边界检查通过。阅读预览只在永不附着的template中解析，再逐个重建白名单节点；不采用提供方节点/属性，不加载图片/脚本/样式或跟随链接。每1024节点让出界面执行，取消或失效在内容进入页面前中止。完整HTML源码另存于只读文本框，不截断；语言切换保留节点、值、展开状态与选区。
- 73项前端检查通过；新增折叠详情后26项相关检查通过（其中25项为已包含的回归，不叠加报99个不同检查）。前端/设计检查退出0，i18n缺失0；既有警告保留。Rust静态check/严格clippy退出0，既有fmt drift为advisory；18项Windows相关测试通过，其中5项新增策略测试、13项既有测试。
- 新版`build:local`成功，复用target/debug，无安装包或重复完整release。已有Medium程序文件以FileMode.Open原位更新，保留文件身份和原字节短期恢复；普通进程token8192，Shell实际注册一个托盘图标。
- 实际安装版WebView2（Browser插件未提供，使用既有本机CDP）：真实键入、粘贴/文件切换保留草稿且撤销旧共享、未知后缀UTF-8文件、非法编码保留选择并可恢复、空文档、Unicode/表格/任务列表/引用/代码/脚注、中英文切换均通过。
- **实际完整边界**：2MiB源文本生成10486640字节HTML，完整预览/源码全选/SHA比对通过；通过界面先取消保存，再明确确认保存，资料库下载10486640字节摘要与原生结果一致。20万个结构事件实际显示66666个段落和2个分隔线，不用小样例替代。360/640/1000客户区宽度无侧栏遮罩、无横向文档溢出、输入可点击。未声称改变了OS窗框或验证其他系统。
- 最终稳定实际界面中，主动点击惰性链接不导航；给同一阅读器直接注入script/img/iframe测试也没有执行或外部请求。无Runtime异常、无操作期控制台警告。实际服务四个关键资源SHA与本地逐一匹配；截图已查看。

## 真实失败和边界

第一轮全功能流程已执行到最后日志检查，但测试把`http://ipc.localhost`当作外部网络，并要求重载全过程绝对无警告，因此最终assert失败，原收据保留。实际记录6条Tauri重载时的custom-protocol fallback/旧callback提示，源代码确认来自Tauri2.11.2 `scripts/ipc-protocol.js`和`core.js`。没有改框架或屏蔽console，后续稳定窗口从重载到操作均0警告、0异常、0真正外部请求。没有把第一次失败收据改成通过或声称所有历史日志为零。

另一次安全点击测试把自己的夹具放在可视区域之外，实际鼠标被遮挡；保留失败，只修正测试夹具位置，再次真实点击通过。候选及算法不变，已通过的大边界没有无理由重跑。

三个笔记及32个原有文件在更新前、退出后、界面操作后及普通启动后SHA一致。旧保留备份逐文件核对，不覆盖用户编辑；工作区登记和固定目录选择不变，SQLite integrity=ok。固定资料库仍`D:/work/local-state/zicode-studio-desktop`。额外生成的一份测试HTML位于该项目`.zicode/outputs/261203f2-b4cc-4b68-a036-0364be03c689/result.html`，有明确保存收据；没有修改原文或删除用户文件。

最终恢复普通进程38100，9227已关闭，21包持续启用，真实Host可读笔记2+1。未创建定时任务、调用模型或生产服务、发布、发送其他会话消息或强停进程。

证据在本会话工作目录：`outputs/markdown-windows-acceptance.json`、首轮`markdown-studio-live-*.json`、`markdown-stable-ui.json`和first失败、`markdown-studio-verified-final.png`、`markdown-normal-final.json`、`markdown-preview-data-normal-final.json`。Provider便携交付记录为`docs/studio-local-deliveries/2026-10-30-markdown.json`。广泛项目优化目标保持进行中。
