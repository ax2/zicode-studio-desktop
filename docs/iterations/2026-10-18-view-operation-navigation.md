# View 操作目录与主 View 定位（2026-10-18）

## 目标与实现

在 Studio 内把 Host 的 `view.operation.directory.v1` 行接入工具中心和命令面板。可搜索、分类、收藏、最近使用；View 操作显示“在应用中打开”，不进入 capability 详情或执行表单。点击时使用原目录修订向 Host 重新核对操作身份、插件版本、场景与工作区，确认当前插件已启用、profile 与主 View 声明仍匹配，然后导航到相应主 View。第二个主 View 由 View Host 单独挂载。

View Host 使用独立的 `openViewOperation` / `openViewOperationResult` 消息，沙箱 SDK 的 `navigation.onOpenViewOperation` 仅接收操作 ID。回执只能是 `opened`、`not_found`、`unsupported`；缺少处理器 4 秒返回 `unsupported`，Studio 5 秒超时。匹配当前帧、请求、版本与工作区且返回 `opened` 后才写最近使用。没有扩展 Pi/Worker 执行或文件、网络、模型权限。

## 验证与边界

TypeScript 类型检查、项目 `bun run check` 通过。View Host/注册表/旧工具定位 44/44；工具中心、命令面板、网关、Shell 集成 114/114；第二主 View 增补后 View 协议与 Shell 44/44；最终改动后目录与 Shell 专项 84/84。专项含错误类型分流、错回执、过期选择、停用、超时、工具表单不加载和能力不执行。`bun run build:local` 使用原 Debug 目录、无 bundle，构建成功且 EXE 位于 `target/debug/zicode-studio-desktop.exe`。实际 Debug 进程路径核对为该 EXE；1442×931 稳定截图检查搜索、分类、收藏和双列卡片可读，见技术博客 `screenshots/view-operation-navigation-2026-10-18/studio-debug-tool-center-1442x931.jpg`。当前用户目录没有声明新 profile 的提供方包，因此截图仅证明 Studio 目录基线布局，不证明原生 View 条目定位。真实新 DevTools 包、原生 View 条目截图及真实 `onOpenViewOperation` 提供方实现仍待验收；完整 DevTools 接受 **0/154**。

只读空间扫描前态 `target` 22,552,100,580 逻辑字节、task scratch 2,699,496,212、E: 空闲 56,609,841,152；后态 `target` 22,555,258,634、task scratch 不变、E: 空闲 63,167,180,800。`target` 逻辑量增 3,158,054 字节；卷空闲变化不归因于本次构建。未删除有用缓存、未生成 ZIP、未改应用版本。

## 后续：隔离 Host HTTP 目录入口

Studio 自有临时 View 插件夹具通过真实 `/v2/plugin-tool-directory` HTTP 路由读取：默认查询返回 0 条；显式 `includeViewOperations=true` 后按“服务健康”搜出 1 条，带独立 `operationId`、`viewId`、分类和来源，并保持禁用状态。对相同 ID 请求 capability 详情返回 `404 tool_unavailable`，未启动 Worker。验证仅使用隔离 Host 和临时目录，不安装到用户配置，不改变插件权限。`real_http_view_directory_is_opt_in_and_cannot_load_a_capability` 单项 1/1 通过；首次断言误取内建来源，改为按夹具插件 ID 核对后通过。此项验证覆盖 Host HTTP 发现与隔离边界，仍不等于真实提供方 View 的原生点击、定位和执行验收。

`bun run check:rust:static` 的 Cargo check 与 Clippy 通过，fmt 仅报告格式漂移建议，脚本退出 0；本次未对已有大范围未提交 Rust 修改自动格式化。`git diff --check` 通过。后态只读空间扫描：`target` 22,554,848,257 逻辑字节、task scratch 2,699,571,720、E: 空闲 63,104,241,664；相对本轮前态 `target` 减少 410,377 字节、task scratch 增加 75,508 字节。卷空闲差异不归因于单一测试，未清理现有缓存。

## DevTools 0.1.3 候选接收

提供方原会话交付两份未签名候选。Studio 独立逐文件重算原目录及冻结副本的大小、SHA-256 和目录索引摘要，均与包外收据相符；冻结位置 `tests/fixtures/devtools-view-operation-2026-10-18/`，未修改 DevTools 源码或原候选。

