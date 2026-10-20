# 项目存储完整盘点（2026-10-17）

## 目标与改动

真实项目的 5 秒快扫只能给出下界。本阶段在现有项目存储页增加用户主动触发的完整只读盘点；默认进入页面仍为快扫。Rust 使用同一批常见生成目录和 Cargo 分项，完整模式预算 180 秒、最多 1,000,000 条目，Tauri 响应上限 190 秒；遇到链接、不可读项或预算截止仍标不完整。没有删除入口，应用版本和 Release 不变。

## 验证

- 构建前 `storage-budget.ps1` 退出 0：`target` 29,435,841,931 逻辑 B / 74,858 文件，未知 0；E 盘可用 31,578,140,672 B。
- `bun run check`、`bun run typecheck`、`bun run check:rust:static` 退出 0；项目存储前端专项 13/13，Rust 专项 2/2。`bun run build:local` 复用现有 Debug target 和已下载运行资源，不生成 ZIP。
- 独立 profile 的 Windows Debug EXE 对真实 `E:\zicode-studio-desktop` 工作区先执行快扫，再点击“完整盘点”。1442×931 原生窗口持续可操作；约两分钟后显示完整盘点时间。`target` 27.4 GiB / 74,898 文件、`target/debug` 23.0 GiB / 53,929、`target/debug/deps` 16.2 GiB / 9,315、`target/debug/incremental` 2.6 GiB / 1,799，均显示扫描完整。截图见技术博客项目 `screenshots/project-storage-deep-2026-10-17/windows-real-project.png`。
- `target/release` 和 `target/debug/build` 在同一完整盘点中仍只显示部分下界；`.cache`、`node_modules` 也不完整。父级 `target` 已显示完整而两个分项不完整的原因待查，不用这些下界规划删除。
- 退出确切隔离 Debug PID 60148 后，只读脚本退出 0：`target` 29,440,644,406 逻辑 B / 74,898 文件、task-scratch 939,214,516 B / 33,161 文件、未知 0；E 盘可用 31,556,534,272 B。脚本与 UI 的 `target` 文件数一致。前后卷空闲变化不能归因于本阶段；实际清理 0 文件、0 B。

## 审批与遗留

此前合成 scratch 的精确删除在执行前被自动审批以 `blocked by policy` 拒绝，没有更具体理由，实际删除 0 B。本阶段没有换工具重试；项目磁盘规则也禁止绕过既有拒绝。策略只能由会话或策略所有者调整；用户可在核对路径、进程和档案引用后手工处理已列候选。当前保留 Debug/Release 运行目录、可复用缓存和其他工作的未提交修改。完整 DevTools 154 项和 ZiFile 108 项接入验收仍待完成。

## 后续：避免把深度模式误认为所有目录完整

实际窗口证明 180 秒模式也可能留下部分下界，因此按钮、最近扫描标记及说明从“完整盘点”改为“深度扫描”；当任一目录未完成时，页面在列表前明确提示观测值不能作为可清理空间估算。没有改变扫描器、预算或删除策略。此前 `target` 完整而 Release/build 分项不完整的状态仍待诊断，文案调整不算修复该异常。

前端项目存储专项 13/13、`bun run check`、`bun run typecheck` 退出 0。`bun run build:local` 复用 Debug 和已下载 Pi 1.3.0、Portable Git、WebView、Bun，未改版本/生成 ZIP。Windows 1442×931 新 Debug 窗口中按钮、说明和快扫不完整警示均可读，截图归档为 `screenshots/project-storage-deep-2026-10-17/windows-partial-warning.png`；这是快扫警示的原生验证，未再次执行两分钟深度盘点。隔离 PID 49436 已退出，用户安装版未操作。

本次构建前后只读脚本均退出 0、未知条目 0：`target` 29,440,644,406 B / 74,898 文件 → 29,441,662,314 B / 74,907 文件；E 盘可用 31,439,388,672 → 31,485,931,520 B。卷空间变化不等于本轮释放；实际删除 0 文件、0 B。

## 后续：真实目录原始结果与页面状态复核

继续调查上述状态矛盾。在当前工作树增加默认忽略、必须显式设置 `STUDIO_STORAGE_REAL_WORKSPACE` 才运行的只读诊断用例；对真实工作区调用同一个 Rust `inspect(..., deep=true)`。测试 1/1 通过，运行 114.40 秒，原始结果：`target` 29,439,778,251 B / 74,916 文件，Debug 24,735,640,737 B / 53,947，Release 4,704,136,231 B / 20,967，Debug/deps 17,345,522,796 B / 9,315，Debug/build 3,205,507,031 B / 18,290，Debug/incremental 2,790,120,589 B / 1,799；这六项均为 `complete`、跳过 0。结果支持单次 Rust 盘点可以完整取得 Cargo 分项，但不能解释先前页面的混合状态。

Rust 报告现在带 `scanMode`，页面验证并显示后端回传的实际模式；如果请求深度而后端报告快速，页面报错提示。页面还检测“父 `target` 完整、子项不完整”的矛盾并提示以独立只读盘点复核。前端定向 15/15、`bun run check`、`bun run typecheck`、`bun run check:rust:static` 退出 0；全仓库格式检查仍有既有漂移。两次 `bun run build:local` 均复用 Debug 和已下载资源，未生成 ZIP、未改版本。

Windows 隔离 Debug 的首轮新构建原生深度扫描确实回报 `scanMode=deep`，但仍出现父目录完整、Release/build 分项不完整，截图 `screenshots/project-storage-deep-2026-10-17/windows-mode-anomaly.png` 保存了先前一次同类状态。前端矛盾警示在定向测试通过，但**该轮原生窗口未出现**，所以不能称警示的真实异常路径已验收。检查发现当前源及 `target/debug/public` 的前端包都含警示文本，Host 静态服务也已声明 `no-store`；旧 WebView 资源状态只是待证假设，不作为确认根因。

在同一窗口使用 Ctrl+Shift+R 后，再做快扫与深度扫描：后一次深度扫描于 08:16:37 返回 `target` 27.4 GiB / 74,954 文件，Release 4.4 GiB / 20,967，Debug/build 3.0 GiB / 18,328，Debug/incremental 2.6 GiB / 1,799，`.cache` 和 `node_modules` 也完整；[实际页面截图](<C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/screenshots/project-storage-deep-2026-10-17/windows-consistent-after-reload.png>)保存了分项布局。后置只读脚本同为 `target` 74,954 文件、29,447,084,378 逻辑 B，未知 0。它证明当前窗口经过重载后可以得到一致完整结果，不证明首次异常的根因已修复，也不是 macOS/Linux 验收。精确隔离进程已退出，用户安装版未操作；实际删除 0 文件、0 B。DevTools 154 项与 ZiFile 108 项完整接入仍待。
