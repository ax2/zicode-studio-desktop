# 跨平台开发入口（2026-09-28）

## 目标与发现

项目定位为 Windows、macOS、Linux 开发者个人平台。原 `dev` 脚本直接使用 `PATH="$HOME/.cargo/bin:$PATH"`，固定类 Unix 分隔符；`beforeDevCommand` 未编译 `frontend/src/`，因此直接启动可能沿用旧 React 产物。仓库 AGENTS 文档仍把整个前端描述为无框架原生 JS，与现有 React/TypeScript 功能页不符。

## 修改

- 用 Bun 启动脚本运行 Tauri dev；仅当 Cargo 可执行文件确实存在时，按当前系统的路径分隔符补充 Cargo bin，保留现有 PATH。
- 开发与正式构建共用 Cargo 路径配置，优先读取 `CARGO_HOME`，再使用用户主目录的 `.cargo`；支持 Windows `Path` 键名，不重复加入已有目录。正式构建不再只依赖非 Windows 的 `HOME/.cargo/bin`。
- Tauri 开发前置步骤增加 `build:react`，确保运行界面包含当前 React 源码。
- 更新 README 和仓库工程说明，明确混合前端架构及各桌面系统的依赖边界。

## 验证与限制

开发、构建及共享路径脚本通过语法检查和定向 Biome；仓库 `bun run check` 通过并保留既有警告，配置 JSON 可解析，严格 MkDocs 构建与差异空白检查通过。不在本轮运行 Tauri 构建或自动测试。Windows、macOS、Linux 的真实启动与构建仍待分别验收；当前前置构建仅保证启动时 React 产物与源码一致，不声明 React 源码的实时热更新。
