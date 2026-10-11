# Explorer 文件夹入口 v1

2026-10-11，Studio开发主分支；正式v0.4.2安装包不包含本功能。

## 可选安装与使用

当前Windows实现传统右键菜单，在Windows11通常位于“显示更多选项”。尚未实现一级现代菜单。仅支持单个本地盘文件夹、文件夹背景和盘符；文件、压缩包及多选工具仍待插件入口。

使用保留的当前debug或未来包含本功能的完整安装目录内EXE：

```powershell
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --explorer-menu-status
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --install-explorer-menu
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --remove-explorer-menu
```

普通启动不会注册菜单。安装/移除需显式运行相应命令，当前无设置页开关，不要求管理员权限。命令返回JSON及退出码（失败2）；不是调用另一程序。不要用旧正式0.4.2 EXE执行这些新参数。

目录也可直接传入：

```powershell
& 'E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe' --open-folder 'E:\my-project'
```

路径必须现存、绝对、本地盘、Unicode目录；拒绝UNC网络目录、相对路径、缺值、重复或与注册动作混用，不回退其他工作区。不自动恢复另一项目的会话。首次进入该目录为新的临时会话，不提交模型请求。

该入口启动的整个Studio进程禁用Pi自动发现外部扩展、技能、提示模板和主题；Studio显式内置扩展仍加载。它不是OS沙箱或只读模式，用户后续明确执行任务仍使用原授权规则；普通启动的发现策略不变。当前会启动新的Studio进程，已有进程交接/单实例去重待补，不宣称托盘图标已去重。

## 注册边界

仅在HKCU下三个固定键：

- `Software\Classes\Directory\shell\ZiCodeStudio.OpenFolder`
- `Software\Classes\Directory\Background\shell\ZiCodeStudio.OpenFolder`
- `Software\Classes\Drive\shell\ZiCodeStudio.OpenFolder`

不修改HKLM、文件关联、ZiFile菜单、其他verb或系统安全设置。设置MUIVerb、Icon、MultiSelectModel及所有权标记，command直接调用双引号EXE加`--open-folder`与双引号选择路径；占位符后附`\.`解决盘符末尾反斜杠对引号的影响，不经cmd/PowerShell。

所有键预检查所有权标记、当前EXE命令及额外子键；任一归属不匹配则拒绝整次配置，移除前再次检查。EXE迁移后不能拿新路径覆盖/删除旧安装项，应先从原EXE移除再安装新路径。并非跨三键原子事务；权限/IO失败可能部分配置，需读取状态并保留错误后人工处理，不静默重试或删除不明项。

独立验收profile禁止修改真实Explorer注册。测试只使用自有UUID注册表子树，不向实际右键位置写入。真实Explorer安装/点击/卸载、现代菜单及更多工具入口仍须单独验收。

## 本轮验证

Rust静态和专项结果、实际目录启动与截图见技术博客项目档案`iterations/explorer-folder-entry-2026-10-11`。专项验证解析、三键私有注册表往返、外来标记/另一EXE拒绝、拒绝时其他键保留、重复移除以及命令引号。不能将私有注册表测试当作真实Explorer菜单已点击验证。

最终Rust静态退出0、三项专项通过；复用target/debug构建退出0。实际Windows Tauri/WebView2打开含中文、空格和`&`的合成目录，URL工作区ID、Host工作区记录和界面路径一致，未恢复旧项目会话。一个所属Pi子进程带四项禁用自动发现参数；两种视口截图已检查，观察期间pageerror为0。CLI只读状态退出0、相对路径和独立profile安装拒绝均退出2。正常Tauri退出后本轮所属进程全部结束。未提交模型请求、执行插件或安装真实Explorer菜单。
