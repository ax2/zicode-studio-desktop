# ZiDevTools 模型辅助预览插件 0.1.0

这是 `agent-runner` 独立工具的一个很小的 Studio View 子能力候选：由用户手动填写任务目标和最多 32 项文字资料，选择当前 Studio 场景模型，并逐次查看 Host 确认对话框中的完整待发送内容。回答只留在当前 View 内存中。

## Host profile 与权限

清单使用 schemaVersion 2，要求：

- `model.catalog.read.v1 = 1.0.0-preview.1`
- `model.generate.v1 = 1.0.0-preview.1`
- `model.catalog.read` 和 `model.generate` 两项权限

界面通过公开 SDK 的 `window.zicode.services.models.list()` 与 `window.zicode.services.models.generate(input)` 调用 Studio。没有 WASI Worker、Pi Tool 或任何 DevTools HTTP/进程后门。模型目录只在用户点击“读取模型”后请求。

## 输入与用户数据

- 任务目标最多 2048 UTF-8 字节；最多 32 项资料，资料文字合计最多 32768 UTF-8 字节。
- View 页面为单文件 `views/main.html`；脚本、样式和输入校验都内联，以兼容 Studio 的 `iframe.srcdoc` 与 `script-src 'unsafe-inline'` 策略，不引用相对脚本或网络资源。
- 每项资料均由用户在该 View 粘贴/输入，名称和稳定 ID 在本次 View 内创建。`sourceKind` 固定为 `user_text`，`trust` 固定为 `untrusted_user_material`。标签只是提供方声明，Studio Host 不证明它真实来自某个文件或其他工具。
- 用户点击生成后，Studio 将显示完整模型名称、目标域名和待发送 JSON 文本，并要求一次确认。拒绝不会发起模型网络请求。
- 生成上限为 1–4096 token，截止时间为 1–120 秒。当前 Host 模型请求不能运行中取消；关闭 View 可阻止结果返回，但不能保证已经发送的远端请求停止。
- 页面不保存资料或回答，不读写剪贴板、文件、索引、历史会话，也不收集其他 View 内容。

## 不覆盖的 Agent Runner 能力

本 View 不实现 MCP 服务器发现/权限批准/工具调用、知识库检索与可验证引用、多步计划、待批准执行、工具白名单与调用预算、任务中心状态/取消、文件选择和跨工具结果接力、保存/恢复的 Agent 运行记录。它不能代替独立 ZiDevTools 中的完整 Agent 工作台；这些范围仍需适当的 Host 协议或资源接口及单独验收。

## 交付状态

该目录是 unsigned provider candidate。提供方包与 View 的静态检查、字节边界单元测试和渲染预览不等于 Studio 安装、权限撤销、原生系统确认对话框或模型服务端到端验收。当前没有获得发布者签名私钥，不能生成签名容器或宣称 Studio 已接受。

Standalone ZiDevTools 保持完全独立。本 View 不更改现有桌面工具、用户配置、知识索引或 Agent 数据格式。
