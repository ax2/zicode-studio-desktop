# Stage：提供方活动目录与 JSON 候选 07 只读复核

日期：2026-10-18。范围仅 Studio 接收方；只读访问 `E:\zi-devtools`，未修改提供方文件、安装包、用户插件配置或权限。

## 发现

- 提供方活动工作树 HEAD `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`，312 条未提交状态。`docs/tools.json` SHA-256 为 `9bb3848d50b5516d4cea40638474d9a2db46df4d8f554008d456b9cb761b55f1`，迁移表为 `b4908e05e509dc4239f261584bea9d766252daa3d6ef58742a0bb005c6a3637c`。仍为 154 ID，新增/消失 0；相对 Studio 冻结 dev.105 有版本/状态 76、scope 70、discovery 76 项变化。后者上次为 18 项，新增 58 项主要补充关键词/别名（如 Base64、YAML），仍需正式目录修订和包映射；正式 `.zicode-plugin` 0 件。
- 活动源树仍在变化：07:45:52 +08:00 再读 `tools.json` / 迁移表的 SHA-256 分别为 `37353db759bad2df4320990a55b6c5d32b81058e75f3e98fc39646d1afd0499d` / `9a3a4c6a9be545f4d9b537058aeb6332015e41df1fb5804684b6532c3a287663`；154 ID 与 76/70/76 差异数量不变。此前摘要保留为更早观察，不作为当前交付收据。
- 对后一份源目录逐字段比较：关键词 75、别名 68、摘要 21、标题 8、分类 8 项变化，字段可重叠。目录 ID 未变不代表百项搜索体验所依赖的发现数据未变。
- JSON Object 0.1.0 candidate-07：逐文件 37/37、328,768 字节与外部收据匹配，清单 profile 预检 `issues=[]`、`preflightOnly=true`、`hostAccepted=false`。candidate-06 与 07 的全部 37 个包内文件路径、大小、SHA-256 相同；新收据仅改变打包脚本与源目录两个 `sourceFiles` 摘要，不是新增运行能力。
- 两份 JSON 收据均声明目录索引摘要但没有结构化 `directoryIndexEncoding`；校验器返回 `encoding-unverified`，**直接命令退出 1**。因 PowerShell 管线会掩盖上游退出码，已单独读取 `$LASTEXITCODE` 确认。未安装、启用或运行 JSON 对象插件，遵守用户“暂不启用”。

## 结果和边界

已更新[不可变全目录交付需求](../plugins/devtools-catalog-release-request-2026-10-18.md)和[JSON candidate-07 收据需求](../plugins/devtools-json-object-candidate07-receipt-request-2026-10-18.md)。Studio 不把可变源工作树、无签名候选或逐文件一致等同正式接入；冻结矩阵保持不变，DevTools 完整接受 0/154。下一步依赖提供方结构化修订收据、正式目录修订和可签名实包；Studio 收到后再做 Host/Worker/Pi/原生与跨平台验收。

两份接口需求已发送到用户指定的原 Zi DevTools 开发会话；该会话继续负责提供方改造，Studio 不在此工作树修改 DevTools。

前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 129,990,656 → 115,920,896 B。卷空闲变化无法由这四棵树解释，不归因于只读接收核对；预算脚本因低空间建议退出 1。未创建新 Debug/Release、ZIP，也未删除缓存。
