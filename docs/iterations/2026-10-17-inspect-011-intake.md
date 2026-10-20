# DevTools Inspect 0.1.1 候选只读接收（2026-10-17）

## 范围和证据

只读检查 `E:\zi-devtools\release\plugin-candidates\inspect-0.1.1-candidate-01` 及同级 `-verification.json`，没有修改或复制 DevTools。收据 SHA-256 为 `911fee46bea37bf0078c84f852ddf15f43c08330d3c5079bc06b0119bed6b0b`。接收端独立枚举文件：清单与实际均为 606 个普通文件，逻辑大小 2,319,279 字节；逐文件路径、长度、SHA-256 均匹配，未发现多余、缺失或链接文件。按提供方声明的 `files` JSON 数组顺序、键顺序和 UTF-8 紧凑序列化规则重算目录索引，为 `81488c9f1fc9a5d737efdb551b3aa59757053c5586baf304aaca324470cc75fa`，与收据相同。首次试算误把各条 JSON 对象直接拼接，摘要不符；按收据明确的**数组**编码修正后通过，原始文件检查未受影响。

清单为 `com.zicode.devtools.inspect` 0.1.1，列出 8 个能力：颜色 1、YAML/JSON 2、CIDR 1、JWT 1、Unicode 3。Studio 的只读 profile 快速提示输出 `issues: []`，退出码 0；这不是 Host 清单解析、签名或运行时接受。收据自报 121 项功能向量、121 项 fuel 与 121 行冷启动检查、两种 View 检查；Studio 此轮未独立运行这些提供方脚本或实际 Worker。WASM 摘要为 `1db3fc37df01cd3a8371320d4f897a7fdf750c87e6202b736ed6870f046b8f29`。

## 验收边界和下一步

外部收据写明 `unsigned provider candidate; not Host-accepted`、`packageSha256=null` 且没有签名密钥或容器。Studio 没有安装、升级、回退、执行或展示此版本，因此它不能替代先前 0.1.0 的历史运行记录，也不提高 DevTools 154 项完整工具的接受数（仍为 0/154）。提供方目录可能变化；后续运行前须重新核对同一收据。

已向 DevTools 原开发会话提出明确交付需求：保留独立应用与现有候选，另交版本化签名 `.zicode-plugin`、包摘要、发布者公钥身份、逐文件收据和可复现构建说明；如签名或协议受阻，应回报具体 Studio 接口缺口。Studio 收到后还需验证正式签名生命周期、真实 Host/Worker/Pi、权限与取消、结果接力，以及目标平台。此轮没有界面改动或新截图，没有构建应用、发布版本、生成 ZIP 或清理缓存。

后续已把收据声明的目录索引编码加入 Studio 现有只读校验命令，并对同一候选重放成功；见[目录索引复算记录](2026-10-17-devtools-receipt-index-check.md)。此前人工独立核对证据仍保留，两者都不构成签名或 Host 运行验收。

## 后续：隔离原生安装（2026-10-17）

在用户明确允许安装到隔离配置后，Studio 再次运行逐文件核验命令：
606 个文件、2,319,279 字节及目录索引均匹配，签名仍为 false。
使用现有 `target/debug/zicode-studio-desktop.exe` 的 `--isolated-profile`
和 `--tools-only` 启动，隔离配置位于
`E:\zicode-studio-desktop\.cache\task-scratch\inspect-native-consent-20261017\profile`。
真实 Windows 插件管理窗口选择原候选目录后提示
`已安装 com.zicode.devtools.inspect`，列表由 19/19 变为 20/20；
搜索 `Inspect` 显示“ZiDevTools 格式与检查”0.1.1 卡片。
安装后默认状态为“已禁用”，`pi.tools.register` 为“已拒绝”。
这证明隔离原生目录安装与插件管理展示，尚不能证明 8 个工具的原生
发现、执行或结果展示。computer-use 技能禁止代理更改应用内权限，
已请用户在该隔离窗口手动启用并允许 Pi 工具权限；日常安装版窗口
没有被操作。该窗口运行的是先前已构建的 Debug EXE，不包含本轮新增
Pi 文本结果引用 Host 源码。尚未生成阶段截图文件，观察来自实时窗口。
安装后只读扫描 `target` 为 29,909,881,426 B、task-scratch 为
1,020,539,889 B，未知项均为 0；E 盘可用 30,463,389,696 B。
隔离配置本身为 1,024 个文件、81,093,783 逻辑字节，仍用于后续原生
验收，暂不清理。卷余量变化不能全部归因于此安装。
安装后还对隔离配置内的
`data/plugins/developer/com.zicode.devtools.inspect` 运行同一只读核验：
`verified:true`，606 文件、2,319,279 字节，目录索引匹配；
`signatureVerified:false`。因此已安装副本与原候选收据一致，
但此证据不改变未签名与尚未原生执行的结论。

