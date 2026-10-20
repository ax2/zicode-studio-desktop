# DevTools 环境诊断接口需求

## 目标

推进 `java-environment` 与 `django-environment` 的插件化适配，为 Studio 内的受限本机环境探测定义正式边界；DevTools 独立程序继续使用其本机实现。

## 发现

- 两个目录条目当前均标为 `await_host_extension`，旧表述要求受控进程 Host 与任意可信程序参数策略。
- Studio 已有内部 `workspace_environment` Host 操作和固定版本探测器，但输出含绝对可执行文件路径，探测范围比插件请求范围更广，不能直接复用为插件响应。
- `java-environment` 需要 JAVA_HOME 对照；`django-environment` 需要在隔离 Python 下检查 Django 包。这些行为都不能通过插件传任意命令补齐。
- 现有 Tauri 对话框只由应用 command 发起；HostServer 不能直接弹出原生文件选择器。可信程序选择必须走父页面/原生 command 桥，并校验窗口 workspace、插件 profile 与权限，不能设计成普通 HTTP route。

## 修改

- 新增 `docs/plugins/devtools-environment-interface-request.md`，提出 `service.environment.inspect.v1`、`environment.inspect` 权限、workspace 相对路径、Host 原生选择器签发 opaque 程序引用、固定 inspection ID/参数、逐次用户确认、owner-bound 取消、输出脱敏、容量上限、审计和提供方交付验收要求。
- 首版目标覆盖来源工具主要 scope：JDK/JAVA_HOME 对比、Maven/Gradle 入口发现、Python `-I` 固定脚本检查及 Django 分发/脚本目录和双环境对比。Host 内置固定脚本，不接受插件命令或参数，也不加载项目 settings。
- 选择可信程序改为 Tauri 原生 command，由它签发 Host opaque ref；HTTP 仅处理 inspection prepare/commit/cancel，避免把原生文件对话框错误建模成 Host HTTP API。
- 更新 DevTools 阻塞清单、机器可读矩阵和总目标入口，区分 Studio 现有内部探测与尚不存在的插件 Host profile。

## 验证

- `devtools-all-tools-matrix.json` 经 PowerShell `ConvertFrom-Json` 解析；Java 与 Django 两条仍为 `await_host_extension`，`acceptedFullTool` 未变。
- `git diff --check` 未报告空白错误；仅检查本轮文档改动。
- 未修改 ZiDevTools，未运行构建或测试；当前只是接口草案，不能宣称已接入环境诊断工具。

## 遗留

- Studio 尚未实现 profile、权限 UI、调用生命周期、审计或 Host/Pi/View 验收。
- DevTools 提供方尚未确认接口或交付独立插件 View、manifest 和 fixtures。
- 完整 ZiDevTools scope 仍为 0/154。
