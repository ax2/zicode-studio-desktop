# Stage：命令面板跨工作区目标边界

日期：2026-10-18。目标：多项目使用时，已打开的命令面板不在工作区或场景切换后继续展示旧目录。只修改 Studio；不安装、启用或授权任何插件。

## 发现与修改

`setupCommandPalette` 在打开时固定 `sceneId`/`workspaceId`，而 `pluginShell.openManualTool` 只在真正打开工具时复核当前目标。旧面板在目标切换后仍可能显示旧项，即使最终打开被拒绝。现在 `pluginShell.setTarget` 发出无用户数据的 `zicode:tool-target-changed` 事件；已打开的面板对比当前场景/工作区，若不同即关闭且不把焦点恢复到旧页面元素。同一场景、工作区内的会话更新不会关闭面板。Host 的权限与工具修订复核保持原样。

## 验证与限制

- `frontend/src/features/commandPalette/commandPalette.test.tsx` 定向 10/10 通过，其中新增用例确认同目标事件保持面板、工作区变化关闭、重新打开后场景变化关闭。`bun run check` 与 `bun run typecheck` 退出 0；`bun run build:react` 在原目录成功。既有 147 条 lint warning、10 条 info、1 项生成 JS 设计 warning 未变。
- 沿用现有 Windows Debug EXE、隔离 `--tools-only` 配置，在 1442×931 浅色窗口检查命令面板仍能显示 16 项；基线截图归档于技术博客同名 Stage。尝试在面板打开时使用 Ctrl+Shift+O，没有出现可选工作区或发生目标切换，**因此真实原生跨工作区关闭行为尚未验收**。没有把快捷键尝试当作切换成功；隔离进程已精确结束。
- 代码和用例覆盖的是前端范围判断，不证明外部窗口切换、迟到 Pi 调用、其他系统或完整 DevTools/ZiFile 工具接受。DevTools 仍 0/154，ZiFile 0/108。

前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 179,400,704 → 178,880,512 B。脚本仅因低空间建议退出 1；未删除缓存、旧临时配置、运行目录或 EXE。本 Stage 不发布版本，不生成 ZIP。
