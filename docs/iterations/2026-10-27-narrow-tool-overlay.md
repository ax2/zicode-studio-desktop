# 窄窗口工具遮罩续修

目标：当前 Windows Studio 的窄窗口工具页不被残留侧栏遮罩拦截；保留固定目录、笔记和其他原有数据。不创建定时任务。

## 问题与修复

- 首页快捷工具、底部工具导航、从笔记侧栏切换到工具三条常用路径，本轮修改前在实际 Studio 中已通过。未把它们重新描述为本轮新发现的失败。
- 仍存在生命周期同步缺口：侧栏通过 hidden/style 或 collapsed 状态改变时，旧代码只依赖导航或缩放事件清理遮罩。实际 WebView 中用一次明确的故障注入（模拟导航事件之后才隐藏侧栏）复现了侧栏 display:none、遮罩 display:block、aria-hidden=false 的残留。此注入不是声称实际用户操作必然触发同一路径。
- `public/ui/sidebar-toggle.js` 观察侧栏自身的 hidden/style/class 属性，关闭无效抽屉，同步按钮、辅助状态及返回历史；销毁时断开观察。保留桌面侧栏偏好，避免重复 class 写入导致观察循环。
- 遮罩仅在窄窗且相邻侧栏确实未 hidden、未 collapsed 时显示；工具目录页明确隐藏遮罩。普通桌面不会因残留 visible 类显示移动遮罩。
- 重新生成当前运行所使用的 `public/style.bundle.css`。本轮不改 Rust，不替换 EXE，不改 Pi 或插件包。
- 大文件例外：`public/native/mobile.css` 只补 4 行局部显示条件，继续由既有移动壳样式拥有；没有增加新的业务逻辑。其余逻辑位于原来 150 行以内的独立侧栏控制器。

## 验证

| 检查 | 结果 |
| --- | --- |
| 新回归用例先失败 | 延迟隐藏与外部收起两项失败，旧 12 项通过 |
| 侧栏、返回历史、插件导航、布局回归 | 4 文件 124 项通过 |
| 前端检查/设计检查 | 退出 0；既有 159 warnings、10 infos 及终端生成样式 advisory 保留 |
| 实际页面身份/非空/框架异常遮罩 | 当前 Windows WebView2、ZiCode Studio Desktop、工具表单实际显示，无框架异常遮罩 |
| 修复后生命周期故障注入 | 遮罩隐藏且 aria-hidden=true，恢复侧栏后可重新打开 |
| 工具入口/响应式 | 首页快捷工具、底部工具入口、从已展开笔记抽屉进入工具；480×640、640×600、768×600、769×600、1000×700 再回 640×600 均无遮罩，真实鼠标可聚焦输入 |
| 真实执行 | Base64 经实际 Host/Worker 返回预期值，原输入保留，测试输入随后仅清理自身内容 |
| 当前资源 | 实际 Host 提供的 sidebar-toggle.js 与 style.bundle.css SHA-256 与本地修复文件逐一相同 |
| 控制台边界 | 自动化期间没有 Runtime.exceptionThrown；未宣称所有历史或第三方警告为零 |

Browser 插件不可用，沿用现有本机 WebView2 CDP 自动化；测试改变客户区视口，不声称调整 OS 窗框或验证其他平台。截图人工检查确认工具输入与执行按钮未被遮罩覆盖。没有触发模型或外部服务。

证据保存在本会话工作目录 `C:/Users/ax2/Documents/Codex/2026-10-22/clone-git-github-com-ax2-zicode`：

- `outputs/narrow-overlay-existing-after.json`：本轮修改前常用三入口实测。
- `outputs/narrow-overlay-live-before.json`：旧页面生命周期故障注入失败证据。
- `outputs/narrow-overlay-live-after.json`、`outputs/narrow-overlay-verified.png`：修复后实际页面、资源哈希、响应式与工具执行。
- `work/narrow-overlay-red.log`、`work/narrow-overlay-tests.log`、`work/narrow-overlay-check.log`：回归与检查。
- `outputs/narrow-overlay-data-before.json`、`outputs/narrow-overlay-data-final.json`：26 个原有文件 SHA 全部相同，工作区登记、固定目录选择文件不变，SQLite integrity=ok。
- `outputs/narrow-overlay-normal-final.json`：恢复普通启动、调试接口关闭、两篇原笔记从真实 snapshot.notes 可读及全部既有 DevTools 仍启用。
- `outputs/narrow-overlay-budget-before.json`、`outputs/narrow-overlay-budget-after.json`：预算扫描；保留既有缓存。

数据固定位置仍为 `D:/work/local-state/zicode-studio-desktop`。没有迁移、重建、覆盖或还原任何原笔记来使验证通过，没有创建定时任务。该局部修复不代表全部工具集成完成。

## 2026-10-30 当前 Windows 交付

用户保存并退出后，以原安装文件的独立备份保留旧版，安装已验证的新版；固定资料库路径不变。当前 Windows Studio WebView2 从笔记抽屉切换工具、首页快捷入口、360–1000 像素客户区、侧栏延迟隐藏故障注入、鼠标输入以及真实 Base64 Host/Worker 执行均通过；资源哈希与修复文件一致。测试采用视口模拟，不代表系统窗口框尺寸测试。结果见会话工作目录 `outputs/narrow-overlay-delivery-20261030-after.json`。

文件摘要候选02已安装并启用，当前资料库用两份测试文件确认双摘要、顺序和取消；原文件未修改。普通启动后22包启用，调试端口关闭。固定资料库3篇笔记可读取、32个原有文件与已有备份保持，数据库完整性正常。未创建定时任务。文件摘要仍只覆盖1–4项、32 MiB以内的快照，64文件、原文件身份检查、进度和报告接力未完成，详见当前插件账本。
