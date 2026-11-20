# Windows 笔记保存冲突恢复

2026-11-04，本轮持续优化聚焦笔记编辑可靠性。前一轮已交付单默认空间；本轮完成可复现问题修复、最终构建、本机真实验收及当前安装更新。持续优化目标仍保持进行。

## 问题与结果

笔记有未保存编辑且服务端版本已变化时，原“刷新”调用正常选中笔记流程，该流程先保存旧版本，冲突后仍保持 dirty，因而一直无法请求最新内容。新增回归在原实现上失败：期望版本2，实际仍为版本1，失败日志保留。

冲突提示现在提供“加载已保存版本”：等待现有保存结束，读取最新笔记，将当前标题、图标、正文、标签及原始版本先持久保存为独立的加密本地草稿，再替换编辑器。后续成功保存不会清除这个独立草稿。可以在“本地笔记恢复”中另存为新笔记。读取或草稿持久化失败时，编辑内容继续留在编辑器，按钮可重试。操作期间阻止并发编辑与保存，重复点击只执行一次。

本地恢复仍只属于当前桌面资料库，不作为备份或跨设备同步。没有处理旧数据迁移，没有创建定时任务。

## 实现范围

- 新增 `frontend/src/features/notes/editor-conflict.ts`，集中处理冲突恢复和异步范围校验。
- `editor-save.ts` 暴露等待已有保存的内部能力，保留原来的同步排队检查，避免同一事件轮连续保存形成并发请求。
- 大文件例外：`notesStore.ts` 仅新增动作接线、类型与冲突文案本地化；`NotesApp.tsx` 仅替换冲突按钮；`draft-recovery.ts` 新增小型独立草稿持久化接线。没有在这些文件内展开整个冲突流程。
- 新增 `editor-conflict.test.tsx` 九项回归，包括持久保留、失败重试、重复点击、并发保存、编辑器切换、响应身份错误及另存副本。

## 检查

- 最终笔记与网关回归：6文件、180项通过。日志 `work/notes-conflict-regression-final.log`。
- 前端检查、类型检查通过；中文3703键、缺失0。前端检查保留既有169项警告、13项提示和1项生成代码设计提示，本轮新增测试中的四处非空断言提示已清理；新模块与新测试无此类提示，没有宣称全仓零警告。最终检查日志为 `work/notes-conflict-delivery-check.log`、`notes-conflict-delivery-typecheck.log`，九项冲突回归整理后重新通过（`notes-conflict-delivery-test.log`）；仅测试整理不改变已安装产物。
- `bun run build:local` 复用 target/debug。首次构建后补充保存顺序修正，最终重新构建；日志 `work/notes-conflict-build-final.log` 完成1m58s。
- 最终 EXE SHA-256：`E2C055A94C07B8E58886C093BFC1E434204F9D24B863B900E49FDE65D29B4917`。

## 实际 Windows QA

环境为真实 Windows Studio WebView2，桌面和360px客户区。Browser 插件/skill未提供，沿用现有原生 WebView CDP 通道；无新增浏览器依赖。测试笔记只在独立资料库创建，没有向用户资料库加入测试笔记。

流程：选中真实笔记 → 通过真实 Host 在另一位置更新版本 → 在 React 编辑器输入 → 保存触发真实版本冲突 → 窄窗口中文按钮加载保存版本 → 继续编辑成功保存 → 重载真实页面 → 从 IndexedDB 恢复独立草稿并另存 → 分别读取原笔记和副本核对正文。

| 项目 | 结果 |
| --- | --- |
| 页面身份、有效内容 | 标题 ZiCode Studio Desktop，有实际笔记内容 |
| 错误覆盖层 | 无 |
| 控制台与异常 | 本轮记录 warning/error/exception 0 |
| 交互 | 真实冲突、加载、继续保存、跨页面重载恢复、另存均通过 |
| 窄窗口 | 中文360px按钮可点击，无文档横向溢出 |
| 截图 | 已查看窄窗口冲突及桌面加载后的恢复面板 |

证据：`outputs/notes-conflict-windows.json`、`notes-conflict-before-reload.png`、`notes-conflict-narrow-conflict.png`、`notes-conflict-after-reload.png`、`notes-conflict-recovered-copy.png`、`notes-conflict-narrow.png`。

首次实际验证中，自动化 Ctrl+A 未选中文本而是追加，预期正文断言失败；修正为对真实文本框选中内容后使用 CDP Input.insertText，未更改产品或放宽断言。原失败保留于 `work/notes-conflict-windows-first.log`、`outputs/notes-conflict-windows-failed-input.json`。关键脚本：`work/notes-conflict-windows.mjs`、`work/studio-cdp.mjs`，使用 Runtime.evaluate、Input、Page.captureScreenshot 与真实 Host 笔记接口。

## 当前安装

已更新 `D:/work/apps/zicode-studio-desktop/zicode-studio-desktop.exe`，只核对并正常退出本会话启动的验证进程72940和原进程3512，没有强制结束用户进程。新进程57836普通启动，固定资料库 `D:/work/local-state/zicode-studio-desktop`，单进程、响应正常、窗口可见、托盘图标已注册、9227调试端口关闭、23个 DevTools 包保持启用。逐篇读取现有6篇笔记及笔记本元数据，升级前后内容摘要一致。

当前运行证据：`outputs/notes-conflict-normal-launch.json`、`notes-conflict-normal-final.json`、`notes-conflict-data-before.json`、`notes-conflict-data-after.json`。临时验证 EXE 已移除，独立资料库与失败证据保留。存储前后只读扫描：`outputs/notes-usability-budget-before-20261104.json`、`notes-conflict-budget-after.json`。

本轮验证范围为当前 Windows；其他操作系统和跨设备恢复未验证。后续继续推进日常可用性与既有全工具导入范围。

以上 work/outputs 路径均相对证据目录 `C:/Users/ax2/Documents/Codex/2026-10-22/clone-git-github-com-ax2-zicode`。
