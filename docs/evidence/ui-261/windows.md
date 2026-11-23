# Windows 专用工作区实测（#261）

2026-11-23 使用重建的 Windows Debug Studio 和独立资料。从工具目录的「更多应用」分别在 1280×800 浅色及 390×800 深色视口进入各应用。八个界面的页面和正文横向溢出均为 0 px，内容可直接访问，空侧栏收起。

| 模块 | 实测数据 | 截图 |
| --- | --- | --- |
| 知识图谱 | 两条从真实笔记库加载的合成中文笔记和一条链接。窄窗两个测试标签约 10.9 px，完整处于画布内。 | [桌面](graph-1280.webp) · [窄窗](graph-390.webp) |
| 习惯 | 从界面新增中文习惯，标记当天完成，重开后从 Host 读回。 | [桌面](habits-1280.webp) · [窄窗](habits-390.webp) |
| 网页监控 | 从界面新增含长网址的监看，验证保存和重开后的列表及状态。 | [桌面](watch-1280.webp) · [窄窗](watch-390.webp) |
| 文字识别 | 选择合成 PNG，Windows OCR 返回 `STUDIO LAYOUT CHECK`。 | [桌面](ocr-1280.webp) · [窄窗](ocr-390.webp) |
| 项目 | 单工作区模式隐藏项目入口，尝试项目深链接后仍留在允许的工作区，界面无项目根路径。 | [桌面](single-workspace-project-hidden-1280.webp) |

OCR 原失败在 Rust 启动的 PowerShell 子进程中可复现。WinRT `StorageFile` 重新打开同一张预处理 PNG 时返回 `0x80070005`。用 .NET `FileStream` 读取并通过 `AsRandomAccessStream` 交给 Windows 解码器后，同一启动方式和图片识别成功。参见 [Microsoft .NET 文档](https://learn.microsoft.com/en-us/dotnet/api/system.io.windowsruntimestreamextensions.asrandomaccessstream?view=netframework-4.8)。

验收实例配置自有可写临时目录。文件选择由 WebView2 自动化提交。网页监看首次获取长测试网址未成功，截图与结论覆盖本地配置、读回和布局。四个可选工具的启用仅发生在隔离资料。
