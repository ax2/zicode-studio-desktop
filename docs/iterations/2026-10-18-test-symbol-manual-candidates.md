# Stage：Studio 测试符号文件手工清理清单

日期：2026-10-18。目标是在 E 盘空间紧张时，给用户一个精确、可复核的手工候选清单，同时保留当前完整 Debug/Release 运行版本和可复用的编译缓存。本页只是只读盘点，实际删除 0。

## 候选

以下路径均在 `E:\zicode-studio-desktop\target\debug\deps\` 下，都是带构建哈希后缀的测试二进制 PDB，配套 `.exe` 均存在：

| 文件名 | 逻辑字节 | 修改时间（本机） |
| --- | ---: | --- |
| `zicode_studio_desktop-d670044f39e40e73.pdb` | 926,429,184 | 2026-10-09 10:15 |
| `zicode_studio_desktop-760be136197f2978.pdb` | 336,203,776 | 2026-10-18 06:41 |
| `zicode_studio_desktop-e785fad57fbbf853.pdb` | 333,090,816 | 2026-10-17 09:16 |
| `zicode_studio_desktop-c089dee89349ca51.pdb` | 332,804,096 | 2026-10-15 22:00 |
| `zicode_studio_desktop-d77db2cadabde158.pdb` | 321,859,584 | 2026-10-14 00:13 |

合计 2,250,387,456 逻辑字节；物理空闲空间的增量可能不同。删除 PDB 会失去这些历史/测试程序的调试符号，后续有需要可重编生成；不会因缺少 PDB 而删除配套 EXE。当前运行版本的 `target/debug/zicode-studio-desktop.exe`、`target/release/zicode-studio-desktop.exe` 都存在，`target/debug/deps/zicode_studio_desktop.pdb` 不在本清单内。按可执行文件路径未发现 `target/debug/deps` 下的程序正在运行；阶段档案中只有 `760be136197f2978` 的先前拒绝记录，没有把这些 PDB 作为不可变交付引用。

其中 `760be136197f2978.pdb` 曾被自动审批策略以 `blocked by policy` 拒绝单文件删除，实际删除 0；本轮没有重试，也未尝试删除其他候选。用户可自行决定是否手工删除上述精确文件；不要连同 `deps`、整个 `target`、当前无后缀 PDB、Debug/Release EXE 或增量缓存一并清理。

盘点时 E 盘空闲 156,016,640 B。未运行新构建、未生成 ZIP、未更改版本号。清理完成后的实际释放量与保留文件应另行复核，不能直接把逻辑字节当作已回收空间。
