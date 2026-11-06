> 后续更新：真实CPU温度读取、硬件图表和动态托盘已交付，见[系统信息后续交付](2026-11-04-system-information.md)。本页下方的温度不可用说明是早期版本记录。

# Windows 日常功能交付与后续范围

2026-11-04，本次在当前 Windows 安装本地 debug 新版；未发布、未修改应用版本、未创建定时任务。Pi 换 DSH 仅评估，未实施。

## 已安装版本

- 程序：`D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe`
- SHA256：`BC5AA57D498B2F19026D2F650A1CF76ABB4588D11BCFDB49760C163AEA350BCB`
- 当前本会话启动进程36172，启动时间2026-11-04T02:16:05.8095758Z；再次操作前必须重新核对启动证明、路径和时间。
- 固定资料库：`D:\work\local-state\zicode-studio-desktop`，当前Host端口57620。
- 普通启动，远程调试关闭。当前资料库开启调试的部署方案曾被自动审批拒绝，未执行；随后按正常启动方案完成安装，不绕过拒绝。
- 现有六篇笔记及笔记本元数据升级前后逐项哈希一致。23个ZiDevTools包和翻译插件保持启用；启用数量不表示所有源工具完整验收。

## 本批功能与实际验收

1. 笔记列表：标题使用原按钮区域；动作仅悬停/键盘聚焦显示，触屏保留可操作入口；移除笔记本计数。笔记保留置顶，管理菜单包含移动和二次确认删除；详情移除删除入口，本地恢复移至内容底部。同父级笔记本可拖动排序，默认折叠，按资料库记住顺序和展开状态。真实Windows WebView/Host验证移动、回收站删除、拖动、进程重启后的排序和展开状态。
2. 恢复草稿另存：修复Host已创建副本但响应丢失时重试重复创建的问题。请求前持久标记不确定操作；提示核对目标笔记本后明确允许重试。真实Host提交后丢弃响应，重启仍阻止自动重试且仅有一个副本；保留原始失败日志。
3. 系统信息：独立设置页显示CPU使用率、逻辑处理器、系统报告频率、内存及固定磁盘容量。原生数据与Windows独立查询核对。当前设备未暴露CPU温度，明确显示不可用；不安装传感器驱动，不把系统报告频率宣称为有效每核时钟。可选读取已经运行的Libre/OpenHardwareMonitor CPU传感器。
4. 软件更新：独立设置页、原生检查/安装/重启桥接，保持签名检查、后台任务更新租约及版本绑定。配置的GitHub发布清单目前HTTP404，真实页面显示检查不可用；没有可供下载的发布，在线下载安装未验收。未发布签名包或绕过验证。
5. 翻译：复用已有翻译插件，首页、顶部快捷工具、应用内Ctrl/Cmd+Shift+Y，以及原生托盘翻译菜单接线。快捷键和顶部入口在实际WebView打开并聚焦输入框；真实Host使用本机合成模型服务完成一条翻译并显示结果。仅合成固定文本，无付费模型调用，没有复制/更改当前用户模型凭据。当前普通UI显示聊天未选择模型，实际翻译需用户已配置可用模型与应用内权限。

原生托盘点击尚未实测通过：电脑操作返回点击缺少坐标几何，未借此为当前资料库重新开放调试。编译、托盘单元检查及独立WebView翻译入口验证不等于托盘交互验证。后续需补这一项，不把它声明为已通过。

视觉复核另有可继续打磨项：中文系统信息的“Memory”沿用通用翻译显示“记忆”，应改成“内存”；桌面系统页截图顶部标题部分被工具栏遮住，应进一步核对滚动/顶部留白。窄屏截图未见横向溢出。此处如实保留后续范围，不声称界面已无问题。

## 验证与证据

证据根：`C:\Users\ax2\Documents\Codex\2026-10-22\clone-git-github-com-ax2-zicode`。

- `work/daily-features-regression-final.log`：27文件316测试通过。类型检查通过。
- `work/daily-features-check-final.log`：前端检查通过，既有警告保留；12个新模块聚焦检查无警告。
- `work/daily-features-i18n-final.log`：3732键无缺失；`daily-features-permissions-passed.log`：62个原生命令权限检查通过。
- `work/daily-features-rust-wiring-final.log`：Cargo check及严格Clippy通过；既有格式漂移保留。原生测试system_information三项、desktop_updates一项、desktop_tray两项通过，详见`outputs/daily-native-*/result.json`。
- `outputs/daily-features-windows.json`：实际Windows独立资料库两阶段验收通过，9项检查、零错误；唯一预期警告为更新清单不可用。真实进程退出重启验证已完成，不以模拟Host替代。
- `outputs/daily-features-hardware-reference.json`：独立硬件参照；`daily-features-data-before.json`与`daily-features-data-after.json`：当前六篇笔记及笔记本元数据一致。
- `outputs/daily-features-current-launch.json`：安装启动证明；`daily-features-normal-state.json`：正常运行、23包启用及9227无监听。
- `outputs/daily-usability-budget-before.json`与`daily-usability-budget-after.json`：复用仓库`target`，没有新建Cargo target或重复完整发布目录。注意不是不存在的`src-tauri/target`。
- 中文截图：`outputs/daily-features-system-zh-desktop.png`、`daily-features-system-zh-narrow.png`；另有笔记标题、更新、翻译、恢复草稿截图。

新功能逻辑独立成模块；原有超过500行的NotesApp、notesStore及原生入口仅做必要接线，符合本批最小修改例外。未修改独立ZiDevTools仓库。

## 已完成清理

本会话的独立QA进程已正常退出。仅删除无消费者、哈希符合证明的临时stage EXE及隔离测试模型配置。只监听回环的合成模型服务通过其本会话nonce正常关闭，session24069已exit0；唯一请求为固定测试文本。保留QA资料、失败/通过日志和截图，不删除共享缓存、历史包或用户资料。当前普通Studio继续运行，不重新启动。

## 方案与后续

详见[笔记同步、小组件与DSH评估](2026-11-04-notes-sync-and-widgets-plan.md)。云同步推荐内置WebDAV、先适配坚果云，逐笔记/附件同步、离线完整副本、冲突双保留、可恢复删除及端到端加密；未连接云端或上传笔记。Windows小组件可做“Studio速记”，打开新笔记/最近笔记；当前仅构思，没有交付系统组件包。

若DSH指DeepSeek Harness，基础聊天接入为中等工作量，保留现有全部AI行为的完整替换为中等偏大。Rust启动/stdio RPC、流式事件、停止与队列、工具审批、模型配置、会话历史、Pi扩展SDK和分发需要适配。独立笔记、Host工具插件和大部分桌面UI可保留，但模型调用集成需回归。建议增加内部运行时适配层，先让DSH作为第二后端完成聊天、真实工具审批、取消及恢复，再决定默认切换；不直接改写Pi旧会话文件。

DSH官方已有`dsh --profile sdk`的stdio JSON-RPC入口，但仍标明开发者预览及兼容性变更；不能因传输类似即认为协议兼容。[SDK入口](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/sdk-app/README.md)、[项目状态](https://github.com/deepseek-ai/deepseek-harness)。

持续优化目标仍在推进，未宣告全项目或全部源工具完成；不创建自动任务。下一轮按用户优先级推进，避免重复构建和重复已经通过的检查。

