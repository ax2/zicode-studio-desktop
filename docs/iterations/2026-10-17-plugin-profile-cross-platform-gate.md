# Stage：插件清单 profile 的四平台预检门槛

日期：2026-10-17。目标是让新增的插件清单声明预检随 Developer platform 工作流在 Windows x64、macOS arm64/x64、Linux x64 四个矩阵行执行。

## 发现与修改

`scripts/check-plugin-manifest-profiles.mjs` 已提供只读 CLI，但 `scripts/developer-platform-checks.mjs` 尚未将它列为独立非建议性步骤。现对冻结的 `devtools-agent-assist-candidate03/plugin.json` 执行预检；该样本声明齐全，不修改冻结包。预检失败会使平台报告失败，并保留单步日志。`developer-platform-checks.test.js` 锁定这个门槛，避免后续遗漏。

## 本地验证

- `bun run check:plugin-manifest-profiles tests/fixtures/devtools-agent-assist-candidate03/plugin.json`：退出 0，`issues: []`，明确输出 `preflightOnly: true`、`hostAccepted: false`。
- `bun run vitest run scripts/developer-platform-checks.test.js scripts/check-plugin-manifest-profiles.test.js`：2 文件、13 项通过。
- `git -c core.safecrlf=false diff --check -- scripts/developer-platform-checks.mjs scripts/developer-platform-checks.test.js`：退出 0。

这只是当前 Windows 上对检查命令和清单注册的验证；四平台 CI 尚未运行这份未提交修改。预检仅检查声明提示，不能代替 Host 清单验证、签名、权限、真实执行或 DevTools 全工具接受。154 项完整接受仍为 0/154，ZiFile 为 0/108。没有编译新的 Tauri EXE 或生成 ZIP。

## 空间与后续

检查前后只读扫描均退出 1，原因是既有容量建议：`target` 均为 30,010,795,065 B，非 scratch `.cache` 均为 355,458,670 B，task scratch 均为 1,136,632,367 B；E 卷可用 15,843,311,616 → 15,855,534,080 B，卷余量变化不能归因于本轮。未知项均为 0。容量建议不构成删除有用缓存的理由。后续需在包含本改动的提交上查看四平台工作流结果，再分别核对 macOS/Linux 原生界面与正式签名提供方包。

## 续进：tool.open.v1 的清单预检

Studio 新增工具直达 View 合同后，将其安装门槛同步到只读预检：仅在清单声明该 profile 时，检查 schemaVersion 2、`=1.0.0-preview.1`、主 View 和非空 capability 列表。四平台检查步骤增加 Studio 自有合成样本，不修改冻结提供方夹具。Host 校验仍是权威门槛。当前 Windows 两文件 16/16 测试及双清单 CLI 预检通过，输出均 `issues: []` 且明确 `hostAccepted: false`；四平台 CI 尚未运行这份未提交代码。未接收正式 ZiDevTools 包，完整接受仍 0/154。

本轮第一次 `bun run check` 因新合成 View HTML 缺少 `lang` 失败；补上 `lang="en"` 后复跑通过，保留仓内已有 147 warning/10 info 与设计生成 JS 的 1 条 warning。前后只读扫描四类树逻辑大小/文件数一致，未知项均 0；E 卷空闲从 8,848,510,976 B 到 9,029,001,216 B。扫描因余量 advisory 退出 1，卷空闲变化不可当作本轮写入量；没有删除缓存。
