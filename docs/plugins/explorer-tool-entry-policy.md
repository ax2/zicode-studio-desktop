# 资源管理器工具入口与 ZiFile 能力映射

2026-10-14。Studio 拥有系统菜单和工具选择界面；提供方插件只声明能力，不自行向 Explorer 注册每个工具。这样安装上百个工具时，系统菜单仍只有一个 Studio 入口，进入工具中心后按所选资源筛选、搜索、分类、收藏和最近使用。

## 当前实现

Windows 当前用户可选择安装五类**传统**菜单：文件、文件夹、文件夹背景、盘符，以及 2–4 个同目录普通文件的多选入口。前四项沿用静态 verb；第五项使用 Studio 自有 `IExplorerCommand` DLL 接收完整 `IShellItemArray`，交给 `--open-selection`，再筛选可接收该数量的 WASI 工具。打开入口只传递意图；文件元数据预览、内容授权、加载和执行分开确认。托盘右键提供全局工具中心和当前项目工具中心；后者只取可信项目登记路径，打开工具会话，不自动运行插件。

## 适合放在选择流程中的工具

| Explorer 场景 | 候选工具 | 显示门槛 | 执行门槛 |
| --- | --- | --- | --- |
| 单个归档文件 | ZiFile 格式探测、目录分页、完整性校验 | 插件声明该文件类型或通用探测，已启用且获准文件读取 | 用户确认文件快照、格式与密码引用；目录分页需绑定内容版本 |
| 单个归档文件 | ZiFile 解压 | 同上，另需目标目录写入能力 | 先预览目标、冲突、展开预算和危险路径，再由用户确认提交 |
| 多个普通文件 | ZiFile 创建归档 | 插件声明 `resourceInputMax` 覆盖选中数且支持这些来源类型 | 逐文件确认、格式/等级/加密选项及目标写入预览；目录树输入另需协议 |
| 单个文件 | DevTools 文件哈希、编码/解析、图片处理等 | 每个能力实际声明支持的输入类型和大小，而非按产品名推断 | 用户确认读取；派生结果可接力，保存需单独确认 |
| 文件夹或背景 | ZiFile 快速创建、批量处理 | 目录内容授权和数量/字节预算协议完成 | 预览扫描与目标，明确处理冲突；不从单层目录元数据推断可读取整棵树 |
| 盘符 | 打开该位置的工具中心 | 仅作为导航；盘根沿用 Studio 默认工作区保护 | 不自动扫描整盘或运行工具 |

第一批菜单始终只显示“在 Studio 中选择工具”。格式探测后可在工具中心给出适用候选，不把“解压”“快速创建”等动作直接放入系统菜单，直到真实 ZiFile 插件通过格式、权限、取消和写入验收。未知后缀的工具可留在目录供用户自行选择，但不能显示为已兼容或自动运行。

## Windows 多选与现代菜单的独立工作

传统静态 verb 的选择模型能控制显示数量，但现有 `%1` 命令不会给 Studio 一次传递完整 `IShellItemArray`；将 `MultiSelectModel` 改成 `Player` 不等于完成多选交接。现已用独立 COM `IExplorerCommand` 接收选中集合、检查 2–4 个同目录本地普通文件，再交给已有 `--open-selection`；超出范围隐藏或拒绝，不拆成多个窗口。Windows 11 现代一级菜单另需与应用包身份和扩展注册配套，不能把当前传统菜单称为现代一级菜单。参考 [微软选择模型](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-employ-the-verb-selection-model) 与 [打包桌面应用的 Explorer 菜单](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer)。

Shell 扩展只做有界参数交接，不在 Explorer 进程加载插件或处理归档；Studio 的菜单卸载会删除自身归属的注册项。当前开发 DLL 未单独签名，Windows 打包后 DLL 位置与卸载注册仍需验收。真实 COM 激活及 `IShellItemArray` 判定已验证；实体多选右键点击、现代一级菜单与 ZiFile 的 108 个格式操作单元均未验收。

## 给 ZiFile 提供方的接口需求

提供独立签名的 `com.zicode.zifile.archive` 插件包及每平台适配入口，逐能力声明格式、输入资源类型、最大输入数、读写权限、输出类型、超时与取消语义。列出/校验/创建/解压/更新/删除/重命名的请求、结果和限制按[完整矩阵](zifile-integration-matrix.json)与[接入要求](zifile-integration-requirements.md)交付。Studio 只接收版本化包和契约向量，不依赖 ZiFile 独立 EXE、Shell DLL、仓库源码或配置目录。提供方须解决 RAR 范围与许可冲突；Studio 还需完成受约束 native Worker、私有资源映射、稳定游标及写入事务。接收前 108 格均保持 `accepted=false`。