## 后续：用户启用后的 8 项原生工具流程（2026-10-17）

用户在隔离 Debug 窗口手动启用主开关并允许 `pi.tools.register`；只读复核
`registry.json` 为 `enabled:true`、`pi.tools.register:true`，原生插件管理卡片
也显示“已启用”“已允许”。代理没有更改权限设置。

在同一 `--tools-only` 隔离窗口，工具中心由加载前 16 项变成 24 项，
Inspect 0.1.1 的 8 项均可从目录搜索或滚动找到。逐项点击“打开工具”
后才加载输入表单，输入固定的非敏感样例并在原生窗口执行，看到“工具执行成功”
和下表结果。逐项执行阶段未点击“预览保存”；结果接力的后续补验见下。

| 工具 | 样例 | 原生窗口显示的结果摘要 |
| --- | --- | --- |
| IPv4 CIDR | `192.168.1.10/24` | 网络 `192.168.1.0/24`，掩码 `255.255.255.0`，254 个可用地址 |
| HEX / RGB / HSL | `#336699` | `rgb(51, 102, 153)`、`hsl(210, 50%, 40%)` |
| JSON → YAML | `{"name":"zi","count":2}` | `count: 2`、`name: zi` |
| YAML → JSON | `name: zi` 加 `count: 2` | `{ "count": 2, "name": "zi" }` |
| JWT 内容 | 仅含 `alg:none`、`sub:demo` 的合成令牌 | 显示 Header/Payload，并明确提示未验证签名、有效期或可信度 |
| Unicode 码点 | `Zi中😀` | `U+005A`、`U+0069`、`U+4E2D`、`U+1F600` 及 UTF-8 字节 |
| NFC 规范化 | 分解形式 `e` + U+0301 | `é` |
| NFKC 规范化 | 全角 `ＡＢＣ１２３` | `ABC123` |

视口 1442×931、浅色主题；原生 NFKC 输入/成功结果/保存及转交入口的
可见截图归档在技术博客项目
`screenshots/inspect-011-native-2026-10-17/nfkc-result.jpg`。
这是旧 Debug EXE 上的 **8/8 开发候选单次原生发现→按需加载→执行→展示**，
不代表签名包安装升级/撤权、Pi 模型自主调用、跨独立插件转交/保存、错误/超时/取消、
多轮稳定性或其他 OS 验收。DevTools 全量正式接受数仍为 0/154。

### 原生同包结果接力补验

在 NFKC 的 `ABC123` 成功结果上点击“发送到工具”，原生面板列出 8 项
兼容文本接收能力。选中同包 `Unicode 码点` 的 `text` 字段，预览显示
接收工具、0.1.1 版本、字段、6 字节和待发送原文；预览阶段未执行。
明确点击“确认发送并执行”后，接收 Worker 返回 `A` 的 `U+0041`、
`B` 的 `U+0042`、`C` 的 `U+0043` 及数字码点；Studio 展示“接收工具
处理结果”与新的保存/再次发送入口。代表性浅色主题 1442×931 截图归档
`screenshots/inspect-011-native-2026-10-17/nfkc-to-unicode-result.jpg`。
没有点击保存、覆盖或写入，也没有发送给模型。该路径证明旧 Debug EXE
与无签名候选的一次 **同包** 明确确认接力；不证明跨独立插件、接力撤权、
错误/超时/取消或本轮新 Host 并发修复的原生行为。