| 候选 | 文件 | 字节 | 目录索引 SHA-256 | View 操作 |
| --- | ---: | ---: | --- | ---: |
| Agent Assist 0.1.3 candidate-01 | 13 | 79,409 | `9b7e7dee63fbdad60b178d597754c05dfd587a824874ae33282352b3ef010c63` | 2 |
| Spring Actuator 0.1.3 candidate-01 | 49 | 246,194 | `74f6bab2ed7c9ddbee2857aeac7cf4d875eda642900afbb0fb4fec31102f97cc` | 4 |

隔离 `HostMode::IsolatedDesktop` 对冻结候选执行 `install_developer` 后，通过真实 HTTP 查询确认旧目录默认排除 View 操作，显式开关分别返回 2/4 条，状态均为禁用，且不暴露 `capabilityId`、不启动 Worker；Rust 单项 `frozen_devtools_view_candidates_are_discoverable_through_real_host_http` 1/1 通过。此为 Studio 清单准入与目录发现证据，不代表已在原生 UI 启用、定位、运行模型或网络请求，也不代表签名发行包验收。完整 DevTools 接受仍 **0/154**。

Studio 自有 `verify-devtools-package.mjs` 对两份冻结副本再验均退出 0，返回 `verified=true`、目录索引 `matched`，并明确 `signatureVerified=false`、`runtimeAccepted=false`。新增 Rust 用例后 `bun run check:rust:static` 的 Cargo check、Clippy 继续通过；fmt 仍仅有建议级漂移。后态扫描 `target` 22,554,873,857 逻辑字节、task scratch 2,699,571,720、E: 空闲 63,104,909,312。未删除缓存或生成 ZIP。

开发平台检查现增加只读 `devtools-view-candidate-receipts` 门槛，在 Rust 全量用例之前核验两份冻结副本的逐文件收据、目录索引摘要、版本、profile 与 2/4 项 View 声明。脚本输出明确 `signatureVerified=false` 和 `runtimeAccepted=false`，不把候选准入当正式运行验收。独立脚本通过，`developer-platform-checks.test.js` 9/9、项目 `bun run check` 退出 0；该检查仍报告其他未提交文件的建议级 lint 与设计警告，没有自动改动它们。

Studio 接收方随后对两份 0.1.3 冻结页面补了脚本级证据：逐文件收据重验后，主 View 在 `allow-scripts`、`connect-src 'none'` 的 Studio iframe 中挂载；六个包内真实操作 ID 经单独 `openViewOperation` 消息发送与绑定帧回执，不带 `capabilityId`；页面脚本回调分别定位到 Agent 的模型读取/生成区，以及 Spring 的指标端点/摘要，未知 ID 返回 `not_found`，定位未自动调用模型或 HTTP，`pagehide` 注销处理器。`devtools-view-operation-candidates.test.js` 4/4 与 `bun run check` 退出 0。这里的 iframe 消息与页面脚本在隔离 DOM 中分别验证，未声称真实原生 WebView 的完整端到端定位或用户权限验收。

进一步把 Studio 当前 `sandboxBridge` 函数注入两份冻结 HTML，在同一隔离 DOM 内传入 Host 上下文、向 Spring 回复 `getContext`，随后发送实际 `openViewOperation` 帧；两页均从各自回调返回 `openViewOperationResult=opened`，焦点与端点正确，期间未发 `listModels`、`generateModel` 或 `httpGet` 请求。最终专项 6/6，`bun run check` 退出 0。这比前述分层模拟多覆盖 SDK → 页面回调 → 回执的消息闭环，但仍不替代 Tauri 原生 WebView 安装和真实用户授权验收。

本次 JS 专项前后只读扫描中，`target` 22,554,936,833 和 task scratch 2,704,233,680 逻辑字节均未变化；E: 空闲从 63,096,848,384 变为 63,097,417,728，卷空闲波动不归因于测试。未复制运行目录、清理缓存或生成 ZIP。

开发平台脚本现把上述 6 项冻结页面与当前沙箱桥接专项列为非建议级独立门槛 `devtools-view-navigation-candidates`，位于 Rust 全量用例之前；四系统矩阵使用同一脚本。门槛定义测试 9/9、页面专项 6/6，本机合计 15/15，`bun run check` 退出 0。此处只确认 Windows 本机执行，macOS/Linux CI 尚无新运行收据，不能据此称跨平台原生接入已验收。门槛修改前后 E: 空闲 63,088,410,624 → 63,088,787,456 字节；未执行 Rust 构建或复制 EXE。
