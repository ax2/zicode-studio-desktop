# 插件管理本地化搜索修复（2026-10-17）

## 目标与发现

当前 Windows Debug 原生界面中，内置 OCR 插件卡片显示“文字识别”，但在插件管理输入“文字识别”返回 0/19；输入原始名称 `OCR` 能找到该卡片。原因是卡片调用 `t(...)` 显示名称和描述，搜索只索引原始元数据。工具达到上百个时，用户应能用界面实际显示的名称找到插件。

## 修改

`PluginManagerViewApp.tsx` 的搜索字段同时包含原始名称、描述、能力标题/描述及其当前语言译文，保留 ID、发布者和版本搜索。未修改插件协议、安装状态或 DevTools 提供方文件。增加中英文名称回归用例。

## 验证

- 定向 Vitest：`plugin-manager-paging.test.tsx` 2/2 通过，覆盖“文字识别”与 `OCR`。
- `bun run check` 退出码 0；输出包含其他文件既有 Biome 提示和一项现有设计警告。
- `bun run build:local` 使用现有 `target/debug`，成功生成 `target/debug/zicode-studio-desktop.exe`，应用版本保持 0.4.2，未创建 Release 或 ZIP。
- 使用隔离 profile 的 `--tools-only` Windows 原生程序（1442×931，浅色、简体中文）：插件管理页输入“文字识别”后显示 `1 / 19`，结果卡片为已启用的内置 OCR。截图归档在技术博客 `screenshots/plugin-manager-localized-search-2026-10-17/desktop-zh-cn.jpg`；验收后已结束该隔离程序。
- 构建前只读扫描：`target` 29,399,124,662 B，`task-scratch` 824,274,650 B；构建和 UI 检查后：`target` 29,401,968,502 B，`task-scratch` 839,587,215 B；两次未知项均为 0。卷空闲量受其他进程影响，不归因于本轮。未执行清理或重试被拒绝的删除。

## 边界与后续

这证明已安装插件管理页的本地化搜索在 Windows 原生界面可用；未证明 DevTools 全量目录、签名安装或 macOS/Linux 原生体验。URL 文本资源 candidate-02 仍缺必需 profile，Host 安装失败；完整 DevTools 工具接受数仍为 0/154。收到新候选后继续按逐文件收据及真实 Host/Worker 流程验收。
