# Zi DevTools Trace 候选接收与当前运行记录

日期：2026-10-13。Studio 仅接收版本化产物；DevTools 源码、配置和独立程序未被引用或修改。

## 接收

- 提供方目录：`release/trace-0.1.0-candidate-01`；Studio 冻结副本：`tests/fixtures/devtools-trace-candidate01/`，包外收据：同级 `devtools-trace-candidate01.verification.json`。
- 插件 `com.zicode.devtools.trace/0.1.0`，源工具 `java-trace` 与 `django-trace` 均为 1.0.3。两项操作分别是 `devtools.trace.java.trace` 和 `devtools.trace.django.trace`。
- 源目录与接收目录各自核对 346 个文件的存在、字节数和 SHA-256，合计 1,403,946 字节；收据声明的目录索引摘要为 `45dfdda2bb48f4878cc4166241db343bfc7a91c942e4fce3d7c6dd668b848ecd`。WASM SHA-256 为 `bb77ecac41351a9a8c3886dc0400c2705dd2003d3cfb52aa29e011d3ff43a35e`。
- 候选无签名，`packageSha256=null`。开发接收不等于正式插件安装、升级或发布；未更改签名门禁。

## Studio 当前验证

- 新增独立的 Trace Pi 验收入口，重用计算候选测试。2026-10-13 在 Windows 当前源码下运行该单例测试：1 通过、0 失败；10 个阶段含未授权、授权执行、撤权、恢复、禁用、重启用、再次撤权、卸载、重装拒绝与重装授权。
- Pi 实际搜索目录、按需加载两项工具并通过 Host/生产 Worker 执行。`java.trace`、`django.trace` 各一条基本样例返回与冻结预期完全相同的文本；最终复跑调用耗时分别 568ms、554ms。撤权等阶段记录 10 次拒绝，独立 Base64 插件 5 次对照调用成功。收据 `mechanismPassed=true`、`fullCandidateAccepted=false`；无失败阶段。该复跑还在运行前自动核对候选目录全部 346 文件的数量、字节数和摘要。
- 最终运行收据在 `.cache/task-scratch/trace-pi-d13a5c7b-2d89-48be-aa95-75b29f5e4d68/receipt.json`，含输入样例和动态目录阶段。首次运行收据 `trace-pi-b3693f12-3f20-40ee-8385-94ff1dd740b9/receipt.json` 也保留；两次均通过，不复制到发布包。
- `bun run check:rust:static` 的 cargo check、Clippy 均通过；项目级 rustfmt 检查报告既有格式偏移为 advisory，新增/改动的两份 Rust 测试文件单独 `rustfmt --check` 通过。

## 未验收和重开条件

原生窗口中的工具中心单链路与结果接力见下节补验。Trace 自定义插件 View 在原生窗口、签名安装/更新/回滚、取消和超时、其他 OS 均待验收。提供方应交付正式签名容器；154 项源工具的完整接受数仍为 0。

### 2026-10-14 Chromium 页面至 Host/Worker 的执行展示

- Studio 新增可重复的隔离 Host 验收入口 `trace_view_browser_invokes_actual_host_worker_and_displays_result` 和浏览器脚本 `scripts/qa-devtools-trace-view.mjs`。运行前按包外收据核对 Trace 候选全部 346 文件；Host 安装并启用开发候选，真实 Chrome 加载 Studio 的 `plugin-view-host.js`，插件 iframe 经页面 SDK 请求宿主，再由保留的 Studio Windows EXE 以生产 Worker 模式运行 WASI。
- Java 与 Django 两项示例均从页面按钮发起，分别在可见结果中检查 `NullPointerException` 与 `NoReverseMatch`；隔离测试 1/1 通过。收据与 1180×800、390×800 截图保存在技术博客档案 `screenshots/trace-view-2026-10-14/`。截图已人工查看：文本与结果可读，390px 窄屏需在 iframe 中继续向下滚动才能看到结果全文；验收容器底部有横向滚动条，需在正式原生窗口复核布局。
- 该阶段证据覆盖 Chromium 页面、Studio Host 和 Worker 的发现、加载、执行与结果展示。结果接力见下节补验；本阶段没有启动 Tauri 原生窗口，也没有验证签名插件安装、升级、回滚、取消或跨平台。正式接受数仍为 0/154。

### 2026-10-14 跨插件接力与确认保存补验

- 上述隔离 Host 测试再安装已冻结的 `com.zicode.devtools.text` 开发候选，并先按其包外收据核对文件。Trace Django 页面结果通过 Studio 可信父页面的“发送到工具”搜索真实接收能力 `devtools.text.json.format`；页面显示字段与 837 字节结果的预览，只有显式点选“确认发送并执行”后才经 Host/Worker 调用接收方。接收方格式化后的 JSON 在父页面可见，包含 `NoReverseMatch`。
- 接着对接收方结果执行“预览保存”→“确认保存”，页面收到已保存状态和产物入口。最终专项测试 1/1 通过；收据中的 `transferred=true`、`savedAfterConfirmation=true`，代表这条隔离工作区流程的观察结果。新增 1180×800 接收结果截图已人工查看，保存在技术博客同一 `screenshots/trace-view-2026-10-14/` 目录。
- 这两份仍是未签名开发候选；浏览器验收不代替原生 Tauri 窗口、正式签名安装/更新/回滚、跨平台或 154 项逐工具验收。正式接受数仍为 0/154。

