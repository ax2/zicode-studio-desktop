# Stage：嵌入 Pi 1.3.0 活动工具集合实测

日期：2026-10-18。目标是对前一阶段“超预算更新时移除旧活动入口”所依赖的 Pi API 语义作真实运行时复核；不重建 Studio EXE，不请求模型，不加载用户扩展。

## 环境与过程

使用仓库内 `src-tauri/resources/pi/pi.exe`，SHA-256 `EB2205E842D1B02A1A539E98618B20D6B055A008FA0B678EBBBEB004239F1365`。以 RPC、`--no-session --no-extensions` 和显式合成扩展启动；扩展仅注册 `probe_typed` 与本地命令。驱动通过 RPC 提交 `/probe-active-tools`，命令直接读取 `getActiveTools()`，用 `setActiveTools()` 移除该名称、再次加入，并写出不含模型内容或凭据的布尔结果。

真实进程返回 `beforeHasTool=true`、`afterHasTool=false`、`restoredHasTool=true`、`otherToolsPreserved=true`，活动数量依次为 5、4、5；驱动退出 0。原始探针、驱动与结果归档于技术博客 `iterations/pi-catalog-real-runtime-probe-2026-10-18/evidence/`。结果文件 SHA-256 `C973911A02D16BDA3F79F884F21BB38125823E0BF1540089E655F5CCC5AB0D77`。按命令行筛选没有发现该探针残留的 Pi 进程。

## 边界和清理

此测试确认真实 Pi 1.3.0 的活动工具 API 支持精确移除与恢复，但没有通过实际 Studio `plugin-catalog.ts`、Host/Worker、模型会话或 DevTools 提供方执行超预算更新。前一阶段扩展专项 8/8 与本阶段 Pi API 证据是不同层级，不能合并宣称完整链路验收。DevTools 0/154、ZiFile 0/108 不变。

临时探针位于 `.cache/task-scratch/pi-active-tool-probe-20261018/`，其三个证据文件已逐文件校验并复制归档。对**该目录**发出的精确作用域递归清理被自动审批策略以 `blocked by policy` 拒绝，实际删除 0；没有重试或绕过，约 3.4 KiB 小目录留在原处等待用户手工处理。没有删除其他缓存、构建或隔离配置。

前后只读预算扫描均为 `target` 30,040,567,930 B、非 scratch `.cache` 355,458,670 B、`site` 29,644,753 B，未知项 0；task-scratch 为 1,412,466,781 → 1,412,466,923 B，差额恰为探针结果文件 142 B。E 盘空闲 5,207,003,136 → 5,207,625,728 B；卷余量差异没有归因于本轮。脚本因低于提示阈值退出 1，不表示扫描失败或允许清理缓存。

## 后续：真实 Pi 运行 Studio 目录扩展

同日重建 `extensions/dist/plugin-broker.mjs`（仅原位更新扩展产物，未重建桌面 EXE），在嵌入 Pi 1.3.0 的 RPC 进程显式加载一个隔离探针。探针调用 Studio 编译扩展的 `setupPluginBroker`，并捕获扩展向真实 Pi 注册的工具定义；命令处理器直接调用定义的 `execute`。目录 HTTP 端为仅绑定 `127.0.0.1` 的合成服务，按 Studio 协议提供搜索、加载与调用响应。关闭 Pi 会话保存，不请求模型，不安装或启用真实插件。初次尝试受到当前 `HTTP_PROXY`/`HTTPS_PROXY` 环境影响，本地请求收到 503；仅在隔离子进程清空代理变量并指定 `NO_PROXY=127.0.0.1,localhost` 后重跑。

最终驱动退出 0：搜索 2 项，修订匹配；初始 A 活动，B 加载为类型化工具并活动；加载大体积 A 更新后，合计目录快照超过 256 KiB，A 返回 `generic` 且旧活动入口移除，B 仍活动；通用调用 A 通过再次加载和合成 `/invoke` 返回 `synthetic-host`。目录工具均存在于真实 Pi 注册表；5 次 HTTP 请求都带有合成绑定并通过本地服务核对。原始脚本、结果和驱动汇总归档在技术博客同 Stage 的 `evidence/catalog-*` 四文件，逐文件 SHA-256 与工作副本一致；汇总文件 SHA-256 `DF1983EA3DD705B64BA60E74DEAF2ACDA2AC2ACA854B503F12622EB8970D63C4`。

此结果验证 Studio 编译扩展在真实 Pi 上的目录逻辑和活动工具切换；工具 `execute` 由探针命令调用，没有经过 Pi 模型调度。HTTP 端不是 Studio Host/Worker，返回也不是 DevTools 提供方结果；原生 UI、权限、真实取消/超时、跨平台和完整 DevTools 154 项仍待验收。JSON 对象插件按用户最新决定暂不启用，权限不变。此前被拒绝清理的暂存目录仍未再次申请删除；新增探针文件也保留在该目录和档案中，不能把上一段 3.4 KiB 当作当前目录大小。

补验后的只读空间扫描：`target` 30,040,567,930 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,478,935 B、`site` 29,644,753 B，所有树的未知项均为 0；E 盘空闲 5,255,380,992 B。容量提示仍使脚本退出 1，不据此删除可复用缓存。按命令行未发现本次探针 Pi 进程残留；文档 `git diff --check` 无错误。

## 后续：上游稳定版本复核

2026-10-18 读取[上游 Pi v1.3.0 官方发布页](https://github.com/earendil-works/pi/releases/tag/v1.3.0)，页面当前将其标为 `Latest`。本仓库 `scripts/pi-version.json`、`package.json` 的 Pi SDK 包及直接执行 `src-tauri/resources/pi/pi.exe --version` 均为 `1.3.0`。因此没有已确认的更新稳定版需要升级；没有下载二进制、改锁文件或修改应用版本号。观察时 E 盘空闲约 156,884,992 B，后续若上游出现新版，应先复核官方发布及跨平台资产摘要，再执行既有升级门禁，不能用本次日期的判断代替未来检查。
