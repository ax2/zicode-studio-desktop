# v0.7.9 · 比较并合并快捷配置

在包含[快捷配置专用执行档案](../plugins/shortcut-profile.md)的 Studio 中，打开插件管理并选择「安装本地插件」。从源码仓库取得[完整冻结候选](../../tests/fixtures/devtools-windows-file-tools/shortcut-profile-0.1.0-candidate-01)和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/shortcut-profile-0.1.0-candidate-01-verification.json)，用[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对。安装后审核并启用 `resource.read`。

在工具中心搜索「比较并合并快捷配置」，选择独立版导出的两份 JSON 并确认共享。填写导入文件在列表的位置，留空时使用第 2 份。选择合并可保留基准中未覆盖的绑定，选择替换只采用导入配置。手动运行后查看变更和冲突。通过「预览保存 → 确认保存文件」创建新的 `result.json`。两个原件和在用快捷键配置保持原样，新文件可用独立版导入流程打开为草稿。

`unified-shortcuts` 的本轮范围为便携 v1 配置。两份各至多 16 KiB、32 条绑定，合并至多 64 条，结果至多 48 KiB。预览检查已保存的自定义序列和固定搜索键 K，支持显式禁用和暂停使用的命令。冲突、无效内容、权限变化不生成可保存文件。设备当前默认、已安装应用、快捷键生效和物理跨应用行为继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `f92b681adf16a46aacc7de46aa60fdd4336220ad` 随 [ZiDevTools #52](https://github.com/ax2/zi-devtools/pull/52) 合入 `e085dd716b8820cd9c58361f889dcf5397d7dca4`。独立版快捷键 7 项与新增 Rust 目标严格检查通过，冻结 WASM 可按验证头重建为相同字节。
- 实际 Windows Worker 48 项通过，覆盖角色反序、合并与替换、错误格式、重复或前缀冲突、固定 K、他包或能力冒用、两个输入达到字节与绑定上限。上限正例输出 33,510 B。普通 Draft1 继续拒绝 JSON。保存旧 Worker 未分档案的 27/44 和用可写独立目录补做的拒绝对照。最终 Worker 回执 SHA-256 `90cb2f130405d1ee292e761b7de2c639d67c2da1adf76bc6c0a16388c02d1c0e`。
- 冻结包 8 件、348,154 B。目录索引 `c3e29d6cf80028edb935c666eb161f8825a27de6e9290b9c921f1b9f73a6e6fb`，WASM `a97a12cec1f01a726534e7a2139a9777678472b6c0e14edb72568fb3c9ca47ba`，逐件收据 `6bebd0dae65e8bee2eef86d21de895734d335bdf50aa199565a176e01322fbb0`。
- 实际 Windows 隔离 Studio `0.7.4` Debug 用 Host 源码 `a387c027238c3e0aec90bd296c8187ab000c1654`，同批带 Gmail `30a5765f70c3a9c6a0de3e03c5defc9bd9c6ea21` 的单文件改动。EXE SHA-256 `befd2f8d0a40cff12c812d170ea8ed96f957976d690479e498fa8f1c4fe56f4c`。首轮缺少调试资源及下一轮实际请求未转发执行档案的失败均保留。
- 正常工具中心验证了单文件与坏配置拒绝、固定 K 冲突无产物、反序合并与替换、取消写入、独立确认保存出 318 B 和 237 B 的两个文件、撤权和重启。原件摘要保持，两个产物重启读回与原生 v1 解析、编码逐字节一致。Windows 系统选择窗口和任意位置另存留集中验收。
- 首装、重启和独立回读回执 SHA-256 为 `1ac6765166c30b5a91130f7a8d758dd238477dfd78aeb08bd25652bfbd6be07b`、`f63d92a715ea48ae8be25bccf7124e1f71d52edae731b3990f6831dafb61e7d7` 和 `2d8a468d1a3f1410bf67b4148154989edd2febdc0cdf24b7cfe431794762da84`。
