# Explorer 实体多选菜单与 Studio 交接（2026-10-17）

## 目标与现状

此前仅验证 `--open-selection 2` 参数交接及 COM 选择模型测试；Windows 11 文件资源管理器的实体多选右键菜单尚未完成点击到 Studio 窗口的整段验收。本轮只在 Studio 项目内验证现有实现，未修改 ZiFile 或 DevTools。

## 实体操作与证据

当前 0.4.2 Debug EXE 的只读 `--explorer-menu-status` 返回当前用户传统菜单 `installed=5/total=5/stale=0`、`modernWindows11Menu=false`。

在 Windows 11 Explorer 的 `E:\zicode-studio-desktop` 同时选择普通文件 `AGENTS.md` 和 `biome.json`。进入“显示更多选项”后，经典菜单出现“在 Studio 中选择文件工具”；点击后进程命令行为 `--open-selection 2`，携带两个文件的 Windows verbatim 路径。Studio 打开工具专用会话，显示两个基本名及“尚未提供文件内容”，并只筛选声明至少支持 2 个输入文件的已启用、获准工具；当前结果 0 项，没有自动打开或执行工具。原生 Studio 页面是 1442×931 深色；菜单窗口是 1253×835 深色。

同目录从 `AGENTS.md` 连续选择到 `LICENSE` 的 5 个普通文件后，再打开经典菜单，未出现 Studio 多选入口。这个实体负例证明当前 Shell 菜单在超出 2–4 项范围时隐藏；只覆盖本机当前注册的 Windows 11 传统菜单。

三张已目视检查的截图保存在技术博客 `screenshots/explorer-multiselect-2026-10-17/`：双文件经典菜单（116,025 B）、Studio 双文件意图页面（83,696 B）、五文件无 Studio 项的经典菜单（119,181 B）。本轮新开的 Explorer 窗口已关闭，Studio 进程 PID 58580 经 EXE 路径与 `--open-selection 2` 命令核对后停止，未留测试进程。

## 范围、空间与遗留

这验证的是 Explorer → Studio 的**选择意图交接**，没有资源内容授权、ZiFile 插件、归档创建或写入。当前无匹配的多文件提供方插件，ZiFile 18×6 格完整接受仍 0/108，DevTools 完整接受仍 0/154。现代 Windows 11 一级菜单、不同目录/链接/盘符实体边界、真实 ZiFile 包与 macOS/Linux 接入仍待验。

没有构建或改动应用代码、版本、Release/ZIP。结束时只读空间扫描未知项 0：`target` 30,010,795,065 B / 75,457 文件，非 scratch `.cache` 355,458,670 B，task scratch 1,137,934,545 B；E 盘可用 15,854,497,792 B，仍低于 20 GiB 提示线。截图写在技术博客档案而非项目 target；本轮未清理或绕过此前被拒的隔离 profile。
