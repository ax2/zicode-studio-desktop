# 本地目录元数据资源候选 draft1

2026-10-17 后续句柄加固：逐级元数据预检查之后，最终打开改用
`open_dir_nofollow`，Windows 对已打开句柄再次检查重解析点属性。
本机替换路径回归先观察普通目录、再以同名链接替换，最终打开被拒绝；
目录模块 4/4 和 Rust 静态检查通过。该证据不覆盖所有并发竞态、junction
类别或其他系统，也不把单层元数据提升为完整目录树资源。
见[阶段记录](../iterations/2026-10-17-directory-handle-nofollow.md)。

2026-10-13。Studio 可信桌面 Host 的候选能力，用于让用户把项目内一个目录的**单层名称与类型**明确共享给一个 WASI 工具。它不是完整 `resource.v1`、归档目录授权或 ZiFile 接入验收。

## 选择与授权

可信工作区窗口可通过 `select_project_resource_directory` 打开系统文件夹选择器；只返回当前项目内的相对目录名，项目根目录为 `.`。选择不枚举条目，也不授权插件。项目或窗口变化时拒绝返回。

`POST /v2/plugin-resources/prepare-local-directory` 请求 `{schemaVersion:1,owner,relativePath}`。仅桌面令牌可调用，要求活跃 Host 工具会话、WASI `resource.wasi.input.draft2`、已有 `resource.read` 与另行声明且已授予的 `resource.directory.read`。路径必须为 `.` 或有效的项目相对路径；不能是绝对路径、父目录、链接或特殊设备。准备阶段只核对目录对象元数据和授权，不读取条目名。返回一次性 `grantId`、相对路径和 `entryNamesRead:false`，有效期120秒。

`POST /v2/plugin-resources/commit-local-directory` 携带 `{schemaVersion:1,owner,grantId,confirmed:true}`。票据先消耗；重新核对工作区、会话、插件版本/权限、目录身份后，才枚举单层条目。最多4096项，序列化结果最多2MiB，限时30秒。已观察到的符号链接、非普通文件/目录、无法表示为安全相对名的条目会使整个快照失败；cap-std 将相对访问约束在项目目录句柄下。资源内容是 UTF-8 JSON：`{schemaVersion:1,profile:"resource.local-directory.draft1",entries:[{name,kind}]}`，以 `text/plain` 形式存入现有可撤销的资源 Store。结果只包含名称和 `file`/`directory` 类型，不含绝对路径或文件内容。

2026-10-17 加固：Windows 逐级打开相对目录及枚举单层条目时，均检查元数据的 `FILE_ATTRIBUTE_REPARSE_POINT`；junction 和其他重解析点按不支持处理，不能仅依赖 `is_symlink()`。Windows 实际目录符号链接回归验证了中间路径与枚举条目两处拒绝，原有单层快照与 Host HTTP 授权流程保持通过。此回归不等于所有 junction 类型、路径替换竞态或其他系统都完成验收；详见[阶段记录](../iterations/2026-10-17-directory-reparse-guard.md)。

`POST /v2/plugin-resources/cancel-local-directory` 可取消待确认票据，并在枚举中请求协作式取消。若操作已发布，不能靠旧票据撤回资源；应使用资源撤销接口。响应中断不能推断未发布，客户端不得自动重放确认。目录读取使用现有有界阻塞操作池，取消无法强行中断正在等待的单次 OS 目录调用。

## 当前边界

此能力已接入 Host 路由、Tauri 目录选择命令、可信网关和工具中心的项目目录模式。只有声明并获授 `resource.directory.read` 的 WASI 工具才显示目录入口；用户依次选择目录、确认共享、点击执行。切换回文件模式、取消或关闭工具会取消未确认票据并撤销已发布资源；确认响应迟到时撤销返回的资源。

2026-10-13 的 Windows 原生 Studio debug EXE 验证了自制 WASI 验收插件的发现、安装、权限授予、搜索、按需加载、原生目录选择、确认 2 个单层条目、真实 Worker 执行及结果展示 `{"value":"directory"}`。结果留在工具界面，未保存或写入项目。前端原先使用 `JSON.stringify` 比较 owner，Rust JSON 字段排序造成准备响应误拒；改为逐字段比较后复验通过，回归测试覆盖不同字段顺序。另有 Host→Worker 实际专项通过。上述是 Studio 自制插件的候选能力验收，仍未通过实际 ZiFile 提供方插件的端到端验收，不向插件 iframe 直接开放目录 API。

它只提供单层元数据，不读取目录内文件、递归内容、归档条目或密码，不授权解压目标目录或任意写入。大目录、网络文件系统、跨平台实体选择器与长时间取消仍须单独验收。ZiFile 18×6 矩阵接受数保持0。

## SHA256SUMS 文件夹核对预览

Studio 文件校验工具通过原生选择器准备最多 32 KiB 的 UTF-8 清单。Host 冻结 1–64 个普通文件名及其期望的 SHA-256。拒绝路径分隔符、控制字符、设备名、大小写折叠后重复的名称以及不合法的摘要。目录元数据仍使用原桌面 HTTP 流程。

只有启用且已授予 `resource.read` 的 `com.zicode.devtools.files/devtools.files.hash` 可使用该预览。系统选择器可选择本机文件夹，界面只收到文件夹名称。Host 在同一窗口、路由、工作区和工具会话下签发 `resource.local-directory.checksum.preview1` 的一次性票据，确认前只检查目录元数据。可移动磁盘也使用本地句柄，Windows 网络路径和映射网络盘、链接及目录重解析点会被拒绝。重复确认、过期、撤权或作用域变化都使票据无效。

确认后，Host 在受限目录句柄下按清单顺序分块读取普通文件。链接和重解析点标为读取失败。逐文件核对读前、读后及再次打开的身份。Host 要求重开目录与准备时匹配，确认时最多执行 30 秒。取消请求在读取分块和文件之间检查，等待中的单次系统读取由系统返回。未通过校验的读取结果不会交给插件。

可信页面收到带原名、期望摘要、实际摘要及状态的有序数组。状态为 `match`、`mismatch`、`missing` 或 `read_error`；后两种状态的实际摘要为 `null`。页面使用冻结版本的 `devtools.checksum-manifest.review` 候选执行比较。最多 16 条一批，每批只提交清单行和读出的文件名及摘要。确认票据、路径、文件字节、未列入清单的目录条目均不交给 Worker。Host 对缺失和读取错误给出各自状态，Worker 对未收到摘要的条目返回 `not_provided`。两层数据通过检查后再呈现全部行。

生成流程复用相同的桌面授权。使用原生多选器选择同一目录内 1–64 个普通文件，检查文件名、文件标识和生成清单的 32 KiB 上限。确认前只读取元数据。源文件变化、取消或撤权会中止生成，清单不会包含一部分选择。Host 将已确认文件的名称和摘要交给现有独立插件排序生成，可信页面核对完整结果。生成的清单可以继续用于校验。

另存使用经校验的 Host 结果快照，原生选择器建议文件名 `SHA256SUMS`。用户另行选择目标并确认，保存过程拒绝覆盖已有文件。确认后，校验和生成共用同一窗口的一次性凭据查询读取进度。响应只含已处理文件数、文件总数及当前文件的已读字节与大小。缺失和读取错误计入已处理数量，取消或完成后停止查询。长耗时数据和文件引用接力须分别完成验收。
