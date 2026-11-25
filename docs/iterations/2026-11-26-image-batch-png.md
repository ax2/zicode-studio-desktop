# v0.7.9 · 图片批处理（小型 PNG）

在工具中心搜索「图片批处理（小型 PNG）」，选择一至两张本机静态 PNG 并确认共享。最大宽度留空可保持原像素尺寸，填入 1–48 像素可等比缩小，较小的原图不会放大。执行后按输入顺序提供独立结果。每张可预览并单独确认保存到 Studio 文件。

每张输入最多 32 KiB，宽高分别最多 64 像素，支持 8 位通道静态 PNG。保持透明度，沿用原生 Lanczos3 缩放，采用无损 PNG 写入。重新编码可能改变压缩字节和元数据。动画、16 位通道、超限和其他格式会给出提示。任一已选输入无效，整批不提供部分结果。插件读取权限按次授予，两个源文件保持原样。

原生 `image-batch` 1.4.0 的大批次、其他图片格式、自选目标目录和部分提交继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `9ccb98a0cf0842ce470808b50b5f112b59a3ea76`。真实 Worker 和原生适配器 22 项逐一对照，包含 PNG 精确字节、像素回读、两个 64×64、透明度、等比缩放及边界拒绝。首次自适应 PNG 编码和较重尺寸组合的预算失败保留在提供方验证记录。最终候选使用无损低开销 PNG 输出，复用 Studio 原预算。
- 冻结包 8 件、465,299 字节。目录索引 SHA-256 `3dfefed04d31636c06aae6f038ee6f86d52108dbb1934c5b390cf33712938495`，WASM SHA-256 `0cf370eea2da4437b16cb4fc7c9fe6e54926e8c3e2df81c57201ac5c0f0e0e56`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/image-batch-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/image-batch-0.1.0-candidate-01-verification.json)
- Windows 隔离 Studio 的真实工具中心、Host 和 Worker 已确认取消两件共享后可单独提交第二张，只产生一个结果。明确共享两件后依序得到 32×27 和 32×40。取消第一张保存不落盘，第二张可独立确认保存，第一张重新确认后同样保存。
- 重启后两个实际文件分别为 3,551 和 5,228 字节，与独立原生适配器输出逐字节一致。原图摘要不变，撤权清除结果，重启后重新授权可复算。首装和重启回执 SHA-256 `a34131994fc338eb94c0dd32e9bae288e7e8f3563f36d84e9c94e682f98c9ff7` / `f717663c362dbbb4392ea3035eed523a443b6e2de3a0fbf00761f6a0e34fe52d`。系统原生选取和自选保存位置留集中验收。
