# 2026-11-16 当前候选文件另存复验

关联 #30，P1 / v0.6.0。未修改产品源码、共享构建产物或个人资料。

使用当前自有 Windows 候选 EXE `72E9DEB951B8B6B45281858003197E6207D29D65C8A13690B48DDD6FC03056BB`、入口资源清单 `39ad3371c1ad05892da51644eeb8bfaf5443f9872746f25b68809ea8b77c19ce`，复用仅含合成验收数据的 `directory-live-profile`。本次 phase 为 `export13`，自有 PID 83224。

已实际完成：从启动器打开文件校验，明确共享合成文件，真实 WASI 校验后再调用独立 checksum-manifest 插件生成 SHA256SUMS，随后点击“保存生成的清单为…”。Windows 原生“另存为”对话框已出现；观测到默认文件名 result.txt、Text (*.txt) 过滤器及保存/取消控件。

合成输入 `Studio synthetic export 中A\n` 的 SHA-256 为 `fbd4523d7a2044246fcd937bc9fabd7439c23cb09d89775ad8402df050821e6e`，清单对应文件名为 `studio-export-fixture.txt`。

未通过：Computer Use 对该自有对话框的首次取消点击因无法激活窗口失败，重新枚举窗口并尝试激活仍失败。脚本随后确认保存按钮尚未恢复，真实取消/选择路径/二次确认/完整文件写入均不能算通过。本次没有选择任何外部目标，也未提交保存。另有一次沙箱内 Node 连接本机 CDP 报 EACCES；已授权的独立 Node 命令连接成功，这与插件功能失败不同。两种限制都保留，不使用历史版本的另存验证替代本次结果。

测试程序按 EXE 路径、SHA、PID 与启动时间核对后正常退出，没有强制结束、没有结束其他实例。退出后 WebView2 日志含 `Failed to unregister class Chrome_WidgetWin_0. Error = 1412`，保留日志，不能声称整个生命周期无错误。脚本观察期间页面异常及 console 警告/错误为空，范围仅限已连接观察时段。

证据位于本会话工作台 `outputs/studio-tool-directory-export13-*`，其中 `acceptance.json` 的 passed=false；测试脚本 `work/studio-launcher/export-native-qa.mjs`。取消后检查的失败截图保留。前后只读存储审计分别为 `studio-export-storage-before.json` / `studio-export-storage-after.json`，无清理。

发行集成注意：#30 的 quickTools 目录、tool-launcher.js 和 #34 translation-shortcuts.js 当前仍有未跟踪源码，不能只从既有 main 打包。保留并行修改，选定正式 v0.6.0 提交时核对源码和导出资源。视觉模块另按 `.cache/task-scratch/visual-generation-navigation/v060-visual-integration-wiring.json` 核对 171 个专属文件与 21 个共享接线；其验证产物不能被旧共享视觉 JS 替换。本轮不暂存、提交或发布。

后续仍须补当前候选文件另存的实际取消/确认/完整内容验证，并在正式 Windows 候选复验启动器、托盘、最近和数据保留。#34 中译英质量由翻译会话继续复测。保持 #30 开发中及原有未完成验收项。
