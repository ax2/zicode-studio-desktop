# DevTools 环境诊断插件接口需求

状态：Studio 接口需求草案，尚未实现 Host profile，也未由 DevTools 提供方确认。

## 目标范围

为 `java-environment` 与 `django-environment` 提供可独立打包的诊断工具，使它们在 ZiCode Studio 内运行时由 Studio Host 执行有限、可审计的本机检查；DevTools 独立程序继续保留自己的实现。插件不得依赖或启动 `DevTools.exe`。

当前 Studio 已有项目环境探测器，可识别一组固定工具并使用受限输出和超时；它是桌面内部能力，不是插件 API。该实现会返回绝对可执行文件路径并探测多种工具，因此不能原样暴露给插件。本需求要求新的插件投影只返回被允许的诊断字段。

## 拟议 Host 契约

- Profile：`service.environment.inspect.v1`，首个版本 `1.0.0-preview.1`。
- 权限：`environment.inspect`。安装时说明将检查用户指定项目目录中的哪些运行时；启用前由用户授予，用户可在插件设置中撤销。
- Host 提供受控的原生“选择可信程序/目录”操作，用户直接从系统文件选择器选择目标；返回只在当前 workspace/runtime/session/plugin 内有效的短期 opaque ref。绝对路径保留在 Host 内，不能通过插件 View、日志或 JSON 返回。ref 在项目切换、窗口关闭、权限撤销、插件卸载后失效。
- 文件/目录选择不能由纯 HTTP Host 路由发起：当前 HostServer 不持有 Tauri `AppHandle`，而 Studio 的系统对话框由 Tauri command 管理。因此选择应由 Studio 父页面的可信原生桥调用类似 `select_plugin_environment_target` 的 Tauri command；它需核验当前窗口 workspace、插件启用状态、profile 和 `environment.inspect` 授权，再弹出文件/目录选择器并让 Host 签发 opaque ref。Tauri command 只返回 ref 与安全显示名，不返回路径，也不启动所选程序。插件不得后台触发或反复弹出选择器。
- `selectionKind` 限定为 `java.executable`、`python.executable`、`jdk.home`；Host 检查选择目标是可读的本机文件/目录，拒绝网络路径、非本地路径和不匹配的目标类型。
- 路由：`POST /v2/plugin-services/environment-inspect/prepare`、`/commit`、`/cancel`。运行身份由 Studio Host 校验，所有 grant 与 operation 绑定 workspace、runtime、session、plugin；撤权、停用、卸载或窗口关闭时取消在途调用。
- Prepare 只接收 `schemaVersion`、Host 颁发的运行身份、workspace 相对 `directory`、枚举 `inspectionId`、Host opaque refs 和唯一 `operationId`；拒绝未知字段、绝对路径、越界目录、重复或未知 inspection ID、无效或跨 owner ref。
- Commit 只接受短时有效且属于同一运行身份的 grant，并要求页面上的明确确认。确认内容显示项目相对目录、程序类别和固定检查名称，不显示绝对路径或原始命令行。
- inspection ID 是协议枚举，不是命令名。Host 为每项检查固定可执行文件类型、参数、工作目录、环境变量过滤和输出解析；插件不得传可执行文件路径、参数、shell 片段、环境变量或任意工作目录。不可回退到 `DevTools.exe` 或通用 `process.spawn`。
- 首版需覆盖来源工具的完整边界：JDK 检查从用户选择的可信 `java` 执行固定属性检查，并支持用户另选 `JAVA_HOME` 目录进行对比；Maven/Gradle 只做原工具承诺的入口发现；Django 检查从用户选择的可信 Python 执行 Host 内置的固定隔离脚本，使用 `-I` 检查解释器/venv/Django 分发和脚本目录，可比较两组用户选择的 Python；脚本不得加载项目 settings。Host 必须逐平台固定参数并评审输出语义，不能让插件拼接脚本或命令。
- 单次 operation 只允许一个 inspection ID，成组对比由专用枚举操作一次性表达；同一插件最多 1 个在途 operation；每个子进程超时 3 秒、stdout/stderr 各不超过 16 KiB、总 operation 最长 12 秒、总返回不超过 48 KiB。输出只包含固定 schema 的诊断字段、枚举 `status`、截断后的版本文本和枚举 `source`，不得返回绝对可执行文件路径、环境变量、项目 manifest、完整 stdout/stderr 或凭据。
- Cancel 通过 owner-bound operation ID 终止进程树；终态及超时、取消、撤权原因进入有容量上限的审计日志。插件错误以稳定错误码返回，不能阻塞 Studio 主窗口或其他插件。

## 结果格式

成功响应示例（inspection-specific 结果字段由最终 schema 冻结）：

```json
{
  "schemaVersion": 1,
  "operation": "environment.inspect",
  "result": {
    "inspectionId": "java.info",
    "status": "available",
    "diagnostics": {"javaVersion": "21.0.2", "javaHomeMatches": true}
  }
}
```

状态仅允许 `available`、`missing`、`unverified`、`invalid-environment`、`failed`、`timed-out`、`cancelled`。诊断文本按 UTF-8 安全截断。错误响应使用稳定错误码，例如 `permission_denied`、`directory_invalid`、`program_ref_invalid`、`inspection_not_allowed`、`operation_busy`、`operation_cancelled`、`probe_failed`、`audit_unavailable`。

## 提供方交付要求

DevTools 提供方需为这两个工具分别交付独立 View 和 manifest：声明精确 profile 版本及权限；每个字段展示来源与缺失状态；支持确认、等待、取消、失败重试和权限撤销提示；不读取环境变量或自行执行本机命令。另提供正反向 fixtures、最大输出、超时、并发和取消场景，以及与独立程序当前功能的逐项 scope 映射。

## Studio 验收门槛

Studio 需在实现 profile 后完成：manifest 兼容性与权限拒绝测试；workspace 路径穿越/符号链接边界测试；固定 ID 与未知字段拒绝；确认前零进程启动；进程树回收、超时、取消、撤权和卸载竞态；输出截断和审计故障；真实 Host、Pi、隔离 View 的端到端发现、加载、执行和结果展示；Windows、macOS、Linux 各自的可执行文件解析与真实运行验收。通过前，矩阵仍标记 `await_host_extension`，完整工具接受数不变。
