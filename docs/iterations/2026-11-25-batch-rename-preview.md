# v0.7.9 · 批量改名预览

在插件管理审核并启用 `com.zicode.devtools.rename-preview` 0.1.0。到工具中心搜索「批量改名预览」，切至「文件夹」，选择当前文件位置内的目录并确认共享名称。填写查找、替换、前缀或后缀后执行。查找替换为字面匹配，可选择区分大小写。规则只修改文件名主体，保留最后一段扩展名。

工具读取一层目录快照的相对名称和类型。结果列出原名、候选名、状态和问题。未填规则时显示未变化。仅大小写变化、重复目标、同层文件或文件夹占用及无效名称单独标记。检查以确认时的目录快照为准。插件只生成预览，源文件内容和目录名称保持原样。

单层快照最多 64 KiB、64 个目录项。来源名称合计最多 12 KiB，候选目标名称合计最多 16 KiB。每项规则最多 128 个 UTF-8 字节，报告最多 48 KiB，超限会明确提示。插件使用 `resource.read`、`resource.directory.read` 和 `resource.wasi.input.draft2`。

## Windows 验收

- Windows 隔离 Studio 经工具中心搜索、审核两项权限和确认目录后，实际 Host 枚举 6 个目录项并调用生产 Worker。5 个文件在空规则下保持原样，另验收 `File.txt` 仅大小写变化、`ab.txt` 与 `aab.txt` 指向同一目标、文件夹 `FINAL.TXT` 占用目标，以及 `photo.tar.gz` 保留扩展名。确认前执行停用，撤权后结果清空，测试文件内容、名称和目录结构前后一致。文件夹选择使用受控返回值，Windows 系统窗口保留集中验收。Studio 回执 SHA-256 `403cd9aba6fe6a2efcf870b324c104b78774f34df6ae31f4995258c1963e53c3`。
- 28 项生产 Worker 与原生适配器对照、8 项独立版定向回归通过。边界包括 64 项、12 KiB Unicode 源名称、接近 16 KiB 的候选名和替换膨胀。Worker 回执 SHA-256 `7e11dc6361641c42760027e91cd9582ecbc23e2a36c5040738eba87313532a14`。优化前极端长名称的燃料失败另行留存，SHA-256 `e125c474b4f2d4913c8dbb68d480b202d978763d4a0c1fdd1b987473ee9f754d`。最终候选使用同一 Host 执行预算。
- 提供方已验收源码 `acda24cff832d8db781ae24be20eac1618154192` 随 [ZiDevTools #15](https://github.com/ax2/zi-devtools/pull/15) 合入。候选 01 共 8 个文件、266,031 字节，目录 SHA-256 `29c714ed48a43ec6f044e3c25a44ad8596441b9c12a915087bd40a9f88d636db`，WASM SHA-256 `e02a2ee2ee04978c8f5603284e465489d18bc0e67025bafc990c6d3aa1ccce3c`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/rename-preview-0.1.0-candidate-01) · [逐件校验清单](../../tests/fixtures/devtools-windows-file-tools/rename-preview-0.1.0-candidate-01-verification.json)

源工具 `file-rename` 的原生多选、实际更名、提交前身份和目标复核，以及撤销范围继续在 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
