# ZiDevTools 图片缩放候选的 Studio 原生界面运行验收

日期：2026-10-16  
范围：仅 ZiCode Studio Desktop；未修改 `E:\zi-devtools`。

## 目标

在真实 Windows 桌面 WebView 中走通候选插件目录安装、工具目录发现、按需打开、资源确认、工具执行和输出预览，并核实跨工具接力状态。

## 发现

- 项目没有可复用的图片 fixture。当前 debug EXE 为 `target/debug/zicode-studio-desktop.exe`，123,826,688 字节，SHA-256 `12D97812DEBCE489AB539E936A1B0ADE7EA16B091A788ED83E60AE2E5D1617EF`。
- 现有隔离验收 profile 为 `.cache/task-scratch/trace-native-20261014/profile`；按项目留存规则，本轮复用它，没有另外创建运行目录。
- 候选目录为未签名的 `tests/fixtures/devtools-image-resize-candidate02/`，版本 0.1.1，包 ID `com.zicode.devtools.image`。

## 修改与运行过程

- 在现有 `trace-native-20261014` scratch 内生成合成的 4×2 PNG（132 字节），通过 Studio 原生文件选择器选择；没有使用用户个人图片。
- 插件管理器先拒绝无 `resource.read` 授权的启用请求；授予该插件读取权限后成功启用。工具目录显示 24 项，发现“缩放图片”并实际打开其动态表单。
- 在 Studio 资源选择区明确确认向该插件提供单张快照；设置输出格式 `png`、最大宽度 `2`、质量 `85` 并运行。
- 插件成功返回 JSON：`ok=true`、源图 4×2、结果 2×1、`image/png`、77 字节。Studio 显示结果尚未保存，并在本机预览中标记 2×1；未写出输出文件。
- 打开“发送到工具”后，UI 显示当前页没有可接收该图片输出的工具。未执行接力。

## 验证证据

- Computer Use 真实 Windows 桌面窗口与原生文件选择器；应用窗口 1442×931。已目视检查工具目录卡片、资源确认、运行状态、返回 JSON、派生资源输出卡片和 2×1 预览。
- Computer Use 运行环境不允许导出/保存 screenshot payload，故没有生成归档截图文件；界面截图是当前工具输出中的即时证据。
- 真实桌面流程成功，不代表正式签名包、跨平台、取消/失败隔离、接力、保存或全目录接入通过。

## 后续核对（2026-10-16）

- 源码确认资源接力仅搜索 `resource.wasi.input.draft2` WASI 接收端；Studio 内置 `com.zicode.ocr` 是 Windows Host OCR 路由，不符合该接收协议，因此图片输出没有候选接收工具。这是当前契约范围限制，不是候选插件执行错误；需另立版本化 Host receiver 契约才可打通。
- 曾准备以 8 字节 PNG 签名损坏样本验证 UI 错误恢复，但原生文件选择窗口在本轮没有可访问性树；输入自动化出现非预期文件名内容后立即取消窗口。没有确认或打开该路径，没有传给插件，没有读取外部文件。Studio 回到原有成功结果界面，原有输出仍显示且主界面可操作。损坏图 UI 错误和失败隔离因此仍未验收；8 字节合成样本留在原有 scratch 中。

## 遗留与空间策略

- 当前会话没有第二个已加载工具声明接收该 `image/png` 输出；需要提供方或 Studio 后续加入至少一个兼容接收工具后再验收接力。
- 保存需另行明确授权，本轮没有触发写入。
- 完整 DevTools 工具验收仍为 0/154；候选仍未签名。
- 没有删除任何文件，也没有重试任何此前被拒绝的清理请求。合成输入为 132 字节，留在已存在的 scratch 目录内；当前 profile 继续保留到原生验收结束。
