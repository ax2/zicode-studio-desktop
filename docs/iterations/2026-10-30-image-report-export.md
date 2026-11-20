# 当前 Windows：图片元数据报告可直接保存

图片检查或清理后，展开“查看原始报告”，点击“保存报告”，可选择保存到当前项目，或通过系统窗口选定新的JSON文件位置；均需再次确认，已有文件不覆盖。保存内容为实际Worker报告本身，保留来源指纹、分类计数与说明，不包含执行响应外层。原图片不会改写。

## 实现与验证

- Host仅在原有图片元数据协议、完整schema2报告和图片输出校验成功后，构造独立`application/json`报告资源。公开父页面扩展为[resource.host.image-metadata-report.draft1](../plugins/image-metadata-report-resource-draft1.md)：资源绑定原图、所有授权祖先及SHA，随撤权/过期失效。与图片结果原子接纳，不自动写文件；JSON是Host内部类型，未增加WASI guest类型索引或插件权限，冻结候选03/WASM不变。
- 报告计入既有Draft1与总资源预算。如果报告额外占用会触及预算或资源槽上限，则省略可保存的报告资源，保留原有图片执行结果并提示仍可全选复制；原有图片预算和能力不缩水。业务错误、无效报告和取消不生成报告资源。
- 前端检查103个不同用例通过：报告/输出/工具执行/保存60项、输出格式与资料库23项、原有资源执行回调20项；后续51项为重叠复测。原生Windows测试13项通过：报告与原图绑定/撤销及满载回退2项、既有图片协议3项、保存回归7项、guest类型索引1项。Rust静态check/严格clippy退出0，既有格式漂移为advisory；前端/设计检查0，i18n3628键缺失0，既有前端告警保留。
- 实际Windows WebView2和真实Host/Worker：检查与清理的独立报告逐字段等于各自工具返回，完整字节SHA一致；检查报告通过界面确认保存到项目，资料库下载完整且摘要相同。清理报告在系统保存窗口选择项目外中文`.json`路径，另行确认后得到1454字节完整文件，摘要`0c91e540ff5287cad64e17ebc9c16c6efad9831cd756d168ac912176d7e48d56`；选择窗口取消和确认框取消均不写入。360/640/1000客户区确认按钮实际可命中。撤销原图授权后报告资源不可读取，已保存副本与原图片保持。无Runtime异常或console error，截图已查看。
- Browser插件不可用，沿用本机WebView2 CDP；仅对本次Studio进程的系统保存窗口使用UI Automation。没有伪造Worker/Host响应；未声称物理OS窗框、其他平台或所有源工具完成。

## 失败记录与范围

旧执行回调回归先发现多传了空参数，修复后原20项回调测试通过。初次原生策略测试筛选0项，已改用真实模块名称运行3项，不把0项记为通过。首次实机脚本选错隐藏文件框；第二次读取请求超出Host既有32KiB分块；第三次项目保存/下载和两种报告校验已成功，但系统窗口控件尚未就绪时自动化查找取消按钮失败。均保留失败证据；修正脚本后，最终续测只读核验已保存项目报告，未重复创建，再完成系统取消/确认/撤权。上述属于测试定位和边界问题，未修改响应或把旧失败改为通过。

当前Windows图片元数据仍为**部分源范围**：原生图片工作区实例新建/替换接力、报告发送备忘录仍待；报告另存已完成。21包、100能力+7View；154源工具=6完整、49部分、99无映射，计数不变。签名和其他平台独立记录，不阻挡本机已验证范围。

新版`build:local`成功，EXE SHA256 `95F7C567610D2F7AD1285BFCC22E2A0A279EA9242DA1E6C8B8C0DC10BD42A062`，以FileMode.Open原位更新保留程序文件身份。调试实例63904正常退出，最终普通实例26088响应、9227关闭、token8192非限制、一个Shell托盘图标、21包启用。没有强停进程或创建定时任务。

更新前、退出后、界面操作后及普通启动后：3篇笔记与32原文件SHA一致，最近编辑和旧备份保留，工作区登记/选择不变，SQLite integrity=ok。固定资料库仍`D:/work/local-state/zicode-studio-desktop`。明确保存的合成检查报告保留在该项目`.zicode/outputs/8dce41d6-d50c-4258-94f3-6014ad91bfae/result.json`；清理报告保留在本会话`outputs/resource-export-files/图片元数据报告-1793328281207.json`。没有恢复旧快照、覆盖用户数据、调用模型、生产服务或发送外部消息。

主要证据在本会话`outputs/image-report-export-delivery.json`、`image-report-export-live-final.json`、`image-report-export-1793328191325.json`、`image-report-export-verified.png`、`image-report-export-native-tests/result.json`、`image-report-export-save-tests/result.json`、`image-report-export-normal-final.json`、`image-report-export-data-normal-final.json`及`work/image-report-export-*`日志；提供方收据`docs/studio-local-deliveries/2026-10-30-image-metadata-report-export.json`。Host/Worker既有大文件仅增结果接线，其他实现集中于原资源输出模块和独立父页面组件。
