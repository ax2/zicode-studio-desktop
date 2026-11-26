# v0.7.9 · 时钟备份检查

在 Studio 插件管理选择「安装本地插件」，打开[完整冻结候选](../../tests/fixtures/devtools-windows-file-tools/clock-backup-0.1.0-candidate-02)，审核并启用 `resource.read`。从源码仓库取得候选目录和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/clock-backup-0.1.0-candidate-02-verification.json)，用[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)确认原始字节。

在工具中心搜索「时钟备份检查」，选择独立版保存设置中显示的 `clock.json`、它的副本或旧版备份。确认共享后手动运行，可核对保存时间、版本、倒计时恢复方式、计时器、闹钟、秒表分段、提醒、世界时区和小窗尺寸的数量，以及声音设置是否包含。报告只显示格式和摘要，省略名称、提醒标题、路径和操作文本。检查不改变选中的文件。

`clock-workbench` 的此次接入覆盖本机 v1、v2、v3 JSON 的只读格式核对。文件至多 512 KiB，JSON 另有 224 KiB 加权上限。主体每字节计 1，反斜杠加 6，外围 JSON 空白按每 4 字节计 1 并向上取整。密集转义、极端 Unicode 与外围空白叠加可能超限，工具会给出提示。条件外备份、实际恢复、运行中的计时、声音、提醒和小窗仍使用独立版，整体范围继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `556b41f14f6c83b77422c6d60ef9ad4546544527` 随 [ZiDevTools #54](https://github.com/ax2/zi-devtools/pull/54) 合入 `bfe5c7861c487e6c369ae770bd9334c07c61d72d`。共用备份验证和 IANA 时区名检查。原有时钟 23 项、Unicode 共享测试、Native/WASM 两个定向严格检查通过。
- 真实 Windows Worker 50 项通过，和原生适配器对照。支持文件和加权上限同时达到的 524,288 B、最大结构的 212,875 B 中文备份、4,096 个合法转义，以及两个上限的加一拒绝。覆盖 32 个计时器、64 个闹钟、1,024 个分段、97 条提醒、48 个尺寸，错误的引用和资源指纹会被拒绝。保留较宽预算的真实 fuel 失败。生产回执 `015391f12b0c7e155d8d012ceda1f96d2b2f17d4a4eda86b2aaa87ce1135061e`。
- 冻结候选 02 八件、400,692 B。目录索引 `cc93bc56096086d43991684928e054821924e4fc50d7df37e7ab94f8e64d6ee3`，WASM `6290986d45303a420f148c548fe6d7158c0d739fc3f858e456fd47dd4480f7fc`，逐件收据 `7c119f082e1bd74867041bcb198ab64d6767aad2cd4ac3d85d2b00115858147e`。候选 01 的目录索引序列化顺序不合契约，保留本机记录。候选 02 使用同一 Worker 已验证模块。
- 复用隔离 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`。真实工具中心首装、逐次确认、取消、执行和撤权 9 项通过；重启后 v1 与 512 KiB 上限 2 项结果一致。没有生成产物，各原件摘要相同。系统原生选文件窗口保留集中验收。
- 首装、重启回执 SHA-256 `f01e674bfef5a040c5cb899f521b1901b06126df406eafb2ea8ce827e88c3c4f` 和 `9993aa4023cf1746c16828703c4cb3de09c56ed92c6b0926391cd28850469152`。
