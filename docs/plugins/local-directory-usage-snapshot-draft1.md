# 目录空间分析资源快照 draft1

## 权限与交接

`resource.local-directory.usage.draft1` 是目录空间分析插件的 Host 输入合同。候选接收者为 `com.zicode.devtools.disk-inspector` 的 `devtools.disk-inspector.scan`，需要活跃工具会话、WASI `resource.wasi.input.draft2`、`resource.read`，以及独立声明且获授的 `resource.directory.usage.read`。普通 `resource.directory.read` 保持单层名称和类型的语义。

Studio 工具页通过 `select_directory_usage` 打开系统文件夹窗口。选取普通本机目录后，准备阶段只核查目录身份和授权。回执只显示文件夹名，并标记 `entryNamesRead:false`。凭据绑定当前可信窗口、工作区、路由、插件和工具会话，有效 120 秒。确认使用 `commit_plugin_directory` 并传 `confirmed:true`。同一窗口可用 `cancel_plugin_directory` 取消待确认或执行中的扫描。取消等待正在执行的系统调用返回。取消或撤权时不会发布新的资源。已发布资源可用原有资源撤销接口撤销。

可信桌面的工作区相对入口 `prepare-local-directory` 继续接受显式指定的用量 profile；`.` 表示工作区根目录。对应确认与取消入口分别为 `commit-local-directory` 和 `cancel-local-directory`。原生选址凭据仅能由绑定的窗口确认。

确认后，Host 从受限目录句柄读取条目名称、类型和文件逻辑长度。Windows 拒绝网络卷及选中路径中的重解析点，扫描中跳过链接和重解析点。递归打开每一级子目录时复核实际句柄。Host 在打开、读取和发布时做授权与身份检查。扫描中可同时有文件变更，这是有界的现场观察。同名硬链接按目录项计量。

## 传输内容

既有只读资源出口以 `text/plain` 提供 UTF-8 JSON。Worker 通过 `zicode_resource_input_draft1` 的 `size`、`read` 访问快照。快照只传相对名称、类型和文件长度。选址及授权凭据、绝对路径和目录句柄限定在 Host 端。

```json
{
  "schemaVersion": 1,
  "profile": "resource.local-directory.usage.draft1",
  "entries": [
    { "kind": "directory", "path": "archive" },
    { "kind": "file", "path": "archive/example.txt", "logicalBytes": "32" }
  ],
  "visitedEntries": 2,
  "skippedLinks": 0,
  "skippedDepth": 0,
  "skippedNames": 0,
  "unreadable": 0,
  "limitReason": null,
  "partial": false
}
```

- `entries` 按相对路径排序，使用 `/` 分段。只返回有效路径名。文件逻辑长度用无符号十进制字符串表示，以保留完整的 64 位值。
- 最多访问 4096 个目录项，从根目录深度 0 开始下降 16 层，单条相对路径最多 2048 个 UTF-8 字节，编码后快照最多 2 MiB。
- 可从 15 秒扫描预算返回部分结果。Host 旧有的 30 秒和票据剩余期限为硬截止。阻塞调用跨过硬截止或目录身份改变时，确认失败。
- `limitReason` 可为 `entries`、`time`、`snapshot_bytes` 或 `null`。达到软限制或出现跳过项时，`partial:true`。提交回执含 `entryCount`、`partial` 和作用域资源引用。
- 目录级汇总、总逻辑字节与最大文件排序由独立插件消费快照后生成。

## Studio 工具入口

在工具中心打开「目录空间分析」，选择本机目录并确认，再点击「执行工具」。结果显示逻辑字节总量、所选目录直接文件的用量、文件和目录数量，以及最大的一级子目录和文件。若扫描或分析达到预算，界面标记为部分结果并说明限制。长路径按 UTF-8 字节边界截短，显示为文本。

候选包声明独立的目录用量权限，默认目录名称报告权限不足以执行。取消或关闭工具会释放已确认的资源。系统文件夹窗口的人工操作、Explorer 入口和候选分发仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## 验证

Rust 测试 `usage_uses_only_relative_metadata_and_marks_bounded_reads_partial` 使用合成目录覆盖相对路径、字节值、时间和深度上限及协作取消。`confirmed_usage_snapshot_reaches_only_its_worker` 使用隔离 Host、生产 Worker 和独立的测试 WASM 复核传递内容。运行后者须指定 `ZICODE_TEST_RESOURCE_WORKER_EXE`。该测试的 Worker 回传快照以核对合同。

Windows 实包测试 `frozen_disk_inspector_reports_real_confirmed_directories` 使用同一个生产 Worker，另需通过 `ZICODE_TEST_DISK_INSPECTOR_DIR` 和 `ZICODE_TEST_DISK_INSPECTOR_RECEIPT` 指定 Disk Inspector 0.1.0 candidate-01 及包外收据。测试在隔离资料中安装并授予候选权限，覆盖正常目录、Host 深度上限、Worker 读取上限和原生入口交给 Host 的工作区外目录，并检查窗口绑定、确认、取消和凭据重用。
