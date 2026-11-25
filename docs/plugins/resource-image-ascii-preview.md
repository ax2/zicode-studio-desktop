# 原图转 ASCII 字符画资源接口

Studio #28 和 ZiDevTools 提供方共用此预览协议。Tool Center 使用本机文件选择和逐次资源确认。用户执行后可查看等宽字符画或走既有另存确认来保存 TXT。

- 能力属于插件 com.zicode.devtools.ascii-art-image，能力 ID 为 devtools.ascii.image.render。Host 按 resource.wasi.image.ascii.v1 和精确版本 =1.0.0-preview.1 协商。清单需要 output.schema.v1、resource.input.types.v1、resource.output.types.v1 和 resource.read。
- 输入使用 resource.wasi.input.draft2。每次供给一张明确确认的 PNG、JPEG 或 WebP，压缩字节最多 10 MiB，Worker 在解码前检查最长边不超过 20,000 像素，总像素不超过 20,000,000。输入参数 width 为 8–120 的整数，产品表单默认 80。
- 使用现有隔离图片 Worker 预算。线性内存 256 MiB，燃料 300 亿，Host 等待上限 10 秒。资源调用继续使用现有取消、授权重查和并发门。
- 输出使用 resource.wasi.output.draft1。成功时返回 ok、width、height、byteLength 和一个 text/plain 资源。高度为 1–120，输出每行包含 width 个字符，结尾为 LF。字符只使用从暗到亮排列的十个 ASCII 字符。Host 校验行宽、字符范围和字节数。失败时返回结构化错误，输出资源数为零。
- 用户确认分享原图后 Worker 仅读取快照。预览与另存使用已经登记的派生资源，写入仍需确认。

## Windows 验收

- 隔离 Windows Host 安装并发现冻结候选。显式授予读取权限并确认一张 PNG 后，生产 Worker 生成 36 字节的字符画。结果内容和 SHA-256 读回一致。拒绝另存确认时未创建文件，确认后保存的 TXT 与预览逐字节相同。
- 已通过 28 项真实 Worker 对照，包括 2,000 万像素 PNG、16 位 PNG、带透明度的 WebP、大 JPEG、10 MiB、每边 20,000 像素、超限以及损坏图片。原生成功结果与 Worker 逐字节相同。冻结前发现的异常宽高内存错误保留在提供方回执，最终版本在解码前明确拒绝超边图片。
- 63 项前端定向测试覆盖文件选择、显式授权和预览行为，其中字符画验证保留每行空格和换行。另存由隔离 Host 的实际确认链路验证。Windows 文件选择和保存对话框可随桌面候选统一验收。
- 提供方 [ZiDevTools #17](https://github.com/ax2/zi-devtools/pull/17)。[冻结候选](../../tests/fixtures/devtools-windows-file-tools/ascii-art-image-0.1.0-candidate-01)和[外部回执](../../tests/fixtures/devtools-windows-file-tools/ascii-art-image-0.1.0-candidate-01-verification.json)由 Studio 校验通过，共 8 文件、945,556 字节。目录索引 SHA-256 为 4e2e1f5bd3f9c1099905b6f388259b4c328d41b99878950a9f23b5bc47d13786。
