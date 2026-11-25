# v0.7.9 · 知识源文件预检

在插件管理审核并启用 `com.zicode.devtools.knowledge-preflight` 0.1.0。到工具中心搜索「知识源文件预检」，切至「文件夹」，选择当前文件位置内的目录并确认共享名称。执行后会按 ZiDevTools 原生规则统计 Markdown、TXT、HTML、PDF、DOCX 和常用静态图片的候选数，并区分已排除、格式不支持和未扫描的子目录。

额外排除规则可填写相对名称、目录规则或 `*.扩展名`，按逗号、分号或换行分隔。原生默认目录规则同时生效。预检只接收当前一层的相对名称与类型，文件大小、内容完整性和可索引性留待正式扫描。

一次最多确认 64 KiB、64 个目录项，名称合计最多 12 KiB。额外排除最多 8 条，合计 960 个 UTF-8 字节，每条最多 120 个 UTF-8 字节。展示前 24 个候选名称，分类计数覆盖全部快照，超过 24 个候选会标记，报告最多 24 KiB。插件使用 `resource.read`、`resource.directory.read` 和 `resource.wasi.input.draft2`。

## Windows 验收

- 隔离 Studio 经工具中心搜索、审核两项权限和确认目录后，实际 Host 枚举 11 个目录项并调用生产 Worker。默认规则得到六种文件类型各一项、两个排除项、两个不支持项和一个未扫描的子目录。追加排除规则后保留四个候选。父目录规则被拒绝，撤权清空结果，测试目录结构和文件字节前后一致。文件夹选择使用受控返回值，Windows 系统窗口保留集中验收。Studio 回执 SHA-256 `1f2948e3d77547fab972ecdb44493c6078432dbf25022bd6e2b5c2b6c3895682`。
- 23 项真实生产 Worker 对照、4 项独立版定向回归及 1 项共享规则回归通过。最终候选在原 Worker 预算内通过 12 KiB Unicode 名称叠加 8 条排除规则的边界，保留优化前的失败。Worker 回执 SHA-256 `55ddc64df4c17957e917f113eb0f519c5ee987117ff7a231ac413a6ff8bf7796`，失败回执 `602aaf261cbb3134dc7323c1f0acabc4811f4314e6d89676f089a65fba8215e3`。
- 提供方源码 `2ba56f5ac541e888f241c148bcbf2bb5334ed87b` 见 [ZiDevTools #16](https://github.com/ax2/zi-devtools/pull/16)。候选 01 共 8 个文件、262,649 字节，目录 SHA-256 `34cd4d63fc5db0bcae850ac74530a14ca7b242cca39b5672c4dfac9434777227`，WASM SHA-256 `784d307906151005c6a3cec1ffcdf3cbb2f8b0b6207878caf61f031da47895bd`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/knowledge-preflight-0.1.0-candidate-01) · [逐件校验清单](../../tests/fixtures/devtools-windows-file-tools/knowledge-preflight-0.1.0-candidate-01-verification.json)

源工具 `rag-sources` 的完整目录扫描、文件大小和版本指纹、变更对比、知识源保存与索引接力继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
