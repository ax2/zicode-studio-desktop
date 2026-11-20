# Windows 文件转为 UTF-8

编码插件 `0.3.0-candidate-02` 保留独立的编码检查入口，并为「文件转为 UTF-8」启用 `resource.wasi.encoding-utf8.v1`。支持单个非空文件，输入最多 8 MiB，输出最多 16 MiB。用户明确选择源编码并确认文件共享，插件对完整输入严格解码。Studio 检查输出类型、长度、UTF-8、BOM、字符数和预览。结果保存需要另外确认，源文件始终只读。原文件引用接力仍接收于「检测文件编码」。

真实 Windows Worker 使用七种 8 MiB 合成输入，分别按 UTF-8、UTF-16 LE/BE、GB18030、Big5、Shift_JIS、Windows-1252 转出 UTF-8，实际字节和 SHA-256 与独立计算一致。另验证仅有 UTF-8 BOM 的文件可生成空输出。真实隔离 Host 通过包安装、授权、工作区文件共享确认、执行和保存，实际保存的 16 MiB 文件 SHA-256 为 `c018d2891c3466daba9f8794b49c345f38c60f708a70f27bfbbd2473103f8881`，源文件内容相同。取消确认不落盘。输入多一字节、严格解码发现末尾坏字节、输出多三个 BOM 字节三种情况均被拒绝，无派生输出。

候选 01 在真实 Worker 处理 16 MiB 输出时中断。候选 02 让 UTF-8 回读借用已验证的字节，消除完整复制，在相同 64 MiB 内存和 15 秒超时策略下通过。两个不可变候选及失败记录均保留。通过的 WASM SHA-256 为 `1d7b5d6c458cdd9e07551232d393bfa437d1dfaae033d33f2194a99a56508441`。

记录在会话工作区 `outputs/issue28-encoding-convert-acceptance02.log` 和 `outputs/issue28-encoding-convert-worker-proof.json`。开发候选已进行自动化验证，原生操作纳入主会话统一验收。其他目标编码仍在文件编码完整范围内跟踪。

跟踪 [Studio #28](https://github.com/ax2/zicode-studio-desktop/issues/28)。
