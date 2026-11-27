# v0.7.9 · 文本流程配方检查

在插件管理审核并启用 com.zicode.devtools.flow-recipe 0.1.0，到工具中心搜索「文本流程配方检查」。选择并确认一份本机配方 JSON 后执行。检查显示格式版本、起始与结果材料、每步动作和版本、影响类型及副输出。此操作只读取已确认的配方。

支持 ZiDevTools 原生配方格式 1–4、64 KiB 以内及最多 16 步。结果上限 16 KiB。确认后的普通文件快照与标为 JSON 的输出使用同一解析和动作注册表。未知动作、版本或材料不兼容时，报告配方无效。

## Windows 验收

- 真实 Studio Host 和生产 Worker 从普通文件回读三步配方，核对文件材料、表格操作、结果类型及原文件引用端口。确认前执行停用，撤权后结果清空，坏配方被拒，原文件摘要一致。Studio 回执 SHA-256 d34571352149a97c86b29dc4f17ea2700aef163d4268259ffd6199cf2aced27b。原生文件选择窗口保留集中验收。
- 提供方源码 6b99216f8287fdce716a8d89187ccdc5dd86ff26。20 项原生适配器与生产 Worker 对照及 25 项独立版定向回归通过。Worker 回执 f605663aedf17a428f17b82ca30c805b0a6e7fda3d49ce89170ec0af103832b9。初版遇到主机把本机 JSON 标作通用文件，失败回执 b8ff0af3db59ac460baa36f907167a379b2a5ca062d9d259e91a2a088f07537d。
- 候选 02 共 8 件、233,698 字节。目录 SHA-256 a9f740fcd4669b5342a82ad576d002145cdacebc25d25a4ecd4b914e84e97dd3，WASM SHA-256 8bc48e2b3e207b90168cce7c49310fd3c204a96e41c149e641caaa371ee8be9c。[候选目录](../../tests/fixtures/devtools-windows-file-tools/flow-recipe-0.1.0-candidate-02) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/flow-recipe-0.1.0-candidate-02-verification.json)

源工具 text-flow 的流程执行、编辑与保存、命名实例、配方库和结果接力继续在 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
