# 接收端测试签名包的原生界面验收尝试（2026-10-17）

## 目标与输入

在不触及日常 Studio 配置的前提下，复核接收端测试签名包的原生界面安装、目录发现、按需加载、执行和结果展示。输入为 `.cache/task-scratch/signed-candidate-OEOMcY/first.zicode-plugin`；本轮重算 SHA-256 为 `99aca06d74fe5566866a0a3c314d1b0db310faf1a6441c86398d3ab3bd9efc0b`，与既有包外测试收据一致。该包标记 `testOnly=true`，发布密钥为临时接收端测试密钥，不是 DevTools 的正式交付。

## 实际步骤与结果

- 启动当前 `target/debug/zicode-studio-desktop.exe`，显式指定新的 `.cache/task-scratch/signed-native-acceptance-20261017/profile` 隔离配置。进程 PID 41052；日常已安装 Studio 使用另一 EXE、另一 PID。
- Computer Use 在实际 Debug 原生窗口读到独立工作区路径、工具中心和插件管理。插件管理显示“安装签名插件包”入口、已签名筛选、搜索框，初始 19/19 为内置插件。实际截图已人工查看，界面没有明显遮挡或文字截断；本轮没有产品界面改动，未另存截图。
- 点击签名包入口后出现 Windows 文件选择框，文件类型限定 `*.zicode-plugin`。通过控件值设置，文件名框显示上述包的绝对路径。然而 Computer Use 对此系统对话框的“打开”、焦点快捷键和 Esc 输入均未生效；文件选择框持续存在。未进入发布者指纹确认，更没有安装、启用、目录加载或执行。此处是本次原生验收的实际停止点，不是插件运行失败的证据。
- 最后核对隔离进程及 Pi/WebView 子进程归属后，只终止 PID 41052；采样的四个进程均已退出。隔离目录的 `data/plugins/signed` 为空。日常 Studio 进程未操作。
- 只读检查 DevTools 当前目录仍无 `.zicode-plugin` 容器；提供方原会话仍在推进目录元数据。154 项工具完整接受保持 0/154。

## 磁盘与遗留

本次隔离配置含 425 文件、79,033,682 逻辑字节；其中 `profile/data/webview` 可再生缓存 407 文件、78,774,793 字节。已核对路径位于本任务 scratch、无 reparse point、测试进程已退出。对这个精确 WebView 缓存目录的原生 PowerShell 清理再次被自动审批以 `blocked by policy` 拒绝；没有改用其他工具重试，实际释放 0 字节。手工候选：

`E:\zicode-studio-desktop\.cache\task-scratch\signed-native-acceptance-20261017\profile\data\webview`

后置只读空间扫描完整、未知项 0：target 29,420,789,673 B；task-scratch 932,850,915 B；E 盘可用 43,020,910,592 B。task-scratch 比上阶段扫描增加 79,033,682 B，恰为本次隔离目录逻辑大小；卷空闲量变化不能归因于单一进程。

如需继续原生安装验收，先解决 Windows 文件选择框的操作障碍；Computer Use 技能还要求通过 Windows 界面安装软件前进行即时确认。正式 DevTools 包、真实原生工具链路、其他平台以及 ZiFile 完整接入均未验收。
