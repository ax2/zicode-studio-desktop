# JSON 对象候选 07 的包外收据接口需求

日期：2026-10-18。Studio 仅只读核验 `E:\zi-devtools\release\plugin-candidates\json-object-0.1.0-candidate-07` 及包外 `json-object-0.1.0-candidate-07-verification.json`，未修改提供方目录、安装或启用插件；用户决定暂不启用 JSON 对象工具保持有效。

## 当前可证明的内容

- Studio 逐文件核验 37/37、328,768 逻辑字节与候选 07 收据匹配；收据 SHA-256 为 `4ed07eb08eef4e6db86d3d245f707f4178b8088d643ca7799b1c9f6709615e3a`。清单 profile 预检无 issues，但明确 `preflightOnly=true`、`hostAccepted=false`。
- 候选 06 和 07 的 37 个包内文件相对路径、大小、SHA-256 完全相同，WASM、合同摘要与声明目录索引 SHA-256 也相同。新收据仅有两项 `sourceFiles` 摘要变化：`scripts/package_json_object_plugin.py` 与 `docs/tools.json`。因此候选 07 没有提供新的插件运行字节或新能力，不能据候选序号提升运行接受状态。
- 两份收据均声明目录索引 SHA-256，却缺 Studio 校验器要求的结构化 `directoryIndexEncoding`；Studio 报 `directoryIndex.status="encoding-unverified"` 且命令行退出 **1**。逐文件匹配不等于目录索引已获机器核验，更不等于签名或运行验收。

## 请提供方交付

1. 保留候选 06、07 及旧收据不变，新增一份包外修订收据，使用 Inspect 0.1.2 修订收据同类的结构化 `directoryIndexEncoding`：SHA-256、UTF-8、`files` 列表原顺序、`path,size,sha256` 键顺序、紧凑 JSON 分隔符、非 ASCII 原样编码、无末尾换行。让独立校验返回 `directoryIndex.status="matched"` 且退出 0；若包内字节改变，则另出新候选和完整收据。
2. 为下一次真实功能变更使用可追溯的新插件包版本或不可变目录修订 ID，明确 06→07 只是来源收据变化；不要把同一个 `0.1.0` 和不同候选号解释成已更新插件功能。
3. 完成正式签名包，并在收据绑定两项能力、profile、权限、输出对象合同、取消/错误语义与提供方算法向量。Studio 随后才可在隔离 Host/Worker/Pi/原生窗口按“发现→加载→执行→展示→结果接力”逐项验收；用户未授权启用时继续保持禁用。

目前 `signatureVerified=false`、`runtimeAccepted=false`，DevTools 全量完整接受仍 0/154。此请求只约束提供方交付字节和收据，不要求 Studio 引用 ZiDevTools 仓库或运行其独立 EXE。
