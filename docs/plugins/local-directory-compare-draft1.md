# Studio 目录内容对比

在工具中心打开「目录内容对比」，依次选择左、右文件夹，核对顺序后确认共享，再执行比较。Host 在确认前只校验两个本机目录的身份，确认后才清点并读取。选择和提交与窗口、工作区、工具会话及插件权限绑定，取消或撤权后无法继续读取或发布报告。

Host 只读取同相对路径、同大小的普通文件以计算 SHA-256。不同类型、不同大小和单侧记录使用元数据。读取时复查权限、文件和父目录身份。两侧目录身份在扫描后再确认。链接和重解析点不跟随。报告不会显示本机绝对路径。

## 独立插件合同

- 本机选择使用 `resource.local-directory.compare.draft1`，专用权限为 `resource.directory.compare.read` 和 `resource.read`。插件 `com.zicode.devtools.directory-compare` 仅用 `devtools.directory-compare.scan`、`resource.wasi.input.draft2` 和 `text/plain` 处理快照。
- 快照由 `schemaVersion`、`profile`、`coverageComplete`、`partial`、`limitReasons` 和 `rows` 组成。每行的 `path` 是精确相对路径，`left` 和 `right` 各有可选的类型、逻辑字节十进制串及 SHA-256。变化或读取失败以 `verification` 标注。插件无法取得选择路径、文件内容或写入接口。
- Host 每侧最多访问 4096 个条目和 16 层，共处理最多 256 个配对路径、预留 256 MiB 读取量及 60 KiB 快照。软截止为 20 秒。跳过条目、超限、读取故障及变化带原因。两侧清点覆盖不足时，单侧观察只计入未核实范围。预算较紧时优先保留两边均可核对的路径。两边均存在且等长的文件，必须取得两份可比摘要才会判断内容相同或不同。
- 插件结果区分目录覆盖、比较未核实和显示行裁剪；列表裁剪保留已处理范围的计数。关于原生文件夹窗口、分发、CSV 输出及复制计划的剩余范围由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
