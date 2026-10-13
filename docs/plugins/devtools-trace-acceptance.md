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

真实 Studio 原生 View、全部边界与错误向量、签名安装/更新/回滚、取消和超时、结果接力、其他 OS 均待验收。提供方有 59 条原生/WASI 证据；本次 Studio 只实际执行了两条基本样例和权限生命周期，不能据此继承 59 条完整结论。提供方应交付正式签名容器；Studio 继续验收完整 View/Worker/生命周期。154 项源工具的完整接受数仍为 0。
