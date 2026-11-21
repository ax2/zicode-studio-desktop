# Studio 页面设计验收

对应 [#255](https://github.com/ax2/zicode-studio-desktop/issues/255) 与 v0.7.2。后续页面沿用 [项目设计规则](../../DESIGN.md)。

|截图|环境与检查范围|
|---|---|
|[十个主入口](workspace-overview.webp)|同一隔离 Windows Studio Debug 运行目录，1280 × 820 浅色与 680 × 820 夜间。通过正常导航切换，关闭遮挡正文的抽屉后截图|
|[专用工具](tools-overview.webp)|8 个已启用应用从工具目录进入；文件名带 fixture 的 5 个应用使用真实编译组件及空数据，在 1280 和 390 宽度检查|
|[有内容的图库](asset-library.webp)|在原生 Catalog 使用 6 张仓库样图，候选 WebView2 资源，检查图片预览和卡片操作|
|[窄窗翻译](mobile-translation.webp)|从目录进入译文工作区，内容可见，导航抽屉已收起|
|[外部插件结果](plugin-result.webp)|隔离且已授权的 Inspect 插件，运行合成 IPv4 CIDR，窄窗显示结果及后续操作|

在集成提交 60ccf44e 同时验证六个工作分支，完整本机前端测试 3131 项通过，2 项跳过。对主入口分别检查重新编译的前端及 Git 记录的前端产物；在后一轮通过原生宿主读取三份样式、外壳模块、邮箱及视觉资产模块，SHA-256 与提交一致。复用已有 Debug EXE 和底层运行时，未构建发布安装包。更多分项证据及尚待验证的场景见 [验收记录](https://github.com/ax2/zicode-studio-desktop/issues/255#issuecomment-7062489816)。
