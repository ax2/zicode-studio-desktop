# Explorer 文件夹入口 v1

2026-10-13 后续：开发主分支将文件夹启动的目录工具提示和 `desktop_entry_mode` 绑定到本次启动的窗口及原 Host 会话；同项目的其他窗口不继承。源码静态与更新后的 EXE 验收状态以项目档案为准。2026-10-14 已补跨进程单实例交接，验证边界见 [交接记录](explorer-single-instance.md)。

2026-10-13 后续：选定文件夹启动的工具中心默认勾选“仅显示项目目录工具”，只改变 Host 目录搜索条件。可信 Tauri 命令检查当前窗口/项目绑定，并且仅在启动文件夹就是当前项目根目录时返回相对提示 `.`；盘符根目录及切换到其他项目均不默认筛选。检查失败或五秒超时恢复全部工具并提示可手动筛选。用户可取消筛选；查询不会列举目录、授权、加载或执行工具。前端42项定向用例、类型检查、47条命令权限、Rust静态与目录归属专项通过；本地debug EXE已更新。原生窗口已启动，但窗口激活被 LegionZone 遮挡，实际截图与鼠标操作尚未完成，不将组件用例代替原生验收。ZiFile实包接受仍0/108。

2026-10-11，Studio开发主分支；正式v0.4.2安装包不包含本功能。

## 可选安装与使用

当前Windows实现传统右键菜单，在Windows11通常位于“显示更多选项”。尚未实现一级现代菜单。本文记录最初的文件夹、目录背景和盘符入口；后续新增的单文件工具入口及四项统一注册见 [文件入口](explorer-file-entry.md)。多选和真实归档算法仍待接入。

2026-10-13 本机当前用户已显式安装四类传统菜单，安装前0/4、安装后状态4/4；这是本机注册验证，未完成资源管理器实体菜单点击和卸载验收。保留的debug EXE路径和检查证据见技术博客`iterations/explorer-live-install-2026-10-13/work-log.md`。

2026-10-13 实体复验修正：单文件夹传统菜单出现并成功传入`.zicode`测试文件夹；目录背景虽然状态为4/4，实际菜单最初没有Studio项。原因是背景verb写入了`MultiSelectModel=Single`，背景无选中项。安装逻辑现在仅为文件、文件夹、盘符设置该属性，背景项明确移除旧属性。新debug EXE对旧安装重新执行`--install-explorer-menu`后背景菜单实体可见，点击传入测试目录的`--open-folder "…\\."`；专项注册测试、Rust静态检查和本地构建通过。此入口按既有目录模式启动Pi；ZiFile工具仍未接入。盘符实体点击、卸载、现代一级菜单和其他OS继续待验。证据见技术博客`iterations/explorer-background-2026-10-13/work-log.md`。

2026-10-13 后续：实体文件夹入口曾额外自动打开 Agent Inbox，造成第二个窗口和 Pi。可信桌面命令`desktop_entry_mode`现区分常规、文件夹、文件、工具启动；文件夹入口跳过 Agent Inbox 启动/补建，所选项目仍照常获得 Pi，用户显式进入其他会话不受此自动启动判断影响。真实`--open-folder`启动后稳定观察为所选项目窗口1个、所属Pi1个、Agent Inbox自动窗口0个；页面显示测试目录。物理托盘右键已看到四项，但隐藏/恢复/退出未完成实体点击验收。详见技术博客`iterations/explorer-folder-inbox-2026-10-13/work-log.md`。

2026-10-13 盘符根目录保护：真实 Windows 11 的 E: 盘传统菜单中已看到 Studio 项，物理菜单点击仍未可靠验收。`--open-folder E:\\.` 的隔离首次启动虽为工具会话、Pi 为 0，却在盘根创建了 `.zicode/notes/.notes.lock`；因此盘符根目录现只作为启动意图，实际工具会话使用 Studio 默认工作区，不登记整盘为项目、不自动恢复 AI 或创建启动备份。普通文件夹入口仍进入所选项目。更新后隔离配置的工作区数据库只登记默认工作区，盘根目录时间戳未变化、Pi 为 0；最新 EXE 的窗口截图未取得，故此处只确认 Host/进程与数据库证据。磁盘根部第一次生成的目录保留待精确手工检查，自动删除被策略拒绝。详见技术博客`iterations/explorer-drive-root-2026-10-13/work-log.md`。

使用保留的当前debug或未来包含本功能的完整安装目录内EXE：

