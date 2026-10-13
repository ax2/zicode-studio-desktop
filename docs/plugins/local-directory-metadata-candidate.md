# 本地目录元数据资源候选 draft1

2026-10-13。Studio 可信桌面 Host 的候选能力，用于让用户把项目内一个目录的**单层名称与类型**明确共享给一个 WASI 工具。它不是完整 `resource.v1`、归档目录授权或 ZiFile 接入验收。

## 选择与授权

可信工作区窗口可通过 `select_project_resource_directory` 打开系统文件夹选择器；只返回当前项目内的相对目录名，项目根目录为 `.`。选择不枚举条目，也不授权插件。项目或窗口变化时拒绝返回。

`POST /v2/plugin-resources/prepare-local-directory` 请求 `{schemaVersion:1,owner,relativePath}`。仅桌面令牌可调用，要求活跃 Host 工具会话、WASI `resource.wasi.input.draft2`、已有 `resource.read` 与另行声明且已授予的 `resource.directory.read`。路径必须为 `.` 或有效的项目相对路径；不能是绝对路径、父目录、链接或特殊设备。准备阶段只核对目录对象元数据和授权，不读取条目名。返回一次性 `grantId`、相对路径和 `entryNamesRead:false`，有效期120秒。

`POST /v2/plugin-resources/commit-local-directory` 携带 `{schemaVersion:1,owner,grantId,confirmed:true}`。票据先消耗；重新核对工作区、会话、插件版本/权限、目录身份后，才枚举单层条目。最多4096项，序列化结果最多2MiB，限时30秒。已观察到的符号链接、非普通文件/目录、无法表示为安全相对名的条目会使整个快照失败；cap-std 将相对访问约束在项目目录句柄下。资源内容是 UTF-8 JSON：`{schemaVersion:1,profile:"resource.local-directory.draft1",entries:[{name,kind}]}`，以 `text/plain` 形式存入现有可撤销的资源 Store。结果只包含名称和 `file`/`directory` 类型，不含绝对路径或文件内容。

`POST /v2/plugin-resources/cancel-local-directory` 可取消待确认票据，并在枚举中请求协作式取消。若操作已发布，不能靠旧票据撤回资源；应使用资源撤销接口。响应中断不能推断未发布，客户端不得自动重放确认。目录读取使用现有有界阻塞操作池，取消无法强行中断正在等待的单次 OS 目录调用。

## 当前边界

此能力已接入 Host 路由、Tauri 目录选择命令与可信网关；还没有面向用户的目录共享界面，也不向插件 iframe 直接开放目录 API。它只提供单层元数据，不读取目录内文件、递归内容、归档条目或密码，不授权解压目标目录或任意写入。大目录、网络文件系统、跨平台实体选择器与长时间取消仍须单独验收。ZiFile 18×6 矩阵接受数保持0。
