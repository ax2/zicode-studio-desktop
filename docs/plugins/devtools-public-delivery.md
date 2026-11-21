# 在新机器上取得 ZiDevTools 插件

Studio 的工具中心可以安装独立的开发插件。v0.7.1 的公开源码保存了下表九个提供方候选目录和对应的外部收据。可只取需要的包，在安装前逐文件核验。具备完整 Studio 源码的机器可直接使用现有目录，无需再下载。

| 插件 ID 后缀 | 版本 | 包目录（相对 release） | 核对文件数 |
| --- | --- | --- | ---: |
| inspect | 0.1.2 | plugin-candidates/inspect-0.1.2-candidate-01 | 616 |
| text | 0.4.1 | text-plugin-0.4.1-candidate-02 | 112 |
| transforms | 0.1.1 | plugin-candidates/transforms-0.1.1-candidate-01 | 804 |
| diagnostics | 0.1.4 | plugin-candidates/diagnostics-0.1.4-candidate-02 | 653 |
| json-object | 0.1.1 | plugin-candidates/json-object-0.1.1-candidate-03 | 43 |
| trace | 0.1.1 | plugin-candidates/trace-0.1.1-candidate-01 | 352 |
| url-text-resource | 0.1.1 | plugin-candidates/url-text-resource-0.1.1-candidate-01 | 95 |
| spring-actuator | 0.1.1 | plugin-candidates/spring-actuator-0.1.1-candidate-02 | 42 |
| agent-assist | 0.1.1 | agent-assist-preview-0.1.1-candidate-02 | 6 |

## 只取一个包

以下 PowerShell 示例使用 Git 和 Node.js 获取 Inspect。选择其他候选时，替换前两行的包目录和收据文件名。收据名由完整插件 ID、版本和 `-verification.json` 组成。使用新的短目录存放勾选的文件，保留 Git 的冻结字节属性。

```powershell
$package = 'plugin-candidates/inspect-0.1.2-candidate-01'
$receiptName = 'com.zicode.devtools.inspect-0.1.2-verification.json'
$catalog = 'devtools-catalog-2026-10-18-9c17b7b91e84f1c7'
$dir = "tests/fixtures/$catalog-package-bundle/release/$package"
$receipt = "tests/fixtures/$catalog/package-receipts/$receiptName"
$commit = '01b44da4fd8432a43d78f73cf5c022f3c7c56b60'
$dest = 'studio-plugin-inspect'
if (Test-Path -LiteralPath $dest) { throw '请选择一个新的目标目录' }
git init -q $dest
git -C $dest config core.longpaths true
git -C $dest remote add origin https://github.com/ax2/zicode-studio-desktop.git
git -C $dest config remote.origin.promisor true
git -C $dest config remote.origin.partialclonefilter blob:none
git -C $dest sparse-checkout init --no-cone
@('/.gitattributes', '/scripts/verify-devtools-package.mjs', "/$receipt", "/$dir/") |
    git -C $dest sparse-checkout set --no-cone --stdin
git -C $dest fetch --depth=1 --filter=blob:none origin $commit
if ($LASTEXITCODE) { throw '未取得冻结提交' }
git -C $dest checkout --quiet --detach FETCH_HEAD
if ($LASTEXITCODE) { throw '未取得所选文件' }
$result = node "$dest/scripts/verify-devtools-package.mjs" "$dest/$dir" "$dest/$receipt" | ConvertFrom-Json
if ($LASTEXITCODE -or !$result.verified -or $result.directoryIndex.status -ne 'matched') { throw '插件包校验未通过' }
$result | Select-Object fileCount,logicalBytes,directoryIndex,signatureVerified
(Resolve-Path "$dest/$dir").Path
```

在 Studio 的插件管理中选择安装开发插件，选择最后一行输出的、直接包含 `plugin.json` 的目录。检查插件声明后按需启用和授权，再到工具中心搜索具体工具。这些候选未签名。文件收据用于核对包的来源字节，各工具的实际功能和 Windows 验收范围见[逐项接入记录](devtools-all-tools.md)。

本次在空目录按以上命令从公开提交取得 Inspect，工作树中只有所选候选、外部收据、字节属性和核验工具。616 个文件共 2341254 字节，目录索引 SHA-256 为 `1d3af04bb9e35fa9594a673ff71058e56ffbb94e516f4086dba275472d1678ee`。当前 Windows Studio 的真实 Host/Worker 隔离测试用这份下载完成 8 项 Inspect 操作。其他八包在本次只复核了目录与收据。

## Windows 安装包与五个文件工具包

已回下载 [v0.7.1 Windows 正式安装器](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.7.1)。文件为 369638351 字节，SHA-256 为 `0f0b5e88bde0815b32c8d0faf5a9da72a86389052dbf87a299ba75de82547937`。NSIS 文件清单包含 Studio EXE，未发现 `tool-packages` 目录或 `plugin.json`。安装 Studio 后需另行取得上述候选。

历史 Windows 候选曾在运行目录旁放置文件摘要、校验清单、编码转换、JSON 文件查询与对比、JSON 文件格式化与校验五个包，共 38 个文件。上表的 JSON Object 是另一个包。这五个包的公开下载位置仍待提供方交付。Studio v0.7.1 与 ZiDevTools v0.82.0 的 Release 附件清单均未列出这五个独立包。[历史交付回执](https://github.com/ax2/zicode-studio-desktop/issues/28#issuecomment-6969557942)

提供方交付每个新包时，请给出不可变的公开下载位置、插件 ID、版本、完整包目录和独立的逐文件收据（相对路径、字节数、SHA-256、目录索引哈希及其编码）。Studio 可用同一核验工具接收，再验证实际运行。包在提供方独立构建；用户安装、启用和授权分别进行。[跨机交付跟踪](https://github.com/ax2/zicode-studio-desktop/issues/241)
