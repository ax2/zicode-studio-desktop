# ZiFile 归档适配层事件契约 draft1

状态：2026-10-14，**仅接收向量校验草案**。Studio 尚未开放 native Worker profile，不能安装或执行此事件流作为 ZiFile 插件；[完整功能矩阵](zifile-integration-matrix.json)的 108 格接受数仍为 0。此契约由 Studio 定义，ZiFile 可在保留独立程序和 Worker v3 的前提下交付适配层，不要求两个仓库共享源码、配置或运行目录。

## 与 ZiFile Worker v3 的边界

ZiFile 现有 `Envelope<WorkerEvent>` 使用 `version:3`，事件为 `archive_start/archive_entry/archive_end/progress/summary/error`，请求含绝对路径和可选明文密码。Studio 不把 v3 原始事件、路径或错误字符串转发插件页面。受约束适配层须把 Host 私有资源与短期密码引用转换为 v3 请求，再把 v3 结果映射成下面的 v1 事件；原生执行、资源暂存和写入事务仍需单独实现与验收。

每行一条 UTF-8 JSON，以 LF 结束，事件对象**恰好**包含 `schemaVersion:1`、Host 提供的 `callId`、从 0 连续递增的 `sequence`、`type`、`payload`。`callId` 形式为 `archive-call-<UUIDv4>`。第一条必须是 `started`，最后一条必须是 `ended`；中间恰有一个 `result`、`error` 或 `cancelled` 终态。结束状态必须与终态相符。串调用、乱序、重复、无终态、终态后事件和额外字段均拒绝。

| type | payload | 要求 |
| --- | --- | --- |
| `started` | `{operation}` | 六种操作：`list/test/create/extract/update/rename`，与 Host 预期一致 |
| `entry` | `{entryId,name,kind,uncompressedBytes,compressedBytes,safeRelativePath}` | 仅 `list`；一页最多 200，ID 在页内唯一；危险归档名仍可显示，但必须标为 `safeRelativePath:false`，不得作为解压授权 |
| `progress` | `{unit,completed,total}` | `unit` 为 `entries/bytes`，`total` 可为 null；最多 1000 条，数值为非负安全整数 |
| `result` | `list`: `{format,nextCursor}`；`test`: `{format,verified:true}`；写入操作: `{format,summary:{processedEntries,outputBytes}}` | `format` 必须属于矩阵的 18 种格式。`nextCursor` 为 null 或 16–512 字符的 Base64URL 不透明字符串；游标真实性、包版本与资源版本绑定由提供方/Host另验 |
| `error` | `{code}` | 仅固定错误码，不得包含原始错误、主机路径、密码或栈信息 |
| `cancelled` | `{}` | 只有 Worker 及所属子进程确认停止后才发出；文件事务状态须另证 |
| `ended` | `{status}` | `ok/error/cancelled`，与前一终态相符 |

总事件流最多 512 KiB、单行最多 16 KiB、最多 1304 条；名称最多 1024 UTF-8 字节，条目 ID 最多 128 字节且只含 ASCII 字母、数字、`_`、`-`，不接受控制字符或 CRLF。超限必须显式错误，不能截断为看似成功的目录页。`archive.list` 的真实大归档分页必须有稳定排序、资源内容版本约束和不可伪造游标；目前验证器只能核对单页形状，无法证明分页算法正确。

`safeRelativePath:true` 至少要求名称不是绝对路径、盘符路径，且不含空、`.`、`..`、Windows 设备名、保留字符或尾随点/空格路径段；Host 在解压准备和提交时必须重新检查真实归档条目、链接及目标目录，不能信任提供方的布尔值。

提供方应交付每种操作的成功、失败、取消正反例，以及超大页、损坏/加密归档、格式差异和中途终止向量。Studio 命令行接收校验：

```text
bun run scripts/verify-zifile-adapter-events.mjs <trace.jsonl> <operation> <archive-call-UUIDv4>
```

仓库的 `tests/fixtures/zifile-adapter-events/list-ok.jsonl` 是**Studio 自制协议向量**，含一个标为危险的归档名；它不是 ZiFile 产物，也不证明归档算法接入。验证器不启动原生程序、不验包签名、不验证资源授权/游标真实性/写入原子性；真实 Host 解析器和三个桌面系统的运行证据必须在正式支持 native profile 前补齐。
