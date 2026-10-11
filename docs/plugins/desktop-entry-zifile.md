# 桌面入口与 ZiFile 接入

2026-10-11，开发版0.4.2。用户新增范围：托盘及右键、Explorer菜单、ZiFile功能集成。三项均为持续交付范围，首阶段不代表全部完成。

## 托盘

Tauri原生托盘，左键恢复所有项目窗口，右键显示/隐藏所有窗口/退出。关闭项目窗口时保存几何状态并隐藏，保留WebView、运行任务、输入和待确认内容。托盘创建失败则保留普通关闭行为，避免无恢复入口。退出走既有Host退出屏障与Pi子进程回收；隐藏不会执行工具、注册开机启动或改变自动化设置。当前菜单中文；英语/主题图标和收藏最近快捷入口待完善。

## Explorer 适用入口

只注册一个“ZiCode Studio”父菜单，根据选择内容显示少量有效操作，不将全部插件变成右键项。菜单只递交本地路径和动作意图，进入可信Studio页面选择项目并确认，不在Explorer进程读取文件内容、运行算法、联网或写入。

| 选择 | 合适入口 | 准入与操作 |
| --- | --- | --- |
| 文件夹/背景 | 在Studio打开项目；创建压缩包 | 打开目录不执行脚本；压缩先选择目标、格式和冲突策略 |
| 单个压缩包 | 浏览；完整性校验；解压到… | 按签名识别；解压、覆盖分别预览确认；格式能力以插件实包为准 |
| 多个文件/文件夹 | 创建压缩包；比较两个文本文件 | 单次有界选择；不隐式递归或上传；比较恰好两个且满足类型预算 |
| 单个文件 | SHA-256；文本编码/格式；图片处理 | 通过资源授权读取；大文件走流式摘要，不能套用8192字节文本schema |
| 图片 | 查看元数据；转换/缩放/压缩 | 资源实包到位后启用；生成文件需确认 |

不得显示不支持的按钮；未安装/禁用插件、无权限、超预算或类型不匹配时隐藏。仅启动界面不能计为工具已接入。

Windows当前是NSIS分发。传统菜单可用用户级HKCU shell verb；Windows11一级菜单需IExplorerCommand和应用身份（MSIX或经验证的身份方案）。应独立Studio CLSID/包身份，不能复用ZiFile扩展、覆盖它的注册或把“显示更多选项”说成一级菜单。安装可选、当前用户范围、卸载只移除归属本应用的记录。实现与真实Explorer截图仍待。

参考：[Microsoft官方Explorer集成](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer)、[Tauri托盘](https://tauri.app/learn/system-tray/)。

## ZiFile 功能范围与缺口

只读核对本机E:/zifile当前源码0.1.15：README、core格式能力、CLI、worker-protocol与shell。目录仅用于维护审计；Studio运行时不得依赖该路径。既有记忆中的RAR创建限制已过期，当前源码声明RAR5创建，仍须逐项实包验收。

| 功能 | 提供方当前代码 | Studio接入缺口/要求 |
| --- | --- | --- |
| 格式与签名检测 | CLI formats/detect，18格式枚举 | 版本化format能力目录与有界probe接口 |
| 浏览、搜索、分页、元数据 | Worker List，ArchiveEntry事件 | 有界流式事件、游标、资源身份、UI列表；不能一次加载无上限条目 |
| 完整性校验 | Worker Test | 进度、取消、超时、密码引用、结果显示 |
| 全量/选中解压 | Worker Extract，selected_paths | 授权目标目录、路径穿越/链接/炸弹预算、冲突预览、写入确认 |
| 创建/加密/压缩等级 | Worker Create | 多源目录读取授权、目标文件确认、可用等级/加密能力；密码瞬时传递 |
| 添加/删除条目 | Worker Update含remove_paths | 原包身份+版本、修改预览、原子替换与恢复、取消一致性 |
| 单项/批量重命名 | Worker Rename | 原包版本、映射冲突预览、明确提交、保留旧包直到完成 |
| 覆盖/跳过/改名/报错 | ConflictPolicy | 不能把解压授权当覆盖授权，策略必须展示 |
| 格式差异 | 18格式：ZIP、7z、TAR及组合、常见流、RAR、CAB | 以每格式/每操作能力表约束，不对RAR/CAB承诺更新/重命名 |
| 最近文件/拖放/快捷键/语言主题 | 独立桌面实现 | Studio按自己数据作用域实现，不共用ZiFile配置或最近列表 |
| Explorer快速创建/解压 | 独立Shell扩展 | Studio独立菜单与身份；不加载/接管ZiFile DLL |
| CLI、独立桌面、MSIX/更新器 | 独立产品交付 | Studio复用插件能力，不嵌入另一桌面、安装器、产品更新器；保留独立版 |

以上均未成为Studio可运行的ZiFile插件，完整功能接受0。ZIP依赖存在不代表已集成ZiFile，启动zifile.exe也不能替代插件接入。

2026-10-11 补充：[18格式逐操作矩阵与draft2接口需求](zifile-integration-requirements.md)覆盖108个格式操作单元及桌面能力，逐项列出Host/提供方缺口与重开条件。原生运行时尚未实现；当前源码安装门禁会明确拒绝native/未知runtime声明，签名预览也在持久信任与解包前拒绝，不再静默忽略。

## 独立插件接口需求 draft1（未发布）

1. 提供方交付版本化`com.zicode.zifile.archive`插件，独立版继续使用同一算法核心；按OS/架构附签名native Worker及公开manifest、许可证、SBOM、摘要、协议schema和向量。不得Cargo path依赖或共享可变配置。
2. Studio定义通用受控native-plugin Worker运行时，严格验证签名/入口/架构；默认无网络、无任意shell，不启动提供方UI。当前仅WASI插件执行，原生Worker能力仍需实现。
3. 对外用版本化callId、操作、资源引用和内容版本；Host验证场景/项目/lease后映射私有沙箱输入与暂存输出。ZiFile v3 Worker直接接受绝对路径及密码，其内部协议不能原样暴露给不可信iframe；需适配层，不能把字符串路径当授权。
4. 首包实现formats/probe/list/test，后续create/extract/update/rename操作必须一并保留范围。读目录grant、流式输入输出、取消/进度、条目分页、密码短期引用和有界错误均是准入要求。
5. 写入分prepare/commit，预览目标、范围、冲突与内容版本；确认后执行，调用状态不明不得自动重试。更新/删除/重命名按操作授权，原子替换、失败回滚与持久恢复分别验收。
6. 对照ZiFile已有18格式能力声明逐操作建矩阵；不支持的组合列出提供方原因与替代，不减少总功能范围。实包发现→加载→执行→展示→接力/保存、撤权/升级/失败隔离与支持OS分别举证。

本轮未修改ZiFile或DevTools，未发消息到其他会话；接口需求作为可交付文档。下一阶段优先Explorer目录启动的用户级可选注册与受控native Worker读能力，随后归档写入生命周期。

2026-10-11 后续：首个[传统Explorer文件夹入口](explorer-folder-entry.md)已实现目录CLI及当前用户可选注册/移除；真实Explorer点击、现代菜单、文件工具与ZiFile实包仍待验收。该入口的Pi自动发现禁用，不自动提交任务。

2026-10-11 文件入口前置：[工具专用会话](tool-only-session.md)提供没有 Pi 进程的内部插件生命周期，避免把文件父目录直接当普通 AI 项目启动。尚未接线桌面启动/文件菜单，不计为文件入口或 ZiFile 接入完成。
