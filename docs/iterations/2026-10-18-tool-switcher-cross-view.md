# Stage：跨应用工作区切换入口

日期：2026-10-18。目标：让工作区快捷键在工具中心之外的应用视图也可用，并在隔离 Windows Debug 中核对真实工作区选择。仅修改 Studio，保留现有 Debug/Release 和构建缓存，不启用 JSON 对象插件。

## 发现与修改

工具中心有独立的可见 `ToolWorkspacePicker`；笔记等应用沿用共享侧栏的工作区按钮。侧栏折叠时，快捷键原先点击了画面外的按钮，菜单虽然更新 DOM，却看不到。现在 `openVisibleWorkspaceSwitcher` 在使用共享侧栏入口前先展开侧栏，随后打开菜单；工具中心仍优先使用自身 picker。修正 `workspace-actions.js` 注释，明确显式 `--tools-only` 选择项目会打开独立窗口，AI 会话可导航当前窗口。

## 验证

- `bun run vitest run public/native/layout-contract.test.js --reporter=dot`：68/68；`bun run check`、`node --check public/native/app.js` 通过。既有检查输出仍为 147 warnings、10 infos、1 项设计 warning。
- 沿用现有 Windows Debug EXE 和隔离 `--tools-only` profile，1442×931 浅色窗口。笔记视图先折叠共享侧栏，按 Ctrl+Shift+O 后侧栏和菜单均出现；`system` 与“将文件夹作为工作区打开”在截图及可访问性树可见。
- 通过原生文件夹选择框打开已有 `E:\zicode-studio-desktop` 作为隔离工作区；新窗口标题和路径均为该项目。再在新窗口的菜单选择 `system`，出现目标为隔离 `system` 的新窗口，原项目窗口保留。此为**工具模式的跨工作区新窗口切换**，不是同一 WebView 的 `setTarget` 事件验收。代表性截图存于技术博客同名 Stage 的 `screenshots/`。
- 三个隔离窗口关闭后，按 EXE 路径与 `--isolated-profile` 参数核对并结束唯一验收进程。没有启用插件、调整 `pi.tools.register`、创建 Release 或 ZIP。
- 前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 149,282,816 → 143,323,136 B。预算脚本因低空间建议退出 1，未按固定容量门槛删除缓存。项目 `.zicode` 顶层目录时间戳未见本次变化。

## 遗留问题

AI 会话模式同窗口导航、命令面板已打开时由外部目标切换触发自动关闭、其他插件 View、macOS/Linux、正式签名插件的完整流程均未由本次证据覆盖。DevTools 154 项和 ZiFile 108 项正式全量接受仍为 0/154、0/108；用户决定暂不启用的 JSON 对象插件继续保持禁用。
