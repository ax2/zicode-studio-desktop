# 当前 Windows：工具输出可自选位置另存新文件

已构建并更新当前 Studio0.5.3：工具执行后点击“预览保存”→“选择其他位置…”，通过真实系统保存窗口选择新文件名/位置，再在Studio确认目标和大小。项目内保存和资料库入口保留。当前HTML导出可离开项目目录，插件和Worker不会获得磁盘路径，也不会写回原文件。

## 实现与交付

- 新公开父页面契约[resource.export.file.draft1](../plugins/resource-export-file-draft1.md)，只向可信工作区窗口提供4个原生命令，HTTP/插件iframe/Worker没有任意路径写入入口。已有派生输出与原预算不变，不需要重新打包提供方算法。
- 原生选择前后检查当前窗口/工作区及精确输出身份；60秒有限授权绑定窗口、路由、owner、resource和摘要。选择后仍须单独确认，未确认/取消不写入。仅接受本地新文件，已有文件及不安全路径拒绝。
- 完整已确认输出分块写入同目录新临时文件，刷新并校验完整长度/SHA；实际发布前再次检查资源及所有祖先权限。Windows在写入期间锁住目录祖先、核对原目录身份，并按已打开文件句柄原子重命名，禁止覆盖。并发目标出现也不会替换。一次授权不能重复提交。
- 返回不确定时可明确“检查已保存文件”，只读全文件摘要核对；不会重试写入或修复用户后续修改。明确确认的文件不会因关页、权限过期或重启而删除。进程中断可能留下本次已确认写入的pending临时文件；尚未宣称崩溃恢复/网络卷/其他平台验收。
- 新逻辑分成原生选择器、Host授权、文件发布、父页面确认模块。大文件例外：main.rs仅增加模块导入和4个命令接线，host_server.rs仅重导出上下文，Store仅增加字段/失效接线；没有将实现塞入大入口文件。既有插件网关仅接入4个固定原生命令。

## 自动化和实际 Windows 验证

| 范围 | 证据与结果 |
| --- | --- |
| 前端行为 | 53项相关检查通过；追加网关固定命令用例后该32项通过，其中31项重复，共54个不同用例 |
| 前端/设计/语言/原生命令权限 | 退出0；i18n3626键、缺失0，54个原生命令声明完整；保留既有163 warnings、10 infos及终端生成样式advisory |
| Rust静态 | 最终check/严格clippy退出0，既有fmt drift为advisory；初始参数类型与紧邻if规范失败记录保留 |
| Windows原生 | 普通完整性级别8192，7个新导出测试通过：Unicode/空/完整16MiB文件、已有及竞争目标、摘要错误/取消无部分结果、目录更换、用户修改、路径及授权边界；另3个既有保存授权回归通过 |
| 当前安装版真实界面 | 原2MiB Markdown经真实生产Worker生成10486640字节HTML，系统保存窗口取消、父页面取消不写入；明确确认到项目外自选中文路径成功，完整文件SHA `e8c1f3942a76bb07b0d80e674610a95e872cc7a50b25e2b2a31e38ad63d80cff`，与原生/Worker输出相同，原文件不变 |
| 真实原生命令边界 | 未确认拒绝；选择后插入同名文件时保留原内容；重复提交拒绝；保存后只读完整摘要验证，用户后续改写保留；实际撤销resource.read后拒绝且无目标文件，再恢复授权及启用 |
| 布局/语言 | 保存确认框360/640/1000宽度居中、按钮实际鼠标命中，无出界；中文切换仍显示同一目标路径，取消不写入；截图已查看 |
| 页面健康 | 实际操作期Runtime异常0、控制台消息0，无框架错误遮罩；Browser插件未提供，复用本机WebView2 CDP，系统保存窗口用限定Studio进程的UI Automation；无响应替身，未声称物理OS窗框或其他平台验证 |

完整合并收据为本会话`outputs/resource-export-acceptance.json`。原先失败记录不改为通过：第一次自动化误选与保存按钮同编号的文件列表项，修正为同时限定控件类型；第二次重复选择同一已确认文件不触发change，改为先取消本轮旧选择；第三次已完成真实大文件保存后，脚本未保留原生字符串错误码而失败。边界续测完成前5项后，因预期错误码漏掉Host既有的`resource_plugin_unavailable`失败；最终只重跑撤权项确认未写入并恢复插件。产品响应未被伪造，不为测试失败重复大文件保存。

截图发现确认框沿用默认重置后位于左上角，补充所属功能CSS的`margin:auto`，重新生成CSS，实际多尺寸/语言/取消验证通过；原生模块和已通过字节验证不变，没有重复原生构建。

## 源工具范围与数据

提供方按`src/markdown_preview.rs`逐项审计，并关联之前42项实际Worker/原生完整JSON和HTML字节一致、编辑副本/完整2MiB编辑、20万结构事件阅读/完整HTML源码、原安全模板和上限，以及本批自选新路径导出。Markdown在**当前Windows手工工具目标**完整源范围已接受：源工具1.0.2、独立插件0.1.1候选02不变。审计`docs/studio-local-deliveries/2026-10-30-markdown-full-scope-audit.json`，SHA `345be679194ca38394a3dbd7b3810158f99ea37635c24e1351f6fed185a8e651`。

当前21包、100能力操作+7View；154源工具为**6完整、49部分、99无映射**，映射总数仍55。未把整个项目或所有工具称为完成。签名、其他平台、可选AI与旧独立版EXE部署独立记录，不阻挡本机已验证工具。

新版`build:local`成功，复用原target/debug，EXE SHA256 `68D3E2990A1FC51352E2FDCB5BFDFC79BAE1199258FE0881DCE0D0855AB848EB`。以FileMode.Open原位写入保留程序文件身份，不改变资料库位置。调试实例16864正常退出，最终普通实例4280响应正常、token8192非限制、一个真实Shell托盘图标、9227关闭、21插件启用。

前后3篇笔记、32个原文件SHA一致，最近编辑和旧备份保留，工作区登记/固定目录选择不变，SQLite integrity=ok。固定资料库仍 `D:/work/local-state/zicode-studio-desktop`。本轮新导出测试文件位于本会话outputs/resource-export-files，其中明确批准的完整HTML保留；没有移除已批准输出、覆盖用户内容、恢复旧快照、创建定时任务、调用模型、访问生产服务、发布、发送外部消息或强停进程。

主要证据：`outputs/resource-export-acceptance.json`、`resource-export-native-tests/result.json`、`resource-export-existing-save-tests/result.json`、`resource-export-revocation-final.json`、`resource-export-polish-final.json`、`resource-export-centered-zh.png`、`resource-export-normal-final.json`、`resource-export-data-normal-final.json`、`resource-export-normal-token.json`、`resource-export-normal-tray.json`；编译/检查/失败日志在work/resource-export-*。广泛优化目标继续进行中。
