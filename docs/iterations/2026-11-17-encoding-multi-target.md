# Windows 多目标文件编码转换

编码插件 `0.4.0-candidate-03` 增加「转换文件编码」。七种源和目标编码可独立选择，单文件最多 8 MiB 输入、16 MiB 输出。UTF-8、UTF-16 LE 和 UTF-16 BE 可以加 BOM。转换后严格分块回读比对原文字，Host 检查实际输出的类型、大小、BOM、前 64 字节、字符数及文字预览。结果区显示实际输出资源的 SHA-256。非 UTF-8 输出使用 `application/x-zicode-encoded-text`，确认后以 `.encoded.txt` 保存实际转换字节。已有「检测文件编码」和「文件转为 UTF-8」均可从目录打开。

真实 Windows Worker 通过七种目标的 8 MiB 独立逐字节向量，以及 Windows-1252 转 UTF-16 LE、GB18030 两个 8 MiB 输入与 16 MiB 输出同时到达上限的用例。真实隔离 Host 安装和授权后通过七种目标固定向量、BOM 正反例和不可表示字符拒绝。16 MiB UTF-16 LE 和 16 MiB UTF-8 输出在确认保存后由磁盘读回核对 SHA-256，原文件通过字节比较。未确认保存没有写入，输出超限不产生派生文件。Node 前端 44 项、Windows Rust 类型和严格检查，以及编码核心和适配器原生测试通过。

候选 01 在大文件 Shift_JIS 转换上耗尽计算预算，候选 02 在 Windows-1252 转 UTF-16 LE 高峰时中断。候选 03 使用编码库自带的查表和 64 KiB 分块回读，在同一 64 MiB 内存、8,000,000,000 指令量计数和 15 秒时限下通过。三份候选及失败记录保留；通过候选的 WASM SHA-256 为 `342e069bd4af73c5e5b81e9ceeca3f329a93968c48c29030bca4669afefc7ece`。

独立证据在会话工作区 `outputs/issue28-encoding-targets-worker-proof03.log` 和 `outputs/issue28-encoding-targets-acceptance03.log`。当前为 Windows 开发候选，原生文件选择、预览和另存操作纳入主会话联合验收。

跟踪 [Studio #28](https://github.com/ax2/zicode-studio-desktop/issues/28)。
