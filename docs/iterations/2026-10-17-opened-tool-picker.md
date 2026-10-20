# Stage：已打开工具的紧凑切换

日期：2026-10-17。目标是修复 Inspect 8 项原生复验中观察到的横向工具标签拥挤，同时保持百项插件能力在同一个左侧工具入口中查找。

## 发现和修改

现有工具目录已具备搜索、来源/分类、收藏/最近、每页 40 项与选择后按需加载；每个会话最多同时打开 8 个工具。旧切换条为每项同时显示标题和关闭按钮，真实 1442×931 Windows 截图中 8 项已出现横向滚动。

Studio 现对 1–3 个已打开工具保留原标签；从第 4 项起改为原生选择器，选项包含完整标题、来源应用名，以及运行中工具的待确认状态。工具目录按钮始终可直接返回；只显示当前工具的关闭按钮，并继续使用原有确认弹窗。选择器只切换已保留的工具会话，不重新加载 schema、不执行工具。较窄视口让选择器占独立一行。前端代码在 `ManualToolDirectory.tsx`，样式在 `public/native/plugins/tool-center.css`；没有新增左侧图标或插件专用分支。

## 验证

- `bun run check` 退出 0：Biome 145 warning/10 info，设计检查通过并报告既有生成文件的一处 inline-style warning；没有运行自动修复。
- `bun run typecheck` 退出 0。
- `bun run vitest run frontend/src/features/toolCenter/ManualToolDirectory.test.tsx`：31/31，通过新增的 4 工具阈值、切换不重新加载、不执行及关闭后回到 3 标签的回归。
- `bun run build:react` 和 `bun run bundle-css` 均退出 0，更新 `public/native/react/tool-center.js` 与 `public/style.bundle.css`，未编译或复制完整 Tauri 运行目录。首次刷新仍有旧滚动条的原因是 Studio 从 `public/index.html` 加载生成的 `style.bundle.css`，仅修改模块 CSS 不会更新实际界面；打包后重新检查。
- 现有 Windows Debug EXE 复用隔离 Inspect 配置。原生 1442×931 窗口先后打开 IPv4、颜色、JWT 和 Unicode，第四项后显示单个“已打开的工具”选择器、工具目录按钮和当前工具关闭按钮，无横向滚动；下拉列表可见 4 个完整标题、来源及 4/8 计数。关闭按钮打开原有确认弹窗，随后取消，没有删除会话。辅助功能树也显示组合框与关闭按钮。截图归档于 `C:\Users\ax2\Documents\技术博客\zicode-studio-desktop\screenshots\opened-tool-picker-2026-10-17\four-tools-dropdown.png`（SHA-256 `000431817EE6712884C33B1B7B502FB0E208EA36F1AC97D1049058E0BA1FB031`）。
- 同日续验：原生选择器按 Home、Enter 后从 Unicode 切到 IPv4，工具正文与“关闭工具: IPv4 CIDR”辅助功能标签同步更新。原关闭按钮使用低对比度 `ui-button--ghost`；紧凑模式改用设计系统已有的 `ui-button--secondary`。`bun run check` 和 `bun run build:react` 退出 0；重新在 Debug 窗口打开四项后的 1442×931 截图确认按钮文字与边框可辨，保存于 `C:\Users\ax2\Documents\技术博客\zicode-studio-desktop\screenshots\opened-tool-picker-2026-10-17\four-tools-close-contrast.png`（SHA-256 `fdeef72baec275ac68e16f3431e957001ca5e66d88b0b7d974a2d29b3834b885`）。

## 边界和后续

