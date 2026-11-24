# 重复文件检查的目录摘要合同

Studio 工具中心在「重复文件检查」中选择本机文件夹，再确认读取。Host 先获取大小，只读取有同大小候选的普通文件。插件 `com.zicode.devtools.duplicate-files` 的 `devtools.duplicate-files.scan` 需要已启用的 WASI 资源输入以及 `resource.read`、`resource.directory.duplicates.read` 两项声明和授权。目录选择、工作区、窗口和工具会话绑定一次性凭据。选择后可取消，确认后才读取候选的内容。系统只读，不修改或删除文件。

Host 以 `text/plain` 发布 `resource.local-directory.duplicates.draft1` JSON。每个成功候选的行含相对 `path`、十进制 `logicalBytes` 和小写十六进制 `sha256`。目录标识、绝对路径和文件内容只在 Host 端使用。扫描跳过链接、重解析点、无法安全表达的路径和不可读取的文件。打开候选时核对清点阶段的大小和修改时间，读取前后复核文件身份，流式读取中定期检查授权。Host 最多访问 4096 个条目、下降 16 层，最多读取 256 个候选或 256 MiB 候选内容，最多发布 60 KiB 快照，并使用 20 秒软上限和既有硬截止。候选数、读取字节或快照预算不足时整组跳过，时间上限可在组中途结束。部分结果带覆盖原因。文件大小和摘要相同才构成重复组，零字节文件可构成一组。

结果显示已哈希候选数、重复组、匹配文件和潜在重复逻辑大小。列表有独立展示上限。部分扫描和部分列表分别提示。逻辑大小按每组保留一份计算，实际磁盘用量还取决于硬链接等存储行为。系统文件夹窗口与安装分发的日常使用仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
