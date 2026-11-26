# v0.7.9 · 从备忘备份提取 Markdown

审核并启用 ZiDevTools `com.zicode.devtools.memo-backup` 0.1.0 后，在 Studio 工具中心打开「备忘备份提取 Markdown」。选择并确认共享一份 ZiDevTools 版本 1 的备忘与日程 JSON 备份。留空执行可核对普通备忘的标题与原序号。输入一个序号再次执行，可预览并确认另存当前正文为 `.md`。

每份备份最多 128 KiB、64 条记录。序号沿用备份原顺序，排除日程和回收站后可能不连续。正文逐字节保留 UTF-8、原换行和尾随空白，支持空正文。只有用户确认共享后才读取快照，保存由 Studio 单独确认，备份原件保留。

## Windows 验收

- 提供方实际验证头 `c553d0d0d904dc9cdfeca4c293a8a564e196c753`。真实 Windows Worker 与原生适配器各 42 项通过，包括独立版实际导出备份的代入、最大长度、空正文和混合记录。[ZiDevTools PR #34](https://github.com/ax2/zi-devtools/pull/34)
- 冻结候选共 8 件、279,799 字节。目录索引 SHA-256 `9adb37b0d83bd396d3020bf2a71c0d60378fa1571ed732626630ff093df9baac`，WASM `e03a6c8ec32d55cfba99bbba451366ceda4c8410d5d38b8c0babf8b005f39fd5`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/memo-backup-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/memo-backup-0.1.0-candidate-01-verification.json)
- Windows Studio 的正常工具中心经真实 Host 和 Worker 验证逐次共享、取消保存、撤权和重启。实际保存 54、0 和 108,026 字节的三个 Markdown 文件，逐字节核对，与源备忘正文一致。重启后原保存文件仍可读。首装及重启回执 SHA-256 `6ef15c04d0b1f6b33018782019ce23b176e607674a3c909a5a891aa01d3754ff` 和 `153b62ffd672de98b5fc80eb1735fb3444874ff5273f4b59b960025508602a51`。原生系统选取窗口仍留集中验收。

这里覆盖 `memos` 1.5.0 的备份内单条提取。资料库恢复、合并、日程校验和提醒继续按 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