### 2026-10-14 冻结向量的 Studio Worker 复核

- 新增单独的忽略测试 `trace_candidate_vectors_through_studio_broker`，先按包外收据逐文件核对 346 个冻结文件，再经 Studio `CapabilityBroker` 和当前 Windows 生产 Worker 执行 `fixtures/trace.json` 的 40 条用例。隔离注册表与审计数据在测试后删除，仅保留不含输入文本的紧凑收据。
- 首次逐条按提供方错误码直接比较为 36/40。差异 4 条均在 Studio 输入 schema 前置验证被拒：两项 8193 字符输入超过插件声明的 8192 字符上限，以及两项 `text` 类型错误。Worker 没有收到这 4 条；Studio 返回 `invalid_parameters`，不是提供方的 `INPUT_TOO_LARGE` 或 `INVALID_INPUT`。
- 将这四条明确列为 Studio schema 拒绝，其余 36 条继续精确比对 Worker 的成功文本或业务错误码；最终复跑 40/40 符合各自层级预期，其中 **Worker 向量 36/36、Studio schema 拒绝 4/4**。这不等于 40 条提供方业务向量均通过 Worker，也不继承提供方 59 条原生/WASI 证据。最终收据保存在 `.cache/task-scratch/trace-vectors-0081ce9e-d727-43fb-bc43-d5ad9c80af6b/receipt.json`；首次差异收据 `trace-vectors-c799d7bd-428c-4478-bd3c-6d790d8c73c2/receipt.json`。
- 对外错误码映射尚需统一：Studio 的 schema 错误与提供方业务错误是两层协议；目前界面若要展示提供方的具体超长提示，须先定义宿主验证错误的标准映射，不应绕开 schema 直接把越界输入交给 Worker。

### 2026-10-14 Windows 原生 WebView2 工具中心补验

- 使用仓库现有完整 debug EXE（应用版本 0.4.2）及专用 `--isolated-profile --tools-only`，在真实 Windows WebView2 工具中心安装、启用两份已冻结的未签名开发候选。准备测试在写入前限定目标为项目 `.cache/task-scratch` 下带本任务 `owner.json` 的目录，并逐文件核对候选收据。
- `scripts/qa-native-trace-view.mjs` 通过该 WebView2 调试端口驱动真实界面：目录中发现 Django Trace，按需打开参数表单，执行并显示 `NoReverseMatch`；选择另一插件的 `devtools.text.json.format`，检查接力预览，显式确认后执行并显示接收方结果；再预览保存、显式确认并取得产物入口。脚本返回 `passed=true`、`nativeWebView2=true`、`receiverExecuted=true`、`savedAfterConfirmation=true`。隔离档案内存在对应产物元数据与内容文件。
- 三张原生窗口截图在技术博客 `zicode-studio-desktop/screenshots/trace-native-2026-10-14/`，已检查结果、接收方结果和保存状态。测试进程已正常退出。细节见技术博客同日工作日志。
- 这是 **工具中心的原生 WebView2 单链路**；尚未验证 Trace 自定义 iframe View 在原生窗口中打开。EXE 是此前保留的构建，不能用此证明当前源码重新构建可运行。签名插件生命周期、所有工具、其他 OS、取消/超时与错误恢复仍待验收，DevTools 完整接受数仍为 0/154。

### 2026-10-14 解锁后当前 debug EXE 的原生复验

- 当前 `9a4a8cff` 源码构建的 `target/debug/zicode-studio-desktop.exe` 为 123,082,752 字节，SHA-256 `abaac5553ccf04e9c0477797d7d4c75346b54495343bb7d3a38d8c61fb8b9221`；应用版本仍为 0.4.2。复用原有 `trace-native-20261014/profile`，没有复制运行目录或重建程序。执行前将 profile 中的 Trace 346 文件、Text 13 文件逐一与 Studio 冻结夹具比较 SHA-256，均为 0 差异、无额外文件。
- 真实 Windows WebView2 工具中心出现 23 项（16 内置 + Trace 2 + Text 5）。手工打开 Text 的 Base64 编码，按需加载参数表单，输入合成文本 `ZiCode Studio`，实际 Worker 返回并在原生界面显示 `WmlDb2RlIFN0dWRpbw==`。点击“发送到工具”后列出 7 个兼容接收能力；选择同包 Base64 解码后先显示 20 字节预览，明确点击“确认发送并执行”才运行接收 Worker，结果为 `ZiCode Studio`。这次没有点击保存；不能把出现“预览保存”按钮记作本轮保存验收。
- 1442×931 浅色窗口截图已目视检查，归档于技术博客 `screenshots/devtools-native-resume-2026-10-14/base64-roundtrip.jpg`。详情与接力结果可读，没有观察到主界面崩溃。关闭窗口后其可见主窗消失而进程仍存活，符合当前关闭到托盘的路径；未直接观察实体托盘图标或右键菜单。完成后按 EXE 路径、隔离 profile 和参数校验进程身份，仅停止本轮调试进程。
- 此复验覆盖当前 EXE 上一条未签名开发候选的“发现 → 加载 → 执行 → 展示 → 经确认接力”。它不验证正式签名安装、当前 DevTools 独立版全部版本与范围、Trace 自定义 View、保存、系统托盘右键、其他系统或 154 项逐工具完整接受；计数保持 0/154，ZiFile 0/108。
