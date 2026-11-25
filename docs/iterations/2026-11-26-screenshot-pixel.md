# v0.7.9 · PNG 截图取色

在插件管理中审核并启用 PNG 截图取色 0.1.0。在工具中心搜索「PNG 截图取色」，选择并确认一张本机静态 PNG，输入整数坐标 `x` 和 `y` 后执行。左上角是 `(0, 0)`，按文件中的原始像素查询。结果展示图片尺寸、RGB、独立 Alpha、`#RRGGBB` 和 `#RRGGBBAA`，可选择文本复制。完全透明像素也保留原 RGB。工具只读取已确认的 PNG 文件，使用现有 `resource.read` 权限。

每张文件最多 256 KiB，最长边 512 像素，合计最多 16,384 像素。越界坐标、损坏文件、APNG 和 16 位通道会给出提示。独立版 `screenshot-workbench` 的屏幕采集、交互放大镜、标注、裁剪和系统剪贴板继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `632f9fc350b6c4b271d3291d3ae614e954b178bd` 随 [ZiDevTools #41](https://github.com/ax2/zi-devtools/pull/41) 合入。真实 Windows Worker 与原生适配器 28 项对照通过，包含精确 256 KiB、128×128 高复杂 PNG、512×32、索引透明、Paeth 和 Adam7。保留早期 32,768／65,536 像素密集图片的燃料失败。最终候选以现有预算内通过的上限为准。Worker 回执 SHA-256 `054a3316d9fa6599b2be20bd85bf9a2125287cb6572b8faa99107e67988fd9cd`。
- 冻结包 8 件，共 360,388 字节。目录索引 SHA-256 `37f0a634c4cbc8fccefedaac31650fb44ff409757d67fd2cbe5cb3e073807c11`，WASM SHA-256 `ec6d167ec0eaf7d8a568485cc80608cad04227d07503d4f151e212b24b804aae`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/screenshot-pixel-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/screenshot-pixel-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 实际工具中心经确认调用 Host 和 Worker，读出三个原始像素 `#C8134D00`、`#0205F280` 和 `#0507040F`。超出右边界拒绝，撤权后结果清除并停止运行，重启再确认后重新读值。原件摘要一致。独立解压合成文件的 PNG IDAT 与界面输出一致。文件选择使用自动化夹具，系统原生选择窗口待集中验收。
- 首装、重启和独立读回回执 SHA-256 为 `e9b36ce6c94f070023fc1b41944a3c5e1059bcba1f60294a0ae5e50b8fd5eca7`、`a6c10aa92b3d734f94a585625201fd29c954d79dc178a6a0189e63dadd79cfd2`、`61d06a203d837376b1517b2c691d4940c259fd9d61bf5cfa9b473083c92ec42e`。
