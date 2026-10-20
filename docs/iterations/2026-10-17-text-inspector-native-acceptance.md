# 文本资源工具的 Windows 原生验收（2026-10-17）

## 目标与发现

在本工作树 `target/debug` 的隔离 `--open-file` tools-only 窗口验证“发现插件 → 按需打开 → 明确提供文件 → 执行 → 展示结果”。先用项目 `README.md`（10,237 B）尝试内置 Text Inspector：Studio 已选择并确认文件，但 Host 将 `.md` 的有效 UTF-8 内容标记为 `text/markdown`；该工具只声明 `text/plain`，因此执行阶段正确拒绝 `resource_input_type_unsupported`。界面原先直到失败后才展示代码，用户难以预先选择兼容文件。恢复入口已把该次不确定调用收敛为未保存结果；没有把拒绝算作成功。

改用项目现有 `requirements-docs.txt`（39 B）后，真实 Windows Debug 窗口完成目录发现、按需打开 Text Inspector、选择已打开文件、单独确认提供、执行并展示两行原文。结果页明确显示“结果尚未保存”。这个内置工具不产生输出资源，也没有保存入口；本次没有做跨工具转交或写盘授权验收。它不属于独立 ZiDevTools 提供方包，DevTools 全工具完整接受仍为 0/154。

## 修改与验证

- 工具详情在文件授权前展示能力声明的 `resourceInputMimeTypes`；只显示已声明类型，不根据扩展名扩大 Host 权限。类型不匹配时补充可读提示，并保持未确定调用的恢复要求。Host 的精确 MIME 检查与既有 one-use 授权不变。
- `bun run check` 退出 0；全仓库既有 advisory 仍有 145 warning、10 info 和 1 个 JS inline-style 提示。`directory-resource-runner.test.js` 首次新增测试把普通异常伪装成 Host 错误，实际被安全折叠为 `resource_execution_failed`；修正为真实网关的公开 `code` 形态后，专项 15/15 通过。`git diff --check` 退出 0。
- `bun run build:local` 成功，复用 `target/debug`，Pi 1.3.0、Portable Git、WebView2 与 Bun 均复用已下载资源；未改版本号，未生成 Release 或 ZIP。重建后的 Windows 1442×931 明亮主题窗口显示“可接收的文件类型：text/plain”，再次执行同一 `.txt` 文件并展示两行原文及未保存状态。[截图](<C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/screenshots/text-inspector-native-2026-10-17/windows-declared-type-and-result.png>)为 94,890 B，SHA-256 `3bd880f3b5f942b152c01afefa760345a10dd384e3f7fde1f6e25c9621bcb1c`。
- 隔离验收 Debug 进程 53168、16348、43160 均按确切 EXE 与命令行核对后退出；没有操作安装版 Studio。原生文件选择对话框在当前 Computer Use 目标窗口中无法稳定投送坐标，因此兼容文件复验改用现有 `--open-file` 入口，没有把对话框选择算作已验收。
- 前后 `scripts/storage-budget.ps1` 只读扫描均退出 0、未知项 0：`target` 29,447,084,378 → 29,448,046,614 逻辑 B（+962,236 B）；task-scratch 937,997,121 → 938,012,207 B（+15,086 B）；E 盘可用 30,867,525,632 → 30,988,214,272 B。卷空闲量变化受其他进程影响，不能归因于本轮。没有重试既有审批拒绝的目录清理；本轮实际删除 0 文件、释放 0 B。

## 边界与后续

此次证明内置 `text/plain` 接收器的 Windows 本机文件流程与新提示；未证明 `.md` 可被该工具执行，也未证明独立 DevTools 包、源资源转交、保存确认、取消/超时或 macOS/Linux。若要让 Text Inspector 接收 `text/markdown`，需显式扩展版本化声明、解码与边界证据，不以扩展名直接绕过类型检查。待提供方签名包与收据交付后，继续按全工具矩阵逐项验收。
