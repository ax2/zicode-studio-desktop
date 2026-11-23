# ZiDevTools 文件编码本机候选

编码检查支持非空文件至 8 MiB，并对整个文件严格解码验证，预览最多 256 字符。文件编码转换支持 8 MiB 输入、16 MiB 输出，手选七种源和目标编码并明确确认另存。

Studio 中搜索“检测文件编码”“文件转为 UTF-8”或“转换文件编码”。转换可选 UTF-8、UTF-16 LE/BE、GB18030、Big5、Shift_JIS 和 Windows-1252。UTF-8 和 UTF-16 可选择加 BOM。转换后有严格回读核验、目标字节预览及 SHA-256，保存需明确确认。

多目标入口要求 Studio 支持 resource.wasi.encoding-convert.v1。候选未签名，待 Windows Host 验证。
