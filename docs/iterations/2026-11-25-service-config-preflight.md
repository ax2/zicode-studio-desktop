# v0.7.9 · 本地服务配置预检

审核并启用 ZiDevTools `com.zicode.devtools.service-config` 0.1.0。在工具中心打开「本地服务配置预检」，选择并确认共享一份 ZiDevTools 导出的 UTF-8 YAML/YML。支持 Windows 换行和文件开头的 BOM。每份最多 16 KiB、64 个普通服务。密集字段或别名展开触及计算边界时，界面提示分批检查。

预检沿用独立版导入前置规则，检查非空 `services`、`repo`、`command`、可选停止命令和 100–60,000 毫秒的停止超时。报告显示条目序号、解析报错行列与设置项计数，省略路径、命令、健康检查地址和环境变量内容。

## Windows 验收

- 冻结候选 8 件、379,642 字节。目录索引 SHA-256 `8d8334246f084d78dd9d3453b3865be579bc42ec1416bed44243fb40007f992f`，WASM SHA-256 `a6e41a5467dfc81f495992067b80a790622333bc61d00a2b48863fc16b5d0c77`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/service-config-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/service-config-0.1.0-candidate-01-verification.json)
- 提供方精确测试头 `37875fea92c77554135bd45384fdecbf638d0257`。Windows 真实 Worker 50 项与独立版配置测试 4 项通过。包含兼容编码、配置字段、结构预算及 64 条完整诊断。保留原密集案例的计算上限证据。[ZiDevTools PR #33](https://github.com/ax2/zi-devtools/pull/33)
- Windows Studio 0.7.4 的正常工具中心通过首次 8 项和重启 1 项，覆盖逐次文件确认、超限提示、撤销清理与原件摘要一致。首装及重启回执 SHA-256 `98b154a92d1d00577e14c4d5758f67d3b5d753828429f228b85719c9e5846c94` 和 `36176cae2c4621b7c06446a4aa46feedf41f304eb685b8d998bc13b2bd18c953`。

源工具 `services` 1.8.0 的已交付范围是配置导入预检。配置写入、进程起停、健康探测和日志继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。系统文件选择和正式安装纳入集中验收。
