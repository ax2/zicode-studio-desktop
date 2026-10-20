# Stage：多文件工具候选的格式声明可见性

日期：2026-10-17。仅修改 Studio；不修改 ZiFile 或 DevTools。

## 问题与修改

Host 已对 `--open-selection` 的每个基本名核对提供方 `fileInput` 声明，并在目录条目返回 `fileInputMatch: declared|unknown`。工具中心原先只在单文件时显示该状态；多文件的候选卡片缺少区别，用户无法从卡片判断是所有文件名均有声明支持，还是旧插件未声明类型。当前工具卡片在多文件模式下也显示状态；中文词条明确为“插件声明支持每个选中文件名”或“插件未声明文件类型”。未改变 Host 过滤、授权或执行协议。

## 验证

- `ManualToolDirectory.test.tsx` 30/30，新增断言覆盖多文件 declared/unknown 两类卡片；`bun run typecheck`、`bun run check`、`bun run build:react` 与中文词条覆盖检查通过。`bun run check` 保留仓库既有 145 warning、10 info 和 1 个生成 JS 样式提示。
- 使用实际 React 组件和合成目录响应渲染 1280×800 深色浏览器预览，截图已目视检查：文件基本名、未共享说明、两个候选卡片及两种标签可读，没有横向溢出。归档技术博客 `screenshots/multi-file-hints-2026-10-17/dark-component.png`，45,767 B，SHA-256 `653E6855E1A62E26AC9030D882FA4B7055D931570743951F7BDB2C1AB7F683F2`。这是组件预览，不是签名提供方或原生 WebView2 截图。
- 官方 [`badlogic/pi-mono` 最新稳定 Release](https://github.com/badlogic/pi-mono/releases/tag/v1.3.0) 经 GitHub API 只读核对为 `v1.3.0`（2026-10-15 发布），与当前 `scripts/pi-version.json` 一致；此轮无需重复下载或改版本。

## 边界与磁盘

前一阶段 Inspect 隔离配置缺少多输入提供方，真实 `--open-selection 2` 窗口为 0 个工具；上面的深色截图仍是组件预览，不能把候选标签当作实际算法兼容或 ZiFile 接受。正式 DevTools 154 项全量接受仍为 0，ZiFile 108 格仍为 0。未发布应用版本或生成 ZIP。

本轮前后只读扫描：`target` 均为 29,993,014,792 B；task-scratch 1,031,761,355 → 1,034,001,332 B；非 scratch `.cache` 355,458,670 B 与 site 29,644,753 B 不变，未知项 0。E 盘可用 30,340,718,592 → 30,330,785,792 B，卷变化受其他进程影响。组件预览本地服务已停止、浏览器临时标签已关闭；试图删除任务自有 `.cache/task-scratch/multi-file-hint-preview-20261017` 时，被自动策略拒绝，未绕过。该目录目前约 2.24 MB，可由用户按精确路径人工删除；博客截图独立保存。复用原项目 target 与依赖缓存。

## 后续原生 Debug 验证（同日）

复用现有 Cargo `target/debug`、Pi 与前端缓存执行 `bun run build:local`，成功重建当前 0.4.2 Debug EXE；SHA-256 `C2856DF5F486D10FF4D716751365D51AC436AB50500AD6AC0B7AEC7FA383E3EC`，没有生成 Release 或 ZIP。使用既有隔离配置中的 Studio 自有 `multi-resource-proof` WASI 测试插件，以 `--open-selection 2` 打开 300000 B 的 `first.bin` 和 8 B 的 `second.bin`。

在 1442×931 浅色原生 WebView2 窗口中，目录显示两个文件名、内容尚未提供、仅显示至少支持两个输入的工具，并列出 1 个“双文件读取验收”候选及“插件未声明文件类型”标签。打开详情后，“使用已打开的 2 个文件”显示各文件大小；按“确认提供文件”后界面显示“已提供确认的文件”，再按“执行工具”完成调用，显示“接收工具已完成，结果尚未保存”及 guest 结果 `resource`。这是当前 Debug EXE 的真实界面链路和自有合成文件运行证据。未执行保存或写入。该包未声明 `fileInput`，因此原生只验证了 `unknown` 标签；`declared` 标签仍只有组件与定向测试证据。Explorer 实体右键触发、签名 ZiFile/DevTools 多文件包和正式格式算法仍待验收。

重建前后只读存储扫描：`target` 29,993,014,792 → 29,996,966,858 B（+3,952,066 B）；task-scratch 1,034,001,597 → 1,094,374,489 B（+60,372,892 B）；非 scratch `.cache` 355,458,670 B、site 29,644,753 B 不变，未知项 0。E 盘空闲 29,632,585,728 → 30,271,164,416 B，空闲变化包含其他进程活动，不能归因于本次构建。所有数据仅扫描，未根据预算阈值删除可用缓存。
