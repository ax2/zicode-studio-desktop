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

真实 Studio 原生 View、签名安装/更新/回滚、取消和超时、结果接力、其他 OS 均待验收。提供方应交付正式签名容器；154 项源工具的完整接受数仍为 0。

### 2026-10-14 冻结向量的 Studio Worker 复核

- 新增单独的忽略测试 `trace_candidate_vectors_through_studio_broker`，先按包外收据逐文件核对 346 个冻结文件，再经 Studio `CapabilityBroker` 和当前 Windows 生产 Worker 执行 `fixtures/trace.json` 的 40 条用例。隔离注册表与审计数据在测试后删除，仅保留不含输入文本的紧凑收据。
- 首次逐条按提供方错误码直接比较为 36/40。差异 4 条均在 Studio 输入 schema 前置验证被拒：两项 8193 字符输入超过插件声明的 8192 字符上限，以及两项 `text` 类型错误。Worker 没有收到这 4 条；Studio 返回 `invalid_parameters`，不是提供方的 `INPUT_TOO_LARGE` 或 `INVALID_INPUT`。
- 将这四条明确列为 Studio schema 拒绝，其余 36 条继续精确比对 Worker 的成功文本或业务错误码；最终复跑 40/40 符合各自层级预期，其中 **Worker 向量 36/36、Studio schema 拒绝 4/4**。这不等于 40 条提供方业务向量均通过 Worker，也不继承提供方 59 条原生/WASI 证据。最终收据保存在 `.cache/task-scratch/trace-vectors-0081ce9e-d727-43fb-bc43-d5ad9c80af6b/receipt.json`；首次差异收据 `trace-vectors-c799d7bd-428c-4478-bd3c-6d790d8c73c2/receipt.json`。
- 对外错误码映射尚需统一：Studio 的 schema 错误与提供方业务错误是两层协议；目前界面若要展示提供方的具体超长提示，须先定义宿主验证错误的标准映射，不应绕开 schema 直接把越界输入交给 Worker。
