# v0.7.9 · 本机 HTML 正文预览

审核并启用 ZiDevTools 本机 HTML 工具后，从工具中心搜索「本机 HTML 正文预览」。选择并确认一份 UTF-8 `.html` 或 `.htm` 文件，可查看标题和正文摘录。支持 BOM，单个文件最多 16 KiB，正文预览最多 6 KiB，并在 UTF-8 字符边界裁切。

解析复用独立版的 `main`、`article` 和 `body` 规则。脚本、样式、模板、导航和页眉页脚不会进入摘录。链接显示文字，整个处理在本机离线完成。复杂文件可能需要拆分或另行复制正文。每份文件须单独确认，读取权限可随时取消。

## Windows 验收

- 候选 02 共 8 文件、890,230 字节。目录索引 `af8a32a23872caae07b12783fa4f9c92232bcf24d3afa21136f71cd176591fb2`，WASI `799f57c281bd2d1f6ef4537ca007f00e5f3e178ac8a65c39d53bb7a2597dcf90`。提供方源码 `9d7269c1c8a3c1d35740ccdda840022eafd2bb94`。[ZiDevTools PR #25](https://github.com/ax2/zi-devtools/pull/25)
- Windows 生产 Worker 40 项、独立版现有采集路径 4 项通过。首轮解析测试在密集标记用例超出预算，候选 01 的异常属性用例仍存在同类失败，均保留原记录。候选 02 正确处理普通 16 KiB、长引号属性，并对超限复杂度提示拆分。公共 Worker 预算保持。
- 全新 Windows 隔离 Studio 安装完整冻结包，初装停用，明确授予 `resource.read` 后启用。实际工具中心、Host 与 Worker 核对 16,384 字节有效输入、超出一字节、无正文、标记超限、中文摘录和输出裁切。每份文件选中后需再次确认共享，撤权清空输出，所有合成原件逐字节保持。重启后启用、权限及安装摘要仍然一致，再次确认的输出相同。初装及重启回执 SHA-256 `1ef43003837fc727f5c339be3e014764dbd8c5bc344cbe7cb0830f6ddbc687c7` 与 `76049124c6372f02319586955e3ecfc2c8aef6d3026a83b25a6a2e24235d507d`。

本次覆盖 `browser-clipper` 的本机单文件正文预览。在线抓取、知识源写入、去重、实体选包及正式安装版继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
