# Windows 系统信息、温度与托盘交付

2026-11-04。硬件功能已安装到当前固定资料库；后续翻译修复不改变本批原生硬件行为。未发布、未改应用版本、未创建定时任务。

## 已交付内容

- 硬件的Memory使用独立翻译键，显示“内存”；AI记忆的用词保持原意。
- 系统信息页显示CPU使用率、逻辑处理器、Windows报告频率、内存和固定磁盘。CPU、温度、频率用最近60秒的实际采样趋势；内存用环图，磁盘用容量条。缺失采样和长暂停断线，不补成0°C或伪造连续历史。
- 桌面四张概览卡片为两列，窄窗口单列，磁盘按可用宽度排列。修复桌面设置/帮助页清零通用顶部留白，导致标题被工具栏遮挡的问题。
- 托盘加入持续更新的CPU/内存/温度摘要及CPU、温度、频率、内存、磁盘详情；菜单可导航到系统信息。页面与托盘共用原生采样缓存，托盘每3秒更新，关闭前台页也可采样，不是OS计划任务。

## 温度来源与授权

本机已有WinGet安装的LibreHardwareMonitor 0.9.6（3d331e3370efb858411f19511373eff65a218701）及PawnIO 2.2.0.0。GUI当时没有运行。普通权限直接调用库返回无效的0°C；同库一次性管理员探测读到53.5000076°C，证明硬件路径可用，原先“不可用”源于权限与接入方式。

Studio内置自有小采集器，复用本机已有库和驱动，只启用CPU传感器。用户明确点击“启用温度监测”后才请求Windows授权，主程序保持普通权限。不安装驱动、服务或开机任务，不复制厂商DLL。采集器通过单向本机命名管道传回数据，校验库哈希、父进程身份及管道客户端PID；停止、断开管道或父进程退出时关闭读取器并退出。只接收合理范围内的真实CPU传感器，优先Package/Tctl/Tdie，不把ACPI区或无效0值标成CPU温度。

第一次执行启用测试时，自动审批因缺少这次具体管理员授权拒绝了脚本，脚本未运行。已向用户解释，用户明确回复“允许本次启用并验证温度采集”，随后正常验证，没有绕过审查或Windows授权。此授权不表示允许安装新驱动、提权主程序或自动启动采集。

官方提供可嵌入库与源码：[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)、[0.9.6 Computer实现](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/v0.9.6/LibreHardwareMonitorLib/Hardware/Computer.cs)。项目采用MPL-2.0；当前集成使用本机已有安装，不重新分发该库。

## 交付与实际验收

硬件最终候选SHA256：`8CF58F6DA7ECC1BA31CF3FCE4A945B6CD431342026D5E171E549167830C3E484`。安装位置`D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe`，固定资料库`D:\work\local-state\zicode-studio-desktop`。硬件交付时启动证明为`outputs/hardware-info-current-launch.json`，PID73456、2026-11-04T03:34:12.0330747Z；此为历史证明，后续关闭进程必须核对最新交付证明，不能仅依赖PID。

证据根：`C:\Users\ax2\Documents\Codex\2026-10-22\clone-git-github-com-ax2-zicode`。

- `outputs/hardware-info-windows.json`：实际Windows WebView2最终候选通过，零页面错误、零控制台警告。1280/900/769/768/360五种宽度、六个主题、中英文、刷新、帮助标题、真实Tauri导航事件及翻译快捷键均检查。Browser插件缺席，使用已有Playwright连接独立测试资料库。
- 同一最终候选实际读到48.3750076、47.0000076、48.7500076°C；前候选在不同负载下读到56.875/57.375/59.250°C。温度趋势真实变化。点击停止后状态idle、当前读数null，外部进程检查无遗留采集器。
- `outputs/hardware-info-native-tests/result.json`：普通Windows权限执行8项原生测试通过；`work/hardware-info-tests.log`：23项前端回归通过。类型、设计、国际化及64个命令权限检查通过。`work/hardware-info-rust-final.log`严格原生检查通过；既有格式漂移作为advisory保留，没有全仓格式化。
- `outputs/hardware-info-data-before.json`与`hardware-info-data-after.json`：六篇现有笔记及笔记本元数据哈希全部一致。
- `outputs/hardware-info-normal-state.json`：正确安装SHA、23个DevTools包和翻译启用、正常启动、9227无监听、临时stage已移除、没有遗留采集器。当前用户资料库未自动启用管理员采集；应通过明确启用动作授权。
- `outputs/hardware-info-budget-after.json`：同一根`target`约9.81GB，D盘可用约391GB，无未知条目；未创建新Cargo target或重复完整发布目录。

最终截图：`outputs/hardware-info-desktop.png`、`hardware-info-dark.png`、`hardware-info-narrow.png`。最初一张窄屏截图在侧栏动画中截取，后续700ms稳定检查确认侧栏已完全离屏，标题左右中点无遮挡；最终截图加入等待，保留`hardware-info-settled.json`与`hardware-info-narrow-settled.png`作为解释证据。

## 验收边界

原生托盘右键的鼠标交互没有单独完成验收，不能用格式化单元测试或Tauri事件注入替代该声明。对当前普通程序进一步电脑操作时，用户按Esc停止了Computer Use；此后不继续控制窗口。菜单实现、真实采样及导航事件的证据与鼠标交互边界分别记录。

频率仍明确为Windows报告值，不宣称是有效每核时钟；温度需已有兼容库和驱动及明确授权。本批不代表ZiDevTools全部源工具完成导入，不增加源工具“完整通过”数量。

新功能逻辑位于独立采集、托盘、图表和控制模块；既有超过500行的入口只做必要导入/接线。Pi保持不变，未调用付费模型，未上传笔记，未改变云同步或Windows系统小组件仍为方案的状态。
