# QA 脚本地图（qa:full 一键回归）

> 维护说明：本文档随 `scripts/qa-full.mjs` 的脚本清单同步更新。新增闭环
> 脚本时请补上一条记录（用途 / 视口 / 数据卫生约定），并把脚本名加入
> `qa-full.mjs` 的 `scripts` 数组。

## 一条命令跑全套

```bash
bun run qa:full                 # 自动使用第一个工作区（如 agent-inbox）
ZICODE_WORKSPACE=<folder> bun run qa:full
QA_ONLY=qa-task-flow bun run qa:full   # 只跑单个脚本（也支持 --only=<name>）
VIEWPORT=390x844 bun run qa:full        # 整套电池在移动视口下运行
```

每个脚本都接受 `<workspaceId | 项目路径 | 工作区文件夹名> [sessionId]`；
文件夹名会先经 `/v2/resolve-workspace` 解析成稳定 UUID，会话缺省时自动
发现当前工作区最近会话。应用必须运行在 `http://127.0.0.1:57620`
（可用 `ZICODE_HOST` 覆盖）。

## qa:full 包含的脚本

| 脚本 | 检查内容 | 视口 | 数据写入 | 数据卫生 |
| --- | --- | --- | --- | --- |
| `visual-qa.mjs` | 布局诊断：启动失败、横向溢出、顶部遮挡、空态/表单交互快照 | 1440×900 + 390×844 | 各应用表单会真实提交（建任务/自动化/翻译等） | 内置自清理，截图写 `docs/screenshots/` |
| `qa-a11y.mjs` | 无名称可交互元素扫描（按钮/链接/输入） | 桌面 + 移动 | 无 | — |
| `qa-keyboard.mjs` | Tab 焦点顺序、命令面板打开/Esc 关闭、快捷键 | 桌面 + 移动 | 无 | — |
| `qa-onboarding.mjs` | 六个核心应用的主操作入口在双视口渲染、无报错无溢出 | 桌面 + 移动 | 无 | — |
| `qa-composer-model.mjs` | 对话输入区模型选择下拉可打开、有选项、移动端触控尺寸达标 | 桌面（`VIEWPORT` 可覆盖移动） | 无 | — |
| `qa-lan-qr.mjs` | 桌面：「在手机上打开」→ 弹层 → 二维码与配对地址；移动：按钮按设计隐藏（手机是扫码方） | 桌面 + 移动（`VIEWPORT` 可覆盖） | 无 | — |
| `qa-notes-flow.mjs` | 笔记真实闭环：建笔记本/笔记 → 编辑标题/标签/图标 → 自动保存 → 拖拽（桌面）/跳过（移动）→ 清理 | 桌面 + 移动（`VIEWPORT` 可覆盖） | 真实写笔记存储 | 结束清理并断言无 QA 残留 |
| `qa-workspace-trash-ui.mjs` | 回收站区渲染（标题/清空/恢复/彻底删除/倒计时）+ 两条交互链路 | 桌面 + 移动（`VIEWPORT` 可覆盖） | mock Tauri invoke | 不落盘 |
| `qa-task-flow.mjs` | 任务中心真实闭环：新建定时任务 → 编辑 → 删除 | 桌面（`VIEWPORT` 可覆盖移动） | 真实写 `tasks.json` | 前后清理 + 结束兜底，断言文件无 QA 残留 |
| `qa-automation-flow.mjs` | 自动化中心真实闭环：模板预填 → 创建 → 编辑 → 删除 | 桌面（`VIEWPORT` 可覆盖移动） | 真实写 `workflows.json` | 前后清理 + 结束兜底 |
| `qa-backup-flow.mjs` | 设置 → 备份：创建 → 列表 → 恢复 → 删除 | 桌面（`VIEWPORT` 可覆盖移动） | mock Tauri invoke | 不落盘 |
| `qa-articles-flow.mjs` | 文章创作真实闭环：新建 → 保存 → 列表 → 删除（宿主 API 核对基线） | 桌面（`VIEWPORT` 可覆盖移动） | 真实写文章存储 | 删除后核对宿主文章数回到基线 |

> 所有真实闭环脚本均支持 `VIEWPORT=390x844` 在移动视口下运行（实测通过）；
> `VIEWPORT` 会透传给 visual-qa、a11y、keyboard 与全部闭环脚本；onboarding
> 固定跑双视口。`qa:full` 默认只跑桌面视口以控制总时长。

## 发布前验收门禁（release gate）

发布前按顺序跑完以下命令，全部通过才算可发布：

```bash
bun run test          # 单测 167 文件 / 1258 用例 + Tauri 权限 + 子进程策略
bun run typecheck     # 前端 TS 全量类型检查
bun run lint          # Biome（0 error，warning 允许）
bun run check:design  # 设计 token 规范
bun run qa:full       # 桌面视口浏览器电池（约 15 分钟，需运行中的实例）
VIEWPORT=390x844 bun run qa:full   # 移动视口浏览器电池（约 12 分钟）
```

浏览器电池包含：视觉布局（双视口/移动单视口）、无障碍、键盘、新手入口、
六个核心应用的端到端闭环（笔记/任务/自动化/文章/回收站/备份）。每段跑完
会自清理；如某段失败，用 `QA_ONLY=<name>` 单独重跑定位。

## 其他专项脚本（不在 qa:full 内）

- `qa-console-errors.mjs`：16 个应用视图的控制台报错扫描（`VIEWPORT` 可覆盖）。
- `qa-locale.mjs`：英文界面下的中文 UI 串泄漏扫描。
- `qa-data-presence.mjs`：关键数据存在性核对。
- `qa-notes-flow.mjs` / `qa-notes-attachment.mjs`：笔记交互闭环（编辑/标签/图标/自动保存/附件）。
- `qa-session-sidebar.mjs`：会话侧边栏加载/重试/导出。
- `qa-artifacts-flow.mjs`：产物应用闭环。
- `qa-p2p-loopback.mjs`：P2P 回环数据通道。
- `qa-web-capture.mjs` / `qa-docx-import.mjs`：网页剪藏 / DOCX 导入。

## 约定

- **工作区解析**：参数为文件夹名时，先尝试补全
  `%LOCALAPPDATA%\zicode\workspaces\<name>` 再调 `/v2/resolve-workspace`。
- **会话发现**：`/v2/sessions?workspaceId=…` 优先当前工作区会话。
- **Tauri 专用命令**（回收站、备份）在无头浏览器无法真实触发，脚本注入
  mock `__TAURI__.core.invoke` 验证 UI 链路，真实语义由 Rust 单测覆盖。
- **真实数据闭环**（任务/自动化/文章）走真实宿主通道，脚本必须在开头
  防御性清理旧 QA 数据、结束兜底清理，并断言持久化文件回到基线。
- **无痕原则**：任何脚本不得把 QA 产物留在用户数据里；`rmSync` 清理失败
  时按 best-effort 处理并如实输出。
- **Chrome 启动**：统一使用 `--remote-debugging-port=0` +
  `DevToolsActivePort` 文件发现端口 + `--remote-allow-origins=*`。
