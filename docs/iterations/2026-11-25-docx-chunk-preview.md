# v0.7.9 · DOCX 正文分块预览

审核并启用独立插件 com.zicode.devtools.docx-preview 0.1.0 后，从工具中心打开「DOCX 正文分块预览」。选择并确认一份本机 DOCX，再点击执行。从当前快照在内存读取 word/document.xml，原始文件和实际解压正文各限 128 KiB，归档最多 256 个条目。

保留段落编号、每块最多 800 字，相邻块重叠 100 字。报告列出段落、完整分块数及每块摘要，预览前 8 块和 6 KiB 文本，超出时标明截断。

## Windows 验收

- 提供方源码 8c588d6c3c028c404b696f4c7ae2488a366798f0。生产 Worker 17 个向量与原生适配器一致，独立版文档解析 10 项通过。3 项原有真实 OCR 测试保持忽略。[提供方 PR](https://github.com/ax2/zi-devtools/pull/12)
- 实际 Windows Studio 使用合成 DOCX 核对两段正文及分块。执行前逐次确认，撤权后清空，超过实际解压上限的文件拒绝，原件摘要一致。实际回执 SHA-256 16beeee076bb421cef85c819ed2e5e3fd4bd2b4689b9b6f6e19ea527d8005096。
- 冻结候选共 8 件、375,502 字节。目录 SHA-256 d8c5161e92790cfa9a40936914bf5d175bd658e95b9e34e9bcc5c1c758f6ad3d，WASM SHA-256 8a07d592dd62c25eccd7fe865af1e20d86e3469e94051a3d26af3fdec68fc836。[候选目录](../../tests/fixtures/devtools-windows-file-tools/docx-preview-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/docx-preview-0.1.0-candidate-01-verification.json)

这是源工具 rag-ingestion 的 DOCX 正文范围。其他格式、OCR、全文索引、导出及原生选择窗口继续跟踪。[#29](https://github.com/ax2/zicode-studio-desktop/issues/29)
