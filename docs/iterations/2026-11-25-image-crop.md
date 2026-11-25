# v0.7.9 · 单张图片裁剪

在 Studio 插件管理审核并启用 ZiDevTools Image Crop 0.1.0 后，从工具中心搜索「图片裁剪」。选择一张本机静态 PNG、JPEG 或 WebP，确认提供该文件。以原图左上角 (0, 0) 为原点，填写左侧、顶部、宽度、高度（像素），再点击「执行工具」。结果为无损 PNG，可以预览，或选择位置并确认另存。原件和同名目标保留。

## 文件、执行和保存

- 插件 ID `com.zicode.devtools.image-crop`，能力 `devtools.image.crop`，使用 `resource.wasi.image.crop.v1@=1.0.0-preview.1`。该配置只协商上述插件的一项能力。
- `resource.read` 和每次文件确认沿用 Studio 资源生命周期。Worker 只接收已确认的文件快照。派生资源与本次文件、版本、工作区和权限绑定。Host 核对结果格式、长度和裁剪尺寸后才登记资源。
- 输入和输出各限 32 MiB，原图单边 4096 像素、共 1600 万像素。裁剪与缩放共用已有 2 MiB 模块、30B fuel、10 秒、256 MiB guest、全局两个活动槽及每个插件一个槽。原图片 Worker 线协议只选择预算；裁剪合同由 Host 独立协商。
- PNG 预览沿用 Studio 的 8 MiB、4096 单边及 4 Mi 像素边界。超过预览边界的有效派生 PNG 仍可在确认后另存。按原始像素坐标裁剪；不应用 EXIF 方向。PNG/WebP 动画会拒绝。

## 验收产物

- 提供方源码 `466ecdfdf0aa3108250673e657af8b66d4e0fb2f`，提供方 main `590b0b0bdd7c8e5d62d961b84f670503ead5971f`。[ZiDevTools PR #8](https://github.com/ax2/zi-devtools/pull/8)
- 独立 0.1.0 候选 01 共 8 个文件、853,775 字节。目录索引 SHA256 `7f2e636ba2a63a687210265715a7d65754fc49e5a5c2f93702c6954612fdcfd6`。WASI 839,842 字节，SHA256 `47387e5df6267a877e10b843328294be5e2a7cd1da86072da9667404df9f9622`。Studio 独立验证器逐文件核对通过。候选未签名。
- 生产 Windows Worker SHA256 `1bf0adf0d8e3e8874eca61258ef133de9875dac87c0cbd76a83a45a2d7f2f1a3`。12 个固定样例核对 PNG 透明像素、JPEG、WebP、4096 边缘、1280×900 静态图片，以及越界、无效内容、错误 MIME 和动画拒绝。提供方原生共享核心和两构建 10 项、定向严格 Clippy、迁移生成检查通过。
- 使用实际工具中心资源和冻结清单，在 1180px 英文浅色及 420px 中文深色的本机无头测试中，从文件选择事件完成确认、录入四个像素数值、手动调用生产 Windows Worker 并显示 2×2 PNG 预览。前端夹具只模拟资源传输及权限收据；实际写入由隔离 Host 测试验证。通用资源、参数表单、图片预览与确认另存回归 79 项通过。前端资源 SHA256 `31b5f4851c1a1338e0b122c9ff904dae4183414f2e945fa3ea13d9dc7da07d83`。
- 实际 Host 用例 `image_crop_frozen_host_worker_and_confirmed_export` 读取 `ZICODE_TEST_IMAGE_CROP_PACKAGE`、`ZICODE_TEST_RESOURCE_WORKER_EXE`。从独立提供方冻结目录安装，隔离资料单独授权。实际 Windows Host + 生产 Worker 执行 4×3 → 3×2 裁剪，精确核对 RGBA 像素及原件。预览回读、确认另存与磁盘回读对应同一 94 字节 PNG，SHA256 `bc7e7251f664fc73ea0329556426e68ab37e085e35c80f5c0ad8158fdd401016`。拒绝未确认、取消、授权撤销、重放和同名路径。原冻结 Image Resize 0.2.0 的真实 Host + Worker 回归和配置协商测试通过。Windows 全目标检查和严格 Clippy 通过。候选重建和固定样例的命令见提供方 PR。

## 接续 · PNG 可视选区

确认一张本机静态 PNG 后，可点「预览裁剪原图」，从任意角拖动选区，选择「应用选区」填入原图坐标。用户可继续编辑四项数字，点击「执行工具」才调用插件。关闭预览会回收显示资源。换件或撤权会清除旧预览，应用选区前复核该次授权。原文件与保存边界沿用上一阶段。

原图预览限 8 MiB、4096 单边和 4 Mi 像素。带 PNG EXIF 方向信息、无法预览的 PNG 及 JPEG/WebP 仍可手动填写像素数值。预览不改变裁剪输入或 Worker 限额。

使用上述已核验冻结包、正式工具中心资源及生产 Windows Worker。在本机后台 Chromium 的 1180 像素英文浅色及 420 像素中文深色中，分别正向和反向拖动，核对授权撤销时四个字段不变。实际执行从 4×3 合成 PNG 裁出约定 2×2 像素，逐一核对 4 个 RGBA 值、原件和未执行前状态。

遮挡、标注、批量、原生 Windows 文件与保存窗口以及日常配置分发继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。当前清点沿用原日期的安装状态。
