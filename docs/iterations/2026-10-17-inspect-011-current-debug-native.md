# Stage：Inspect 0.1.1 当前 Debug 原生复验

日期：2026-10-17。仅操作 Studio 的隔离 Windows Debug 配置；用户已手动启用 Inspect 主开关与 `pi.tools.register`。本轮没有改动 DevTools、插件权限、Studio 代码或本地版本号。

## 身份与完整性

- 运行文件：`target/debug/zicode-studio-desktop.exe`，SHA-256 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`，版本 0.4.2。
- 参数：`--isolated-profile .cache/task-scratch/inspect-native-consent-20261017/profile --tools-only`。复用此前已安装的 `com.zicode.devtools.inspect` 0.1.1，没有安装第二份候选。
- 使用 Studio 只读 `verify-devtools-package.mjs` 对**已安装副本**和包外收据复核：606/606 个普通文件、2,319,279 逻辑字节，路径/大小/SHA-256 全匹配；收据 SHA-256 `911fee46bea37bf0078c84f852ddf15f43c08330d3c5079bc06b0119bed6b0b`，目录索引 `81488c9f1fc9a5d737efdb551b3aa59757053c5586baf304aaca324470cc75fa` 匹配。仍是无签名候选。

## 真实窗口流程

原生 Windows WebView2 浅色窗口为 1442×931。工具中心列出 24 项，其中 8 项来自 Inspect；目录仅加载名称与版本，点击“打开工具”才出现输入表单。逐项输入合成样例并点击“执行工具”，均显示“工具执行成功”和结果：

| 工具 | 本轮输入 | 当前窗口结果 |
| --- | --- | --- |
| IPv4 CIDR | `192.168.1.10/24` | 网络 `192.168.1.0/24`、掩码 `255.255.255.0`、254 个可用地址 |
| HEX / RGB / HSL | `#FF0080` | `rgb(255, 0, 128)`、`hsl(330, 100%, 50%)` |
| JWT 内容 | 仅含 `alg:HS256`、`sub:demo` 与虚构签名的合成令牌 | Header/Payload 解码；明确提示**未验证签名、有效期或可信度** |
| Unicode 码点 | `A中😀` | `U+0041`、`U+4E2D`、`U+1F600` 及对应 UTF-8 字节 |
| NFC 规范化 | 分解形式 `e` + U+0301 | `é` |
| NFKC 规范化 | `ＡＢＣ` | `ABC` |
| JSON → YAML | `{"name":"demo","count":2}` | `count: 2` 与 `name: demo` |
| YAML → JSON | `name: demo` 加 `count: 2` | `{ "count": 2, "name": "demo" }` |

再把 YAML → JSON 输入改为 `name: [unclosed`，界面显示“工具未能完成，请检查输入后重试”、错误代码 `INVALID_INPUT` 和“输入无法按该操作处理”；保留输入。随后切换到 JSON → YAML 并再次执行，仍成功得到 `count: 2` / `name: demo`。这证明该次业务错误没有破坏当前窗口的相邻工具；未做 Worker 崩溃注入或长时取消。

结果区域截图已在技术博客档案 `screenshots/inspect-011-current-debug-2026-10-17/json-to-yaml-result.png` 实际检查，1442×931、73,710 字节、SHA-256 `1C667816384C9B30C646701623399815B33C5A4E7432D7117C3576E5639CB3E2`。截图展示结果、保存和转交入口；本轮**没有**点击保存、发送到工具或发送模型。8 个工具全部打开后，横向标签需要滚动，属于百项工具体验的后续优化点；左侧仍只有一个工具入口。

## 验收边界

这是当前 Debug EXE 对既有无签名 Inspect 0.1.1 隔离安装的 8/8 单次原生复验，并补充一次错误后兄弟工具继续运行的证据。此前旧 Debug 的 8/8 与同包接力记录仍保留，不能用本轮重复计为新工具。未验证正式签名安装/升级/回退、模型自主调用、持续运行、真实慢任务取消、macOS/Linux 或每个源工具的完整业务范围。DevTools 154 项完整工具接受数继续为 0/154。未构建、发布、生成 ZIP 或清理缓存。

只读存储扫描退出 0、未知项均为 0：`target` 29,997,194,081 B，非 scratch `.cache` 355,458,670 B，task-scratch 1,136,736,210 B，`site` 29,644,753 B，E 卷可用 30,173,540,352 B。task-scratch 相比上次记录增加 100,517 B；目录逻辑变化与卷可用空间变化不能等同。按项目保留规则，没有依固定容量门槛删除有用缓存或隔离验收配置。
