# Stage：Inspect 独立插件的命令面板真实链路

日期：2026-10-18。目标：补验新增命令面板来源筛选是否能把已安装的独立 ZiDevTools 工具送入当前 Studio 的“发现 → 按需加载 → 执行 → 展示”真实窗口链路。只复用此前由用户手动启用并允许的 Inspect 0.1.1 隔离配置；用户要求暂不启用的 JSON 对象插件保持原状。

## 环境与操作

- Windows Debug 现有 EXE 加载原位更新的 React/CSS 资源；`--tools-only --isolated-profile E:\zicode-studio-desktop\.cache\task-scratch\inspect-native-consent-20261017\profile`，1442×931 浅色窗口。该 profile 早前安装的 Inspect 0.1.1 仍可用，本轮没有安装、启用、授权或更新插件。
- 工具中心实际目录 24 项，其中 Inspect 来源 8 项。命令面板“具体工具”按“ZiDevTools 格式与检查”来源筛选后，计数为 8，列表显示 IPv4 CIDR、HEX/RGB/HSL、JWT 内容、Unicode 码点、NFC、NFKC、JSON→YAML、YAML→JSON；独立插件没有生成 8 个侧栏图标。
- 从筛选结果点开 NFKC 规范化，页面按需加载 0.1.1 的“输入文本”表单。输入无敏感样例 `ＡＢＣ１２３`，点击执行后，真实窗口显示“工具执行成功”和 `ABC123`。结果页提供“预览保存”“发送到工具”，本轮均未点击，未写入工作区。

## 证据与边界

技术博客同名 Stage 的 `screenshots/native-inspect-source-1442x931.jpg` 与 `screenshots/native-nfkc-result-1442x931.jpg` 已在实际截图中检查布局、文字和结果。隔离进程在关闭窗口后按精确 EXE/PID/profile 核对并结束。

这是当前 Windows Debug、无签名 Inspect 开发候选的**命令面板入口 1 项实际执行链路**，与此前工具中心 8/8 记录互补；不证明正式签名包、154 项完整目录、插件更新实时刷新、Pi 模型自主使用、其他系统或结果保存/跨包接力。DevTools 完整接受仍为 0/154，ZiFile 0/108。

前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、`site` 29,644,753 B 不变；task-scratch 1,412,478,887 → 1,412,327,590 B，未知项 0；E 盘空闲 179,970,048 → 178,671,616 B。低空间建议令扫描退出 1；没有删缓存、重编 Rust、发布版本或生成 ZIP。
