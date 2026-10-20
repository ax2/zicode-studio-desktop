# DevTools 目录修订继续接收（2026-10-18）

## 范围

Studio 只读复核 DevTools 提供方的新不可变目录修订。未修改提供方、安装插件、启用 JSON Object 或变更权限；没有将候选包计入全量接受。

## Studio 修改

`scripts/audit-devtools-catalog-candidates.mjs` 保留原冻结夹具为默认输入，另支持 `--catalog-directory <directory> --catalog-receipt <file>` 显式选择一对不可变目录和外置收据。审计始终先验证目录，再按其 `package-map.json` 核对六个包的提供方文件、收据、manifest 能力和操作映射；运行时不依赖兄弟仓库路径。

## 接收结果

| 修订 | 目录验证 | 六包审计 | 结论 |
| --- | --- | --- | --- |
| Studio 冻结 `3c7c5aa8ad679a14` | 通过 | 通过 | 原基线；四包目录索引编码未获核验 |
| 提供方 `41ae80d96258362c` | 11 文件、2,108,924 字节、154 源 ID，通过 | 通过 | 四包中的三包改用已匹配目录索引；Text 七项仍无逐操作收据引用；Diagnostics profile 预检仍报错 |
| 提供方 `0ebfd50012e5bb29` | 拒绝 | 未继续 | `package_map_operation_mismatch` |
| 提供方 `4a8159184ab06895` | 拒绝 | 未继续 | 同上 |
| 提供方 `d7d61b707a89a366` | 拒绝 | 未继续 | 同上；不可作为已核验修订接收 |

`d7d...` 的七项 Text 操作（Base64 编/解码、JSON 格式化/压缩/校验、SHA-256、SQL 格式化）在 `package-map.json` 中引用 `text-plugin-0.4.1-candidate-02-verification-revision-01.json`，但同修订 `sources/studio-plugin-migration.json` 对应 `operationScopes` 缺少 `verificationReceipt`。Studio 的语义校验要求同一修订的两个映射一致；提供方应修复源映射并输出新的不可变修订及外置收据，不覆盖旧修订。需求已发给获授权的 DevTools 原会话。

`41ae...` 六包共 31 个不同源 ID、53 项 manifest 能力；Diagnostics 仍声明 `output.schema.v1` 却缺 `outputSchema` 和 `maxResultBytes`，Text 七项逐操作收据为空且包目录索引编码状态为 `encoding-unverified`。六包均无正式签名，本轮没有 Host/Worker、Pi、用户权限、界面或跨平台执行验收。DevTools 完整接受 **0/154**；ZiFile **0/108**。

## 验证命令

```powershell
node --check scripts/audit-devtools-catalog-candidates.mjs
bunx biome check scripts/audit-devtools-catalog-candidates.mjs
node scripts/audit-devtools-catalog-candidates.mjs --provider-root E:\zi-devtools
node scripts/audit-devtools-catalog-candidates.mjs --provider-root E:\zi-devtools --catalog-directory E:\zi-devtools\release\plugin-candidates\devtools-catalog-2026-10-18-41ae80d96258362c --catalog-receipt E:\zi-devtools\release\plugin-candidates\devtools-catalog-2026-10-18-41ae80d96258362c-verification.json
```

前两项及两个通过修订的审计退出 0；对 `d7d...` 显式输入时退出 1，报 `package_map_operation_mismatch`。执行前空间扫描：`target` 27,251,694,764 逻辑字节、74,162 文件、未知条目 0；E: 空闲 10,093,756,416 字节，低于建议储备线。本轮未清理缓存或构建原生程序。

收尾扫描时 `target` 变为 22,547,558,533 逻辑字节、53,195 文件、未知条目 0；E: 空闲 10,058,309,632 字节。期间本会话未执行删除，不能将目录变化归因于本轮，也不能从卷空闲量推算清理收益。只读检查仍见 `target/debug/zicode-studio-desktop.exe`，但 `target/release` 目录和项目 `release/` 下的完整 Studio 运行目录均未见到。后续发布或清理前须先核实 Release 留存位置；本轮不重建或继续删除。
