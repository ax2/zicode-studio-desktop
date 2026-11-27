# v0.7.9 · 保持原尺寸转换图片

在插件管理安装已校验的 ZiDevTools「保持原尺寸转换图片」0.1.0，审核并授权文件读取。然后在工具中心搜索同名工具，选择一张图片并确认共享，选择目标格式，执行后按提示选址和确认保存。输出是新的文件，保留源图的像素宽高。

支持静态 PNG、JPEG 和 WebP。PNG 与 WebP 无损，JPEG 质量可选 35–95，默认 85，JPEG 不保留透明度。每边最多 12,000 像素，总计最多 1,600 万像素，输入和输出各最多 32 MiB。动画 PNG、WebP 会收到明确错误。Studio 的预览另有 4096 像素边及 4,194,304 像素总量的限制，大图可从结果区直接另存。

此批覆盖源工具 image-tools 1.7.1 的单图原尺寸格式转换。批量、画面编辑、工作实例、剪贴板和拍摄元数据保留继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方 Windows Worker 32 项通过，与独立版共享编码逐字节一致，覆盖每边 12,000 像素、1,600 万总像素及动画拒绝。构建来源 59acfe8c416963dd7a757951e2967f8344148bfd。[ZiDevTools PR #35](https://github.com/ax2/zi-devtools/pull/35)
- 冻结候选 8 件、967,114 字节。目录索引 SHA-256 154b6b49a1cf760c063d1796b916e189c65c34b3d22a7953b9e6dfe32626a1f9，WASM fd8ca2e9e0eaa29cc91846ad2ce4b61c7b0dd197e4d5aa927141e8a9353f2ba5。[候选目录](../../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01-verification.json)
- Windows 隔离 Studio 经真实工具中心、Host 与 Worker 保存 5000×32 WebP（3202 字节）、4×12000 JPEG（6440 字节）与 96×32 PNG（434 字节）。取消时未落盘，确认后逐字节匹配独立版编码。撤权后不可继续使用原输入，文件原件保持。重启后读回三个保存文件并再次执行。坏图和超限均无另存入口。安装执行与重启回执分别为 6323c2485e2d62b97ea341fe57a53241c53dd1028888b25e016829189a53e549 和 7047e8e179f471146d4af587e83ffa47b835d56566e037f8558c53573c179b26。
- 真实 Windows Host/Worker 使用同一冻结 WASM 验证两帧动画 PNG 和 WebP。工具返回固定的静态图片提示，不生成派生文件。回执 SHA-256 EA11ECE7DD579E7E58E4E697871753122B2FA73B2BB8BE0441BB98744DFAA2E6。系统原生选取与另存窗口继续留集中验收。
