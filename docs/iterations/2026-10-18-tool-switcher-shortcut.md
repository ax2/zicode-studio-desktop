# Stage：命令面板到可见工作区切换器

日期：2026-10-18。范围仅 Studio；沿用隔离 Windows Debug 与既有构建，不安装或启用插件，不更改 Pi 权限，也不发布版本。

## 发现与修改

在工具中心打开具体工具命令面板后按 Ctrl+Shift+O，旧逻辑直接点击聊天侧栏的 `workspace-switcher-btn`。命令面板遮罩盖过侧栏菜单，工具中心也有自己独立的 `ToolWorkspacePicker`，因此原生窗口没有显示可操作的切换菜单。

快捷键现在先关闭命令面板，再打开当前可见的工作区切换器。工具中心优先使用自身的 picker，聊天侧栏沿用原按钮。命令面板里的“切换工作区”命令也复用相同入口，并延迟到面板点击事件结束后执行，以免被外部点击监听器立即关闭。已经展开的菜单不会被快捷键再次切换成关闭状态。

## 验证证据

- `bunx vitest run public/native/layout-contract.test.js --reporter=dot`：68/68；`bun run check`、`node --check public/native/app.js` 退出 0。项目检查保留原有 147 warnings、10 infos、1 项设计 warning。
- 重新启动现有 Windows Debug EXE，隔离 `--tools-only` 配置在 1442×931 浅色窗口打开命令面板，再按 Ctrl+Shift+O；面板关闭，工具中心右上角工作区列表显示 `system` 和“将文件夹作为工作区打开”。实际截图见技术博客同名 Stage 的 `screenshots/native-switcher-from-palette-1442x931.jpg`。
- 隔离进程按可执行文件路径和 profile 核对后结束。JSON 对象插件遵照用户“暂不启用”，未更改启用状态或 `pi.tools.register`。
- 前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 179,515,392 → 150,605,824 B。脚本仅因低空间建议退出 1；未清理有用构建缓存。

## 限制与后续

此轮验证了菜单可见与可操作入口，尚未实际切换工作区，故前一 Stage 的“目标变化自动关闭旧面板”原生验收仍待。工具中心以外的每个插件 View、其他系统、正式签名插件与 DevTools 154 项/ZiFile 108 项完整接受仍待；累计正式全量接受分别为 0/154 和 0/108。没有生成 ZIP、Release 或新版本号。
