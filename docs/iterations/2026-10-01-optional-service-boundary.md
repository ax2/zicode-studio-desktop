# 可选在线服务边界调查

日期：2026-10-01。状态：静态调查完成，离线运行待验收。

## 目标与证据

产品要求核心项目流程不依赖特定公司服务。核对当前源码中的固定服务地址、模型配置读取、更新入口以及前端直接 `fetch` 调用：

- 固定 QVeris 地址仅见于 `extensions/finance/qveris-client.ts` 的专用金融数据客户端和 `src-tauri/src/host_server.rs` 的显式 QVeris 模型代理。前者属于用户选择的金融数据功能；后者只为该渠道转发和兼容角色格式。
- `extensions/model-channels.ts` 的读取规范化在无提供方配置时返回空字典，不注入默认 QVeris 渠道。`picot-config.ts` 的 QVeris 目录同步先要求该渠道已配置、已启用且有凭据。
- `frontend/src/features/settings/index.ts` 只在自动更新启用时安排静默检查；当前打包配置将更新产物关闭，`public/native/app.js` 调用更新设置时未传入启用标志。设置页的手动入口在此状态下打开 Release 列表。
- 抽查项目相关前端 `fetch` 入口使用同源 Host 路径；项目本身仍可能由用户主动运行命令或配置模型而联网，这不属于默认启动联网。

## 结论与遗留

源码证据支持“特定服务是可选入口”，不能据此证明程序启动时无外连，也不能证明全部插件离线可用。下一步需在隔离网络环境用真实 Windows、macOS、Linux 安装包记录启动、项目打开、Git/终端/任务与模型空配置行为；当前尚无这类运行证据。
