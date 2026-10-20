# Stage：JSON 对象独立候选接入四平台检查矩阵

日期：2026-10-17。范围仅 Studio；候选 `tests/fixtures/devtools-json-object-candidate06/` 保持逐字节冻结，不修改 DevTools。

## 目标和修改

上一阶段只在 Windows 本机运行了 JSON 对象候选的真实 Host/Worker 与嵌入 Pi 专项。现在将两项作为 `scripts/developer-platform-checks.mjs` 的必需检查加入现有 Windows x64、macOS arm64、macOS Intel、Ubuntu x64 矩阵，排在当前源码 Debug Worker 构建之后；沿用同一 Cargo target、内嵌 Pi 与 Broker 准备步骤，不新增完整运行目录。Host 专项只从仓库冻结包和外部收据安装到隔离测试配置，核对源与暂存包摘要，执行对象源工具、确认后对象接收工具及 JSON 保存。Pi 专项检查搜索、按需加载、调用及撤权，CI 显式要求使用当次准备的 `src-tauri/resources/pi/`，按平台选择 `pi.exe` 或 `pi`。

两项成功时向本次证据目录输出机器可读收据；检查器要求 `passed`、真实机制标记、候选族、固定收据 SHA-256 `51599cd787f007e4fbd4b6eeed8d669fa6ef1fef7598a2c3713752db4695ffe7`、实际能力/文件计数、对象捕获/确认/保存标记以及 64 位 SHA-256。缺失、无效或不匹配的收据使矩阵失败。收据明确 `fullCandidateAccepted:false`，不把部分协议验证误记为全部工具验收。

## 本机证据

- 平台清单定向 Vitest 9/9 通过，新增检查顺序、环境变量、缺失/错误收据和错误摘要门槛。`bun run check` 退出 0；Biome 147 warning、10 info 及既有生成样式提示。`bun run check:rust:static` 通过 Cargo check 与严格 Clippy，仓库级 fmt 漂移仍为 advisory。
- Windows 本机按 CI 的 `--ignored --exact` 路径和当次准备的 Pi 资源实际运行 Host 1/1、Pi 1/1，收据分别归档于技术博客 `iterations/json-provider-cross-platform-gate-2026-10-17/host-receipt.json`、`pi-receipt.json`。两份收据均固定候选索引、`mechanismPassed:true`、`fullCandidateAccepted:false`；Pi 收据 `preparedResources:true`、2 能力、1 动态 Pi 工具、2 阶段。Worker SHA-256 `7e4ae615440d596aff7837f75a98d77c25f62c729fdeaf20f14ecb0220ce6e0f`，Pi SHA-256 `eb2205e842d1b02a1a539e98618b20d6b055a008fa0b678ebbbeb004239f1365`，Broker SHA-256 `aaa3c5943bd85f9dcc999a11d2ee9e7ad57c863babe5c16c6e51d602fe6be444`。
- 只运行定向门槛，没有在本机重复整套开发平台矩阵或打包 Release；当前 0.4.2 版本保持不变。相关测试成功后各自清理本次隔离 scratch。
- 将本机两份实际收据再次交给 `CHECKS` 中相应的 `validateReceipt`，均返回 `true`。后置只读磁盘预算扫描完整（未知条目 0）：`target` 30,021,963,426 B，普通 `.cache` 355,458,670 B，`task-scratch` 1,178,307,562 B，`site` 29,644,753 B，E: 可用 12,675,289,088 B。预算超限为 advisory，未删除构建缓存；此前清理被策略拒绝的失败 scratch 仍保留人工候选。

## 验收边界

四平台 YAML/脚本现包含新必需项，但尚无**包含当前未提交工作树**的 GitHub Actions 运行。Windows 本机成功不能证明 macOS 或 Ubuntu 运行通过，也不能证明原生 WebView、签名安装、模型自主使用或 DevTools 全部 154 项。正式完整接受仍 0/154；其他系统须待同一源码进入 runner 后核对实际收据。隔离原生 UI 安装仍等待 Computer Use 所需的用户即时确认。
