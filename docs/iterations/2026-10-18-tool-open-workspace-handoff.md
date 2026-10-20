# 工具目录切换工作区时的定位接力保护（2026-10-18）

## 目标与发现

Studio 的工具中心从具体工具进入插件应用时，会先异步切换应用，再调用 View Host 的 `openTool`。原回调在切换后直接读取最新 `getTarget()`，如果目录项来自工作区 A，而切换等待期间目标变成 B，旧工具 ID 可能被作为 B 的新定位意图发送。View Host 自身的目标快照始于 `openTool` 调用，无法推断该工具选择实际源自 A。此问题与用户选择暂不启用的 JSON 对象插件无关，不需要更改其设置。

## 修改与验证

`public/native/plugins/plugin-shell.js` 在呈现工具目录时捕获 `resourceViewTarget`（实例、会话、工作区、场景），在进入应用前及异步切换后各比较一次。上下文变化时显示已有“工具已变化，请重新加载详情”提示并停止发送定位；不调用工具能力。`public/native/plugins/plugin-shell.test.js` 新增工作区 A 选择、切换等待中进入 B 的回归，确认应用普通导航可能完成，但 View Host 的 `openTool` 和能力执行均为 0。

Windows 本地 `plugin-shell.test.js` 33/33，通过 `bun run check`（仓库既有 147 lint warning、10 info 和一个设计提示，不影响退出码）。修改不改变页面布局；当前运行中的隔离 Debug EXE 是修改前构建，原生窗口未验证这项新边界。前后预算 `UnknownEntries=0`、`target=30,036,693,723 B`、`.cache/task-scratch=1,411,796,787 B` 不变；E 盘空闲 `8,190,005,248 → 8,192,933,888 B`，卷差额未归因于测试。预算脚本因既有缓存/空闲保留线退出 1，未清理文件。

## 遗留

新边界尚需在后续更新的本地 Debug EXE 中重现工作区切换竞态；真实 Inspect 0.1.2 候选仍停在原生隔离安装确认前，签名包和非 Windows 实机验收未完成。ZiDevTools 全部工具与 ZiFile 接入矩阵均不因本轮守卫变为完整接受。
