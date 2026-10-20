# Inspect Unicode 原生工具流程复核（2026-10-18）

## 范围

复用既有隔离验收配置 `.cache/task-scratch/inspect-native-consent-20261017/profile`，以 `--tools-only --isolated-profile` 启动当前 Windows Debug EXE。EXE SHA-256 为 `3C1B68AB17A6D7C658BA1181DAA1EF7129D065F584A2F6303C3E3A9D79E32976`；仓库 HEAD `72f4b0ee99dff4778d407a66a78330a275593341`，工作树已有其他未提交修改。本轮没有构建、安装、启用或授权插件，也没有修改 ZiDevTools 源码。用户暂缓的 JSON Object 插件未被操作。

## 原生观察与结果

1442×931 浅色工具中心实际列出 24 项；在“搜索具体工具”输入 `Unicode` 后，稳定结果为 3 项：Unicode 码点、NFC 规范化、NFKC 规范化。点击 Unicode 码点才出现输入表单，证明目录发现与按需加载在此配置中可用。

输入 `A中😀` 并执行，窗口显示“工具执行成功”，JSON 结果逐项给出 `U+0041`/`41`、`U+4E2D`/`E4 B8 AD`、`U+1F600`/`F0 9F 98 80`；结果区可见“预览保存”和“发送到工具”入口。本轮没有点击这些入口、保存结果或转交其他工具。代表性真窗口截图保存在技术博客 `iterations/inspect-native-unicode-2026-10-18/screenshots/windows-light-unicode-result.jpg`，78,208 字节，SHA-256 `1e558ef262631f2e311825f82c20c849c52394f8470a6d7e2d151e13807d3552`。截图检查：结果与保存/转交入口可读，未见内容被侧栏覆盖；JSON 框内可滚动。

关闭窗口后托盘保活了本次 PID 51352；核对进程路径与启动时间后停止，复查没有 Studio 进程。运行前卷快照 E: 可用 8,126,464 字节；运行中一度约 1.7 MiB；退出后 `storage-budget.ps1` 显示 9,314,304 字节、`target` 逻辑 30,041,815,353 字节、`UnknownEntries=0`。只有事后预算扫描，不能用这些卷差额推断缓存清理收益。先前被审批拒绝的 `target/debug/incremental` 未删除。

## 验收边界

这证明现有 Inspect 0.1.1 的一项能力在当前 Windows Debug 真窗口完成“发现 → 搜索 → 按需打开 → 执行 → 展示结果”。没有验证 0.1.2 新候选、正式签名包、百项真实目录、结果接力/保存、插件升级或 macOS/Linux；DevTools 完整接受仍 0/154，ZiFile 0/108。当前上游 Pi 最新正式版为 1.3.0，与仓库锁定版本一致，无升级动作。
