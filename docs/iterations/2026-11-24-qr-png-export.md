# Windows Studio 二维码 PNG 另存

在「工具」搜索「二维码 PNG」，执行后选择「将 PNG 另存为…」。Windows 保存窗口建议文件名 `qr-code.png`。选址后，Studio 显示目标路径、文件类型和字节数，确认后才创建文件。目标也可以位于工作区目录以外。已有同名文件保持原样，用户可以换一个文件名。浏览器下载和结构化结果存档仍可使用。

## 范围

| 源工具 | 插件操作 | 本次范围 |
| --- | --- | --- |
| `qr`，源版本 1.0.2 | `com.zicode.devtools.compute` / `devtools.compute.qr.png` | 二维码 PNG 原字节另存、取消、独立确认和完整回读 |

Studio 从已捕获的 Worker 输出解码 PNG，验证方形、声明尺寸、一致的图像格式和明确的内存边界。另存授权绑定对应结果、格式、窗口、工作区、路由和文件位置。保存沿用现有原子无覆盖发布机制。PNG 导出没有增加插件权限，冻结候选及其收据保持原样。

该范围不改变生成端的输入上限或 Worker 预算。源工具在超长和复杂内容下的完整边界仍归 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)。本次只运行隔离测试，未更改日常安装和历史验收统计。

## 自动化

- 已逐字节核对 Compute 0.2.0 候选 01、0.1.0 候选 02 的 8 个包文件及各自外部收据。两个隔离 Host 都调用实际 Windows Worker，分别通过 4 个冻结向量。覆盖中英文输入、空输入和 2049 字节拒绝。两个候选的同一中文样例均另存出 12,239 字节 PNG，SHA-256 为 `6ce3d847f6c1c94a39d4b59ed2d813e71d66dadda43d2e736e0288676e333082`。取消、未确认、跨路由、跨格式、撤权、重放及同名文件冲突保留原文件，也没有遗留暂存文件。
- React 工具页验证缺少 Host PNG 引用时不显示另存按钮，取消选址可重新发起，取消复核不提交，另行确认只使用绑定到原 QR 结果的授权。相关图片预览、结果保存和原生网关前端用例共 107 项通过。
- 可复跑的 Host 测试为 `qr_png_frozen_worker_and_native_save`。以 `ZICODE_TEST_COMPUTE_PACKAGE` 指定含外部收据的 Compute 冻结候选，以 `ZICODE_TEST_WORKER_EXE` 指定 Windows 生产 Worker EXE，使用隔离工作区和合成向量运行。
- 原生文件选择窗口仍可随版本集中验收。本次自动化覆盖从选址返回后的真实 Host 写入流程和工具页面状态。

## 2026-11-25 · 从 UTF-8 文件生成二维码

在「二维码 PNG」中选择「导入 UTF-8 文本文件…」，选择不超过 2 KiB 的原文。导入保留 BOM、换行和尾部空白，保留已填写选项，可撤销。点击「执行工具」后才生成。输出仍用现有 PNG 下载或确认另存。

- Windows 本机用已确认的两个 Compute 候选和生产 Worker。1180 像素英文浅色、420 像素中文深色分别测试两版，四次 9 字节 BOM／中文／CRLF 原文均生成并下载同一 9,439 字节 PNG，SHA-256 `729b2802a74c46ebacac2cf86a758d8169917120210219f2f1873da18130b1cd`，与直接 Worker 输入逐字节一致。取消、撤销、无效 UTF-8、2049 字节拒绝和原件未变均已核对。
- Compute 0.1.0 候选 02 对应 10 月使用灰度 PNG 优化的包。其 WASM SHA-256 为 `7c564ea0e7bf19c5d9ce403954551baee746c7b32332d9f05ab92fda910c43f9`，包目录索引 SHA-256 为 `a0e8706a8e3042ce9642d837651b97a4018a38bfceeb4e1b60687535c0aedcda`。隔离 Windows Studio 已安装的 Compute 0.2.0 WASM 与冻结候选 01 字节一致，SHA-256 `136d1afa1ec0dd07f77bba5114f000cd8f8d7c16e2c80fa21418ab7bc9fbf3dc`，包目录索引 SHA-256 `80df46b911d352a55afc874f7c73aad509811ef3efb9065ce9b7925a47ae95ef`。两份冻结包各 8 个文件均通过收据校验。生产 Worker SHA-256 `1bf0adf0d8e3e8874eca61258ef133de9875dac87c0cbd76a83a45a2d7f2f1a3`。
- 2048 字节是原文的导入上限。重复 2048 个 ASCII 字符的实测输入被两版导入，生成时均耗尽现有 Worker fuel（退出码 1，`{"ok":false,"result":null,"error":"WASI fuel exhausted"}`）。界面保留草稿。2049 字节向 Worker 提交会返回 `INVALID_INPUT`。可生成范围继续由 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28) 跟踪。
