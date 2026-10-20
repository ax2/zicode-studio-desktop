# 项目存储中的验收暂存明细（2026-10-18）

## 目标与发现

项目存储此前只将 `.cache/task-scratch` 计入 `.cache` 汇总，无法在 Studio 中看到持续验收资料的独立占用。此目录可能含已引用的截图、收据和失败证据，逻辑大小不能等同于可释放空间。

## 修改与边界

Rust 项目存储扫描在 `.cache` 下新增 `.cache/task-scratch` 明细，沿用现有只读、跳过链接、限时和最多条目约束。明细计入父目录，父目录扫描不完整时明细也保守标为不完整。可信项目空间在明细行提示先核对归属与档案引用，并说明所有明细均已计入父目录，不应重复相加。中英文文案同步。没有增加删除入口，也没有清理文件。

第一次 Windows 原生深度扫描到三分钟时，暂存明细仍只达到 777 文件、≥20.5 MiB；独立清单当时记录了 35,592 个文件。这证明原生页面的该次深度扫描不完整，不能把原结果当作真实占用。检查发现 Windows 硬链接探测原先对每个文件使用 `File::open` 的数据读取权限。现在改用 `CreateFileW` 的 `FILE_READ_ATTRIBUTES` 元数据权限、共享读写/删除及 `OPEN_NO_RECALL`，并拒绝在探测中跟随重解析点；这避免为统计硬链接数请求文件内容。Win32 权限及无召回标志依据 [Microsoft CreateFileW 文档](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)。

## 验证

前端项目存储专项 16/16、TypeScript 类型检查与 3470 项中文词条覆盖通过。两轮 Rust 静态检查通过，整仓格式检查仍有既有 advisory；第二轮项目存储 Rust 专项 4 通过、1 个大型工作区诊断按约定忽略，新增用例确认元数据句柄仍识别同一文件的两个硬链接。`bun run build:local` 成功，在原有 `target/debug` 得到 `zicode-studio-desktop.exe`，内嵌 Pi/Git/WebView2/Bun 资源均复用既有本地版本。

Windows 隔离 Debug 原生窗口打开本仓库项目存储，首版快速扫描显示 `.cache/task-scratch` 的不完整下界（≥20.5 MiB、≥777 文件）与引用提示；实际 1442×931 桌面截图已检查，中文可读、明细与 `.cache` 父项不会被表述成可相加的两个总量。截图保存于技术博客 `iterations/project-scratch-storage-detail-2026-10-18/screenshots/windows-debug-quick-partial.jpg`（132,578 B，SHA-256 `CCAA7D4FF0DE93C4BCB4A7BC80F56F65F658F1F56A31621F82F087F401370EB0`）。

元数据句柄版本同一隔离窗口快速扫描提升到 ≥559.1 MiB、≥18,918 文件；随后深度扫描显示 36,038 文件，但字节数仍为 ≥559.1 MiB 且状态为不完整。第二次深度扫描的实际截图 `screenshots/windows-debug-deep-partial.jpg`（124,764 B，SHA-256 `4CE9B57F9EE72BEB918448E7C191248D2323349543F87734657012EF04D37DC2`）已检查，提示和数值可见。独立执行仓库现有的大型工作区只读诊断时，同一 `project_storage::inspect` 在 8.57 秒内将 `.cache/task-scratch` 统计为 1,333,044,270 B、36,038 文件、`complete`、0 skipped；`.cache` 为 1,688,502,940 B、36,194 文件、`complete`。该诊断与原生界面的字节数/状态矛盾，暂不能解释，也不能以诊断替代原生界面验收。诊断临时打印代码已撤销。快速扫描及原生深度扫描的下界都不能作为完整占用或可回收空间；其他系统实机仍待验。

本轮隔离配置在 `.cache/task-scratch/storage-detail-native-20261018` 新建 444 个文件、74,545,145 逻辑字节；关闭进程后确认无链接及关联进程。递归删除这一本轮自有目录的命令被自动审批以 `blocked by policy` 拒绝，未换工具重试，目录保留。隔离 JSON 对象插件仍保持用户指定的禁用状态，本轮没有改动插件权限或执行它。

收尾运行 `scripts/storage-budget.ps1`：`target` 为 30,039,168,788 B / 75,888 文件，`.cache/task-scratch` 为 1,333,030,099 B / 36,036 文件，所有扫描树的 `UnknownEntries` 均为 0；E 盘空闲 8,225,828,864 B，低于保留线，脚本退出 1 提示容量超标。此时的文件数与前述直接诊断略有变化，属于不同时间点的清单；没有据此清理可复用缓存。下一步需追查原生窗口与直接调用的结果分歧，核对暂存目录引用及清理策略，再决定可安全释放的范围。

## 追加复核：区分旧结果与正在运行的扫描

检查界面状态发现：原组件在新的深度扫描进行中或失败后仍展示前一次快速扫描结果；原截图只覆盖列表区域，没有拍到结果顶部的扫描模式与进度，因此不能证明其 559.1 MiB 来自已完成的深度扫描。现改为新扫描进行中或失败时隐藏旧结果，只在成功返回后展示数据；成功扫描之间仍保留比较基线。此前差异因此从“原生扫描数值与直接调用矛盾”调整为“旧截图不能确认扫描模式，需重新实机验收”，不倒推断言旧进程的具体时序。

前端专项 17/17、类型检查、`bun run check` 通过；`bun run build:local` 复用现有 `target/debug`、Pi/Git/WebView2/Bun 资源并成功生成 Debug EXE，未改应用版本。Windows 1442×931 隔离 Debug 原生窗口中，点击深度扫描后旧列表立即隐藏，扫描中截图已目视检查。首次成功返回后顶部明确显示“深度扫描”及完成时间，`.cache` 为 1.6 GiB / 36,193 文件 / 完整，`.cache/task-scratch` 为 1.2 GiB / 36,037 文件 / 完整；第二次实机深度扫描又显示 1.2 GiB / 36,038 文件。数值与独立清单 1,333,030,099 B / 36,036 文件的量级一致，文件数因扫描时间点不同略有变化。此处只验证 Windows 本机、当前项目与当前构建；其他平台仍待验。

技术博客截图归档：`windows-debug-deep-complete-top.jpg`（115,906 B，SHA-256 `92B9B3FD92316A75CA7D499EFC748A28EF8687579E7FBFB5E9BA48BE3B4FAE58`）、`windows-debug-deep-complete-row.jpg`（124,081 B，SHA-256 `DE1FE66302F208A1127F88A2732114228BC1A535338E826495118FA0986F9948`）、`windows-debug-deep-pending-no-old-result.jpg`（92,001 B，SHA-256 `9B38B621EA35007D5EEDB5BAD2DEBEB87CC5E90A4867DD48A526FF0FC7D91177`）。隔离进程按 EXE、参数及 PID 核对后已停止。清理被拒绝的本轮自有暂存目录仍保留，没有重试。

本次构建/检查前后预算复核：`target` 由 30,039,168,788 B 增至 30,039,229,199 B，`.cache/task-scratch` 由 1,333,030,099 B 增至 1,333,041,652 B，所有树 `UnknownEntries=0`；收尾 E 盘空闲 8,236,163,072 B，低于 20 GiB 保留线，因此预算脚本仍按预期退出 1。上述为逻辑大小，不等同于卷空闲变化。
