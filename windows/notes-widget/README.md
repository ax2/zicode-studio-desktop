# Windows 速记小组件

面向 Windows 11 x64。Studio 继续使用现有 NSIS 安装器，小组件作为可选的独立 MSIX 提供程序。它通过应用包清单注册 COM 类及 Windows Widgets 扩展。Windows 10 继续使用 Studio 内置笔记入口。

## 功能

- “新建笔记”打开当前固定资料库的笔记编辑器。空资料库首次进入笔记本创建表单。
- “打开最近笔记”和“打开置顶笔记”使用 Studio 自己的快捷访问列表。没有对应记录时，保留在笔记页并提示状态。
- 卡片采用固定的标题隐私策略，只展示三个操作。笔记标题、正文、文件路径均不进入卡片及小组件宿主。笔记内容在已打开的 Studio 中展示。
- 冷启动与二次唤起使用同一普通安装位置和资料选择。程序参数只接受三个固定动作，绑定到对应的工具窗口和会话，消费一次；新建或浏览都不启动模型，也不访问剪贴板。
- 系统状态可作为未来独立组件，复用 Studio 自有的系统信息，而速记提供程序无需硬件权限。

## 单独构建与验证

在启用 x64 的 Visual Studio 开发者 PowerShell 中，使用 PowerShell 7、Windows SDK（含 C++/WinRT 和 MakeAppx）：

```powershell
./windows/notes-widget/build.ps1 -OutputDirectory C:/temp/zicode-widget-build
```

输出目录须尚不存在。构建器核对固定版本的微软 Windows App SDK Widgets 元数据、编译 Provider，在独立进程创建真实 COM 接口并检查卡片，然后使用 MakeAppx 验证和打包。已有的 NuGet 归档可通过 `-WidgetsSdkArchive` 指定；SDK 工具路径可通过 `-SdkTools` 指定。输出包为 `ZiCode.QuickNotes.x64.msix`，此命令不签名或安装。

## 小组件面板验收

使用独立 Windows 11 测试账户或虚拟机。准备 Microsoft Windows App Runtime 2（至少 2.7.0.0）、Windows Web Experience Pack 与支持这三个动作的 Studio v0.6.9 或更新的 x64 安装版。分发时使用与包清单 Publisher 相符的受信任签名。由测试账户注册伴随包，在小组件选择器找到 ZiCode Quick Notes 并固定。分别验证冷启动新笔记、打开最近和不同的置顶笔记、退出 Studio 后再次启动。卡片应只包含操作名称。多个运行配置通过 Studio 原有资料定位隔离。

本机原型验收覆盖真实 COM 接口、卡片内容、MSIX 打包、真实 Studio 的三个入口和重启定位。系统面板的注册、固定与宿主回调仍需要在上述独立环境验收。

微软资料见 [小组件提供程序](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers) 和 [小组件包清单](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-provider-manifest)。
