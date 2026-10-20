# Stage：工具中心结果保存状态链路

日期：2026-10-17。仅修改 Studio，保留其他工作与 DevTools/ZiFile 提供方目录。

## 发现与修改

可信 Host 和共享保存面板已实现不确定回执后的只读状态查询，但工具中心 `ManualToolResultActions` 只转发 prepare/commit/transfer，没有转发 `PluginCapabilityGateway.saveStatus`。因此工具中心的直接工具执行结果无法走自动状态核验。现补上可选类型及实例绑定转发，沿用共享面板的有效版本/UUID 检查、工作区序号保护、人工复查入口和单次写入约束。插件 iframe、Host API 和提供方契约不变。

## 验证

- 工具中心与共享面板定向 26/26。新增用例模拟写入响应丢失后有效只读回执，断言工具中心显示已验证成果且 `commitSave` 仅调用一次。
- 初次运行 25/26：原有目录搜索断言未包含此前新增的 `AbortSignal` 参数。更新这一条断言后重跑 26/26。`bun run typecheck`、`bun run check` 和相关文件 `git diff --check` 均退出 0；完整检查仍报告仓库既有警告。
- `bun run build:react`、`bun run build:local` 均退出 0，复用原有 `target/debug`，不改 0.4.2。EXE SHA-256 `525ECB762A25C41E9254C6FC6CA59E6C01A7695F46392F35805BBD14C86ED873`；源码与运行目录的 `tool-center.js` SHA-256 同为 `DFFFC65CE1F728B62CF684BAA0D8FF385D0D558E16CA5FDBDFEA2C2AC12990F4`。
- 当前 Windows 1442×931 浅色隔离 `--tools-only` Debug：工具目录 24 项，打开 Base64 解码，输入合成 `aGVsbG8=`，实际执行得到 `hello`；预览后明确确认保存，并从工作区产物页打开，显示 text/plain、来源工具和内容 `hello`。代表性[截图](<C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/screenshots/tool-center-save-status-2026-10-17/windows-saved-artifact.png>) 102,591 B，SHA-256 `77E146DACB51DB4A42F7B3121F0BC9807666E83FD8F2B65E90D7F309EE7AC3E2`。这证明正常回执的发现→执行→保存→展示路径，不证明丢失回执时的原生自动恢复；后者当前仅有组件级模拟。PID 20340 已按程序路径及隔离参数核对后停止。
- 前后只读空间扫描均成功、未知项 0：`target` 30,015,038,678 → 30,015,172,507 B，非 scratch `.cache` 均 355,458,670 B，task-scratch 1,178,034,379 → 1,176,735,237 B；E 盘可用 15,178,252,288 → 15,159,930,880 B。卷级变化不归因于本轮；容量 advisory 不触发删除。

## 边界与后续

通用结果缓存仍只支持成功文本 `data.text`；结构化结果的有类型字段映射需独立版本协议和提供方 conformance，不能在 v1 中隐式转换。无正式签名 DevTools 包，完整 154 项接受仍为 0；ZiFile 108 项仍为 0。本地 0.4.2 不变，无新 Release/ZIP；保留现有 Debug/Release 与有用缓存。
