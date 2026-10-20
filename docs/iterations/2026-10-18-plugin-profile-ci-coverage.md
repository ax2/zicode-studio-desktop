# Stage：四平台插件清单 profile 预检覆盖

日期：2026-10-18。目标是在跨平台门禁中覆盖仓库实际持有的冻结插件清单，而不是只验证两份手选样本。没有修改 DevTools、ZiFile 或任何冻结包字节。

## 发现

`tests/fixtures/` 当前有 14 份 `plugin.json`。原 `Developer platform` 门禁只预检 Agent Assist 与 Studio 自有工具直达两份；手动将 14 份全部交给同一预检器时，13 份没有问题，`devtools-url-text-resource-candidate02` 报出缺失 `tool.directory.v1` 与 `output.schema.v1`。该候选是已有专项测试明确断言这两项缺失的冻结负例，不能改其原件或把它当作正例。

## 修改

`scripts/developer-platform-checks.mjs` 在运行时枚举 `tests/fixtures/*/plugin.json`，排序后将除上述已知负例外的所有清单交给非建议性预检。新增夹具会自动进入四平台门禁；负例仍由 `check-plugin-manifest-profiles.test.js` 核对精确错误。`developer-platform-checks.test.js` 对实际目录验证门禁参数覆盖，并明确检查 Studio 工具直达和 JSON 对象清单在内、已知负例在外。

## 验证和边界

- 本机从 `CHECKS` 真正执行 `plugin-manifest-profile-preflight`：13 份正例均 `issues=[]`，退出 0；手动包含 14 份时预期退出 1，仅上述负例有两项缺失。
- 两个定向测试文件 16/16；`bun run check` 退出 0。六类本地 TypeScript 类型检查（前端、外部客户端、finance、chat inbox、platform core、扩展源码）均退出 0；Tauri 49 个命令的默认权限检查退出 0。
- 最新已查询远端 `Developer platform` 运行 [#84](https://github.com/ax2/zicode-studio-desktop/actions/runs/38950680629) 的 Windows、Ubuntu、macOS ARM 和 macOS Intel 四个作业成功，但其提交是 `9cf5fd0`；当前本地 HEAD 为 `72f4b0e` 且工作树有其他未提交修改。远端成功**不验证本次门禁改动**，四平台新规则仍待包含本修改的远端运行。

这是清单声明的静态预检，`preflightOnly=true`、`hostAccepted=false`；不证明任何插件安装、启用、执行、签名、真实 UI 或操作系统运行。用户选择暂不启用的 JSON 对象插件状态没有改变。DevTools 全目录完整接受仍 0/154，ZiFile 0/108；没有构建或发布应用，也没有生成 ZIP。

前后只读空间扫描均为 `target` 30,040,567,930 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,463,578 B、`site` 29,644,753 B，未知条目 0。E 盘空闲 5,376,237,568 → 5,247,909,888 B；脚本因低于保留提示阈值退出 1。卷余量变化未归因于本轮，也没有删除任何缓存或另建 Cargo target。