同日补充窄窗口原生检查：用户已手动启用的 Inspect 0.1.1 隔离配置只读确认为 `enabled:true`、`pi.tools.register:true`；复用原 Debug EXE（SHA-256 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`）和 `--tools-only` profile。通过 Windows 窗口尺寸菜单把实际 WebView2 窗口从 1442×931 缩至约 802×931；继续缩小无效，属于本次能达到的最小原生宽度。在该宽度打开 IPv4、颜色、JWT、Unicode 四项后，单一选择器、目录入口、当前关闭按钮和正文都在视口内，无横向滚动。下拉列表完整显示四项与来源；按 Home、Enter 切到 IPv4，选择器、正文标题和关闭目标同步。代表性截图已实看并保存为技术博客 `screenshots/opened-tool-picker-2026-10-17/four-tools-802px.jpg`（58,811 B，SHA-256 `AD0687E181C9817C75BB1820644E2377B0A26C6EB6D2E0448C565E92D1B5112B`）。这次只复核窄窗口工具切换，没有再次执行八项工具、改权限、保存数据或发布版本。

这补齐了约 802 px 原生窗口的视觉检查，但仍未触及 CSS 的 `max-width: 720px` 分支；更窄视口需用受控 WebView 模拟或另一目标平台单独检查，不能写成已验收。原生下拉选项的鼠标辅助功能点击被 WebView2 弹出层命中检查拒绝，键盘 Home/Enter 路径实际成功；鼠标选择路径在这一宽度仍待单独复核。

现有 8 个同时打开限制仍在；它限制驻留表单数，不限制目录可发现的工具总数。Windows 约 802 px 原生窗口及选择器 Home/Enter 路径已验；720 px 以下断点、鼠标选择下拉项、屏幕阅读器及 macOS/Linux 真实界面仍待验收。DevTools 154 项完整接受仍为 0/154。未改版本、发布或生成 ZIP。

构建/检查会话前后只读空间扫描均退出 0、未知项为 0：`target` 29,997,194,081 → 29,997,194,081 B；非 scratch `.cache` 355,458,670 → 355,458,670 B；task-scratch 1,136,736,467 → 1,136,825,276 B；`site` 29,644,753 → 29,644,753 B。E 卷可用 30,217,629,696 → 30,205,214,720 B，卷余量变化不可全部归因于本轮。扫描的容量门槛仅作提示，没有清理有用缓存。

续验编译前后扫描：`target` 保持 29,997,194,081 B，非 scratch `.cache` 保持 355,458,670 B，task-scratch 1,136,852,496 → 1,136,863,593 B，`site` 保持 29,644,753 B；未知项均为 0。E 卷可用 30,201,847,808 → 30,205,894,656 B，卷余量含其他进程影响。没有根据提示门槛删缓存。

## 同日无遮挡复核

用户手动最小化 Zi DevTools 的置顶截图预览后，先确认桌面上没有运行中的 Studio 窗口，再从本项目保留的 Debug EXE（SHA-256 `8441671DE9B305071AD82D50401FB4F74DDAD1A1B15048D35B6D76C438A03FC5`）以原隔离 Inspect profile 和 `--tools-only` 启动。原生窗口归属路径为本项目 `target/debug/zicode-studio-desktop.exe`。1442×931 浅色 WebView2 中目录显示 24 项，Inspect 0.1.1 的 8 项可见。依次打开 IPv4 CIDR、HEX / RGB / HSL、JWT 内容、Unicode 码点；第四项后实际截图无遮挡，单个选择器、工具目录、当前工具关闭按钮及表单同屏可读，没有横向滚动。展开下拉后完整显示 4/8 计数、四项完整标题与来源；辅助功能树识别为“已打开的工具”组合框。既有代表性截图见技术博客 `screenshots/opened-tool-picker-2026-10-17/`，本次实时截图已目视检查但没有另存文件。本次只复核布局，没有执行工具、保存数据、改权限、构建或发布；鼠标选择下拉项、720 px 以下与其他系统仍待验。

后续尝试原生下拉项鼠标选择：Computer Use 的坐标点击在目标项上连续两次返回 `point ... is over msedgewebview2.exe "Chrome Legacy Window", not target window zicode-studio-desktop.exe`，中间已按技能要求重新激活 Studio 并刷新截图。按恢复规则停止输入。这是自动化目标窗口归属限制，不能证明真实用户鼠标点击失败；该交互仍待人工或其他受控原生方式验收。
同日当前 Debug 再复核：用户手动最小化遮挡窗口后，复用另一个已存在的 Text/Trace 隔离 `--tools-only` profile；在 1442×931 浅色窗口依次打开剪贴板加入、剪贴板列表、图片缩放和 Base64 解码四个不同工具。第四项立刻合并成单个“已打开的工具”选择器，当前工具关闭按钮仍与目录入口同排；展开可见 4/8 及四项完整名称和来源，没有横向滚动或遮挡。实时截图已目视检查，未另存。本轮不执行这些工具、不保存结果、不改权限；当前 EXE 摘要见[文本接收目录阶段](2026-10-17-text-result-receiver-facets.md)。

再次收到用户“已最小化”后，用当前 Debug EXE（SHA-256 `75159894C5D3FA68F34CCCD45F78808945A7D7EE24FE66FD473755E3C148E8E0`）和既有 Inspect 隔离 profile 以 `--tools-only` 重开原生窗口。Windows 1442×931 浅色实际截图中，目录有 24 项；依次打开 IPv4 CIDR、HEX / RGB / HSL、JWT 内容、Unicode 码点。前三项显示独立标签，第四项合并成一条原生选择器；工具目录、选择器、当前关闭按钮、Unicode 表单均可读且无横向滚动。展开后实际截图和辅助功能树都显示 4/8、四个完整标题及来源。实时截图已目视检查，未另存；本轮没有执行工具、保存数据或更改权限。鼠标选择下拉项及 720 px 以下断点仍待验收。

本次用户再次清除遮挡后，先发现隔离 Debug 窗口已退出，已安装 Studio 窗口不能代表当前源码；随后从 `E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe`（SHA-256 `7E4AE615440D596AFF7837F75A98D77C25F62C729FDEAF20F14ECB0220CE6E0F`）以既有 Inspect 隔离 profile 和 `--tools-only` 重开，窗口进程路径确认为该 Debug EXE。1442×931 原生截图中目录仍为 24 项；依次打开 IPv4、颜色、JWT、Unicode 后，第四项触发单个切换器。展开的实际截图和辅助功能树均显示 4/8、四个完整名称与来源，关闭按钮及 Unicode 表单同屏可见，无横向滚动。实时截图已目视检查，沿用上方归档的代表性截图，没有另存。本次只检查布局，未执行工具或保存结果；鼠标选择下拉项及更窄视口仍待验收。
