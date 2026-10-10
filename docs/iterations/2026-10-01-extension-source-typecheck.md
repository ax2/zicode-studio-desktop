# 扩展源码严格类型检查（2026-10-01）

状态：本地依赖、类型门槛与工作流已接线；远端 CI 待运行。

## 目标与发现

三个实际打包的 Pi 扩展入口原先只经 esbuild 转译。根 `tsconfig.json` 指向内嵌 Pi 二进制目录中不存在的 `dist/index.d.ts`，因而源码类型检查无法解析 Pi API。公开发布的 Pi 0.84.2 编码代理与 TUI 包提供对应声明文件。根配置还包含测试代码，类型错误混合了源码、测试桩和第三方声明。

## 修改与决策

- 用 Bun 精确锁定 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui` 0.84.2 作为开发依赖，与内嵌 Pi 版本一致；移除指向不存在文件的路径映射。
- 新增覆盖 `extensions/` 下 41 个 `.ts` 源码文件的严格 `tsconfig.extensions-source.json`，排除 20 个测试文件和 1 个测试 worker fixture，跳过第三方声明内部检查。三个实际打包入口均包含其中；该检查不替代测试文件和根配置的完整类型检查。
- 根据真实 Pi API 调整 `modelRegistry.refresh()` 的本地返回类型，允许 Promise 携带刷新结果；调用者仍只等待完成，不读取或丢弃该结果中的状态作决策。
- 修复配置模块严格检查发现的供应商名称可选值、结果数组推断；在创建 Pi 会话的边界处把来自 Pi registry 的模型显式断言为 SDK 类型。目录视图的轻量类型仍保留；此断言不做运行时结构校验，运行行为未修改。
- 将新命令接入平台统一检查和 Release 工作流。安装类型依赖增加了本机 `node_modules` 占用；运行包仍通过原有 Pi 资源路径打包。

## 验证与遗留

`bun run typecheck:extensions-source`、`bun run build:extensions`、`bun run check` 和两份工作流的 YAML 解析退出 0。`tsc --listFilesOnly` 显示 41 个仓库扩展源码文件被纳入；`picot-config.ts` 原有整文件格式漂移未扩大修改范围。Bun 阻止了两个依赖生命周期脚本运行；类型检查与扩展构建均未依赖这些脚本。本轮没有运行测试。根配置仍有测试类型与第三方声明错误；真实 Pi 扩展加载及四个 CI 矩阵行仍待验收。
