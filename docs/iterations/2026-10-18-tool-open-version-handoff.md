# 工具目录跨插件版本定位保护（2026-10-18）

## 目标与发现

目录工具已经携带插件版本，但“打开应用”原先只传插件 ID 和能力 ID。应用切换为异步操作；若插件版本在目录加载后变化，旧能力 ID 可能被发送给新版 View。用户决定暂不启用 JSON 对象插件；本轮只修改 Studio 的通用接力逻辑，不改变插件启用或权限。

## 修改

- `ManualToolDirectory` 将所选工具的版本传入 `ToolCenterApp`，再传给 Studio 外壳。
- 外壳在异步打开应用前后，按插件 ID 查询当前注册表版本，并与所选目录项比较。版本变化时显示已有的“工具已变化”提示，停止 `openTool`；不会调用能力。
- 保留上一轮的场景、工作区、运行会话核对。同步重建 `public/native/react/tool-center.js`，使原生外壳使用新回调签名；没有改动布局。

## 验证

Windows 本地 `bun run build:react` 成功；`bun run typecheck` 成功；`bun run check` 成功（既有 147 条 lint warning、10 条 info、一个设计提示）；`ToolCenterApp.test.tsx` 与 `plugin-shell.test.js` 共 40/40 通过。回归覆盖目录项版本透传、版本变化后不发 View 定位也不执行能力，以及跨工作区旧选择拒绝。初次外壳回归失败是生成的 React 资源仍用旧回调签名；重建后重新运行通过。`git diff --check` 退出 0，仅有 Windows 换行提示。

本轮没有重新构建或替换运行中的 Debug EXE，没有原生界面截图；该代码尚未在真实桌面窗口验收。原生 Inspect 0.1.2 安装仍等待先前的即时确认。JSON 对象插件继续禁用，ZiDevTools 全工具和 ZiFile 接受数均未改变。

前后只读预算均报告 `UnknownEntries=0`，`target=30,036,693,723 B`、`.cache/task-scratch=1,411,796,787 B` 未变；E 盘空闲 `8,193,622,016 → 8,138,973,184 B`，卷空闲差额不能归因于本轮代码生成。预算脚本因既有容量及空闲保留线退出 1，未删除缓存或运行目录。
