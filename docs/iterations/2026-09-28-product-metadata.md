# 产品说明与包元数据核对（2026-09-28）

## 发现

README 已将 ZiCode Studio Desktop 定位为全方位、跨平台的开发者个人平台，但 `package.json` 和 `src-tauri/Cargo.toml` 仍描述为单一 AI 工作台。README 同时声称预置 QVeris 网关、设置 Key 后自动同步模型；当前模型帮助明确说明新场景不自动创建渠道，目录同步需用户手动触发。架构图还把 Windows 专属的 Git Bash 画成所有平台的 Pi Runtime 子组件。

## 修改与依据

- npm 和 Cargo 描述统一改为本地优先的跨平台开发者平台，突出项目、AI 协作、知识与自动化；npm 关键字补充开发者平台和本地优先。
- README 说明 QVeris 兼容网关是可选渠道，用户自行配置并手动刷新；该叙述与现有中英文模型帮助一致。
- README 的安装前提与架构图按平台区分：Windows 内置 PortableGit 和 WebView2 离线安装器，无需预装 Git/Bash；macOS/Linux 使用系统 Git 和 Shell。平台资源不再被画成 Pi Runtime 的子组件。

## 验证与遗留

本轮只修改说明与包元数据，不改变模型配置或运行时行为。JSON/TOML 解析与描述一致性、Python 3.13 严格 MkDocs 构建和 `git diff --check` 均通过。未执行应用测试或跨平台实机验收。产品定位仍需后续功能与各系统交付证据支撑。
