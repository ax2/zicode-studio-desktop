# v0.7.9 · ZiDevTools 插件清单预览

从仓库获取[冻结目录](../../tests/fixtures/devtools-windows-file-tools/plugin-manifest-preview-0.1.0-candidate-02)和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/plugin-manifest-preview-0.1.0-candidate-02-verification.json)。按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对后，在插件管理安装候选，审核并授予 `resource.read`。

在工具中心搜索「ZiDevTools 插件清单预览」，选择并确认共享一份 ZiDevTools 独立版 `schema_version: 1` 清单。运行后查看包身份、原文件 SHA-256 和声明的工具。有多页时按照结果提示填写下一页起始序号，每页八项，最多可查至第 64 项。原文件保持完整。

预览校验工具声明、版本记录、内置操作及 HTTP 声明，并拒绝重复 JSON 键。HTTP 工具显示请求方法，地址、正文、样例、模型和原错误详情不会回显。该入口只提供离线预览，源插件安装、启用、签名、连接及升级比较仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。文件上限 256 KiB，剔除 JSON 外围空白后，文档字节与每个对象字段各计 128 字节的总工作量上限为 288 KiB。引号外内容最多 32 KiB，结构及转义工作量上限 4096，单项 HTTP 声明地址上限 2048 字节。

## Windows 验收

- 提供方 [ZiDevTools #56](https://github.com/ax2/zi-devtools/pull/56) 合入 `97b1e299444084ebcfd48a4be36f71de649e9fbc`。候选 02 冻结源码 `16913e7d97a3c937ddab550db30bbb345cc7adf3`，74 件、925,572 B。目录索引 `e34ff9d18d8cab7ad945cfd69d1e0da518582c750a531198890aacd240d012f3`，逐件收据 `e8a66878b11f143a62a4d07ca37ab4c223b16d37746af9b445242efe044deb05`，WASM `07d922c5f3c21812f400fbc72f7814d3341b020c52ee97b0dbc0211b07ffb67c`。
- 真 Windows Worker 46 项与原生适配器一致，覆盖 64 个工具、精确 256 KiB 和组合边界、重复键、声明拒绝与脱敏。独立版插件回归 21 项，文本流程回归 2 项。首个候选因宿主输出清单结构深度被拒绝，候选 02 只调整声明，WASM 同字节。
- 使用现有 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`，隔离资料通过正常工具中心首装六项、重启两项。来源 SHA-256 匹配，撤回文件共享后结果清空，原文件保持，系统文件选择窗口保留集中验证。运行收据 `a0b047e48f8090f17c5a0aaadcd45c5b7213feb0724fd07e8d5661f6d355953c`、`e6793ff1051e6ec73283ac573a323b3d1b73a6d3a3ae5742eb8d2b1d786f5985`。