```powershell
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --explorer-menu-status
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --install-explorer-menu
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --remove-explorer-menu
```

普通启动不会注册菜单。安装/移除可在“设置 → 通用 → 桌面集成”核对状态后明确确认，或显式运行相应命令，不要求管理员权限。命令返回JSON及退出码（失败2）；不是调用另一程序。不要用旧正式0.4.2 EXE执行这些新参数。

目录也可直接传入：

```powershell
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --open-folder 'E:\my-project'
```

路径必须现存、绝对、本地盘、Unicode目录；拒绝UNC网络目录、相对路径、缺值、重复或与注册动作混用，不回退其他工作区。不自动恢复另一项目的会话。首次进入该目录为新的临时会话，不提交模型请求。

该入口启动的Studio进程禁用Pi自动发现外部扩展、技能、提示模板和主题；Studio显式内置扩展仍加载。它不是OS沙箱或只读模式，用户后续明确执行任务仍使用原授权规则；普通启动的发现策略不变。当前开发源码在已有进程时会交接启动意图；Windows直接参数启动的交接已验证，实体右键与托盘图标数量仍待验收。

## 注册边界

最初的目录入口在HKCU下三个固定键（当前另含 `*\shell\ZiCodeStudio.OpenFile` 文件入口）：

- `Software\Classes\Directory\shell\ZiCodeStudio.OpenFolder`
- `Software\Classes\Directory\Background\shell\ZiCodeStudio.OpenFolder`
- `Software\Classes\Drive\shell\ZiCodeStudio.OpenFolder`

不修改HKLM、文件关联、ZiFile菜单、其他verb或系统安全设置。设置MUIVerb、Icon、MultiSelectModel及所有权标记，command直接调用双引号EXE加`--open-folder`与双引号选择路径；占位符后附`\.`解决盘符末尾反斜杠对引号的影响，不经cmd/PowerShell。

所有键预检查所有权标记、同名Studio EXE的绝对路径、精确参数模板及额外子键；外来归属或改写命令使整次配置被拒，移除前再次检查。旧路径符合这些条件时只读状态返回待修复数；用户在设置页明确确认后可用当前EXE修复四项菜单，也可移除本产品旧注册项。配置并非跨键原子事务；权限/IO失败可能部分配置，需重新读取状态并保留错误后人工处理，不静默重试或删除不明项。

独立验收profile禁止修改真实Explorer注册。测试只使用自有UUID注册表子树，不向实际右键位置写入。真实Explorer安装/点击/卸载、现代菜单及更多工具入口仍须单独验收。

## 本轮验证

Rust静态和专项结果、实际目录启动与截图见技术博客项目档案`iterations/explorer-folder-entry-2026-10-11`。专项验证解析、三键私有注册表往返、外来标记/另一EXE拒绝、拒绝时其他键保留、重复移除以及命令引号。不能将私有注册表测试当作真实Explorer菜单已点击验证。

最终Rust静态退出0、三项专项通过；复用target/debug构建退出0。实际Windows Tauri/WebView2打开含中文、空格和`&`的合成目录，URL工作区ID、Host工作区记录和界面路径一致，未恢复旧项目会话。一个所属Pi子进程带四项禁用自动发现参数；两种视口截图已检查，观察期间pageerror为0。CLI只读状态退出0、相对路径和独立profile安装拒绝均退出2。正常Tauri退出后本轮所属进程全部结束。未提交模型请求、执行插件或安装真实Explorer菜单。


## 设置内操作（开发主分支）

设置显示已注册目录入口0–3项，提供核对、添加、移除；部分注册可补齐或移除。添加/移除先显示当前用户与安装位置说明，取消不调用配置命令；确认后锁定操作直到请求结束。响应错误或协议异常后状态未知、禁止修改，可手动重新核对，无自动重试或乐观成功。当前安装位置与已有条目不匹配时仍由Rust拒绝。

桌面命令仅接受status/install/remove，校验工作区窗口及Host origin；非Windows返回不可用，独立验收profile返回禁用状态且后端拒绝写入。LAN浏览器没有桌面调用桥时隐藏本节。设置确认交互专项使用模拟响应；本机实际验收只核对独立profile禁用与参数拒绝，不等同真实Explorer安装验收。

2026-10-11 后续修复：设置hash在Host异步目录加载后保持，Windows通用/配置/旧app参数冲突/未知tab四种实际刷新通过。记录见项目档案iterations/settings-route-restore-2026-10-11；刷新期间Tauri通信回退与旧callback警告仍保留，其他OS待验收。
