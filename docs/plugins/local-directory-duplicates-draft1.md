# 重复文件检查的目录摘要合同

Studio 工具中心在「重复文件检查」中选择本机文件夹，再确认读取。Host 先获取大小，只读取有同大小候选的普通文件。插件 `com.zicode.devtools.duplicate-files` 的 `devtools.duplicate-files.scan` 需要已启用的 WASI 资源输入以及 `resource.read`、`resource.directory.duplicates.read` 两项声明和授权。目录选择、工作区、窗口和工具会话绑定一次性凭据。选择后可取消，确认后才读取候选的内容。系统只读，不修改或删除文件。

Host 以 `text/plain` 发布 `resource.local-directory.duplicates.draft1` JSON。每个成功候选的行含相对 `path`、十进制 `logicalBytes` 和小写十六进制 `sha256`。目录标识、绝对路径和文件内容只在 Host 端使用。扫描跳过链接、重解析点、无法安全表达的路径和不可读取的文件。打开候选时核对清点阶段的大小和修改时间，读取前后复核文件身份，流式读取中定期检查授权。Host 最多访问 4096 个条目、下降 16 层，最多读取 256 个候选或 256 MiB 候选内容，最多发布 60 KiB 快照，并使用 20 秒软上限和既有硬截止。候选数、读取字节或快照预算不足时整组跳过，时间上限可在组中途结束。部分结果带覆盖原因。文件大小和摘要相同才构成重复组，零字节文件可构成一组。

结果显示已哈希候选数、重复组、匹配文件和潜在重复逻辑大小。列表有独立展示上限。部分扫描和部分列表分别提示。逻辑大小按每组保留一份计算，实际磁盘用量还取决于硬链接等存储行为。系统文件夹窗口与安装分发的日常使用仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## 另存当次报告

确认目录、执行成功后，选择「将 JSON 另存为…」。在系统窗口选择目标，再在 Studio 核对文件名、类型和大小并确认。Host 只新建文件，保留同名目标，取消或撤回源授权后不能继续保存。重新执行时，界面只提供最新结果保存。

`resource.host.duplicate-files-json.v1` 是 Host 从该次成功扫描生成的 UTF-8 JSON，最大 48 KiB。报告绑定选定目录的内容版本、工具、窗口和会话。保存内容包括相对路径、SHA-256、按十进制字符串保存的逻辑字节、重复文件与组数、扫描覆盖原因及路径列表截断标记。实际文件内容、目录的绝对路径和未展示的路径不会写入。

本机定向验收使用冻结 Duplicate Files 0.1.0 candidate 01、隔离 Windows Host、生产 Worker 与合成目录。`frozen_duplicate_files_groups_a_confirmed_directory` 覆盖完整、候选上限导致的部分扫描和完整扫描但路径列表截断。确认后逐份读回 JSON，核对摘要和长度。窗口错配、不同报告、取消、重放、同名和权限撤回均拒绝写入，原文件保持。真实系统文件选择和另存窗口以及日常安装仍见 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29)。
