# v0.7.9 · 提取 PDF 单页文本

审核并启用独立插件 com.zicode.devtools.pdf-text 0.1.0 后，从工具中心搜索「提取 PDF 单页文本」。选择一份本机 PDF 并逐次确认，输入页码，点击执行。文件上限 128 KiB、32 页，每次读取一页的嵌入文本，预览最多 6 KiB。结果有总页数、页码、实际输出和截断状态。空白、直接绘制图片且无嵌入文本、其他无可提取文本分别呈现。加密、损坏、错误页码和超限会拒绝。

## Windows 验收

- 由提供方 f0d66c294b186636ac816f6e251425d4d8cc1455 合入 ed71e0accf912e8f71564572f754c6e0fe8176e2。16 个生产 Worker 用例通过，含普通与压缩双页、空页、图像页、无文本矢量页和边界。独立版 10 个原有文档解析测试通过，3 项真实 OCR 原本忽略。[提供方 PR](https://github.com/ax2/zi-devtools/pull/11)
- 实际 Windows Studio 从工具中心确认合成文件后提取压缩双页的第 2 页。撤权清空并禁止执行，图片页报告无嵌入文本，损坏文件拒绝，原件摘要保持。实际回执 SHA-256 ee075dcb293f45e409280791538c33877ea0acd430918b80d25c765f3860b1f3。
- 候选 01 含 8 个文件、568,450 字节，目录 SHA-256 79078d06a6147c0fd091cec803d617dbe6dd24a1219bf9ef326d614ab2c2f926，WASM SHA-256 53e78045dbc16538eed638cb6bec64807ae7e3f8e7ecbb49c27452e20546686f。[候选目录](../../tests/fixtures/devtools-windows-file-tools/pdf-text-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/pdf-text-0.1.0-candidate-01-verification.json)

原生 Windows 文件选择、OCR、整文档检索与批量提取仍由 #29 跟踪。[接收进度](https://github.com/ax2/zicode-studio-desktop/issues/29)
