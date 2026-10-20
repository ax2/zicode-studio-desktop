# Stage：Explorer 多文件入口的原生参数交接复核

日期：2026-10-17。仅修改 Studio 文档和验收记录；未修改 ZiFile/DevTools。

## 目标与当前实现

验证 `--open-selection` 的同实例交接能否在当前 Debug EXE 上形成工具专用窗口和多文件目录过滤，而不把原有单元测试当成实体资源管理器右键验收。当前用户菜单只注册一个 Studio 选择工具入口，不按插件数量增加图标或菜单项。

## 本机证据

- 当前 Debug EXE SHA-256 为 `48EE0F162EAC5986E758D2A6A916138ADEDDD6A2353C83469D7D4F90C04F953E`；原隔离实例 PID 56476，参数含专用 `--isolated-profile` 与 `--tools-only`。只读 `--explorer-menu-status` 报传统菜单 5/5、stale 0、现代一级菜单 false。
- 验证 `E:\zicode-studio-desktop\AGENTS.md` 与 `README.md` 均为同目录普通文件。第二个同 EXE 进程使用相同隔离配置传入 `--open-selection 2` 和这两个绝对路径后退出；原进程保留，并出现标题为“ZiCode Studio Desktop · 工具 · zicode-studio-desktop”的新窗口。
- 实际 Windows WebView2 窗口显示：已选择 `AGENTS.md, README.md`，尚未提供文件内容；只显示已启用且支持至少 2 个输入文件的工具；结果为 0 个工具/没有匹配的工具。当前隔离配置只有 Inspect 0.1.1 的 8 个单输入能力，故 0 项是预期的过滤结果。没有点击工具、读取内容、保存或写入。
- 测试前后只读磁盘扫描：`target` 均为 29,993,014,792 B；task-scratch 1,031,752,454 → 1,031,752,635 B；非 scratch `.cache` 355,458,670 B、site 29,644,753 B 均不变，未知项 0。E 盘可用 30,291,456,000 → 30,289,981,440 B，卷变化包含其他进程，不能归因于此操作。保留当前 Debug 与隔离配置。

## 尚未验收

实体 Explorer 多选右键的 COM 激活、菜单点击、DLL 到第二进程参数传递仍未在此次复核中执行；Windows Explorer 窗口捕获连续两次返回 `encode latest capture frame failed: window crop is outside captured monitor`，已按 Computer Use 技能停止该目标的自动化输入，未通过其他 Windows UI 自动化绕行。当前 0 项目录也不能验证真实多文件插件的执行、资源授权或 ZiFile 108 格矩阵。现代 Windows 11 一级菜单、其他操作系统、安装/卸载生命周期仍待独立验收。
