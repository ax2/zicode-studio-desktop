# v0.7.9 · 录屏章节元数据

在工具中心搜索「录屏章节元数据」，选择并确认一份本机 UTF-8 JSON 计划。用 `durationMs` 指定视频总时长，`chapters` 中各项写整数毫秒 `startMs` 及可选的 `title`。执行后可预览并确认保存完整 `FFMETADATA1` 文本，Studio 保存为 `.txt`。原计划保持完整。[FFmpeg 格式规范](https://ffmpeg.org/ffmpeg-formats.html#Metadata)

计划最多 32 KiB，每份最多 256 个标记，时长最多 31 天。参与导出的标题最多 512 个 UTF-8 字节。有效起点严格递增，每章结束于下一起点，最后一章结束于总时长。达到或超过总时长的标记跳过，空标题沿用原生自动名称。超过 48 KiB 的元数据整份拒绝。源工具 `recorder-tutorial` 0.11.2 的录屏、实时标记、媒体写入和系统权限仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `5b2373826d14bae9f5d29bea9033a8854584ba86`。真实 Windows Worker 和原生适配器共 28 项逐一通过，涵盖完整输出、48 KiB 边界、标题续行与转义、无效时序和独立解析。原生共享实现既有 4 项通过。Worker 回执 SHA-256 `40ff5efa56b9335ece0bafc0176b8a2bf82154865546acbcef6ded6ca80a2be4`。
- 冻结包 8 件、227,137 字节。目录索引 SHA-256 `b0eb7d30ec54653e061c1e343e46ff223be7a1bbddeda7936b427fa0041e84f8`，WASM SHA-256 `e2403e78282b1957ceb9393b31c2a9dcb8e272ec80ac25daab8d0bff8bd99aba`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/recording-chapters-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/recording-chapters-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 的工具中心通过单份资源确认、完整预览、取消及确认保存，输出 223 字节。源计划摘要保持不变。重启后的实际产物与原生输出逐字节一致，独立解析得到三个章节和原始标题，标题中的换行与方括号没有改变章节结构。系统原生选取和自选目录留集中验收。
- 首装和重启回执 SHA-256 `3ee30d8579051c8eb243c06a4aaa37a820751ed07f5831678e22806103a453ed` / `d6c7f3eb4aa6664b81462e96676c3163e4cd72e6d44eddcc2bd0927fd0f68565`。
