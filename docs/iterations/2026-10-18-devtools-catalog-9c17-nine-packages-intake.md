# DevTools 9c17 目录及九包接收（2026-10-18）

## 目标与来源

Studio 只读接收 ZiDevTools 的不可变目录修订 `devtools-catalog-2026-10-18-9c17b7b91e84f1c7`，并把该修订引用的九份无签名候选和各自包外收据按原字节冻结在 Studio 的 `tests/fixtures/`。没有修改提供方程序，也没有安装、启用或授权任何新插件；用户决定暂不启用的 JSON Object 仍保持禁用。

## 接收结果

- 目录修订：14 文件、2,407,456 逻辑字节；修订 SHA-256 `9c17b7b91e84f1c7f83f82bdb81fe6553b01fc7699a1c423a54b7f153b65f830`；154 个唯一源 ID，目录索引及包外收据 matched。
- 九包冻结副本：2,723 个包内文件、16,020,032 逻辑字节。Studio 从自己的冻结副本重新核对 manifest、逐文件摘要、目录索引、包与操作映射及收据引用；九包均通过。这里的字节数是逻辑文件大小之和，不是卷空闲空间变化。
- 另存九份包外收据；`.gitignore` 仅为这份冻结目录添加精确例外，使 `release/` 下的 2,723 包内文件和收据可纳入项目记录，不改变一般构建产物的忽略规则。
- 映射：33/154 个不同源 ID 有包操作映射，另 121 个没有；54 个 capability 操作和 6 个 View 操作。54/54 capability 有目录元数据，九包 manifest profile 问题 0、未解析操作 0、缺失操作收据引用 0。Agent Assist 的 2 个操作、Spring Actuator 的 4 个操作是 View 定位入口，不可算作 Pi 动态工具或 WASI capability。
- 本修订新增 Spring 的明确 View 操作映射，解决旧修订的候选标签孤项；先前 27 项能力目录元数据缺失在新候选的**静态声明层**已解决。完整工具接受数仍为 **0/154**。

Studio 的 `audit-devtools-catalog-candidates.mjs` 增加 `executionSurface=view` 的独立核对：View 操作必须同时存在于候选 View 操作列表、manifest View 与包外收据；未知执行面拒绝。`verify-devtools-catalog-revision.mjs` 核对目录与迁移表的候选 View 列表。逐项缺口生成器按当前包数和映射状态生成新修订清单，旧 `3c7c`、`d084` 清单的 `--check` 仍通过。

## 验证证据

- `node scripts/verify-devtools-catalog-revision.mjs` 对提供方原目录和 Studio 冻结目录均退出 0。
- `node scripts/audit-devtools-catalog-candidates.mjs --provider-root tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle --catalog-directory tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7 --catalog-receipt tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-verification.json` 退出 0，逐包返回目录索引 `matched`、身份与文件清单一致。
- `node scripts/render-devtools-catalog-gaps.mjs --check --revision devtools-catalog-2026-10-18-9c17b7b91e84f1c7` 及旧两份清单检查退出 0；`bunx biome check` 对三份接收脚本退出 0。
- [154 项逐项缺口](../plugins/devtools-catalog-revision-gaps-devtools-catalog-2026-10-18-9c17b7b91e84f1c7.md)由冻结字节生成，不把候选映射误记为完整功能。

这轮仅改静态接收脚本和档案。普通 Studio Debug 仍被用户正在使用的实例占用，用户表示稍后退出；因此未重建 EXE，亦未对这九份新候选宣称真实 Host/Worker/Pi/View 或原生 UI 验收。历史 Diagnostics 0.1.4 的隔离运行证据仍只属于当时的包和测试范围。

只读 `storage-budget.ps1` 退出 0：`target` 22,551,541,310 逻辑字节、`.cache/task-scratch` 2,698,660,572 逻辑字节，E: 空闲 63,490,506,752 字节；预算超额是提示而非自动清理许可。没有触碰用户正在使用的 EXE、被拒绝清理的 `target/debug/incremental` 或任何旧缓存。

## 遗留与发布

121 个源 ID 无包操作映射；33 个已映射源工具也多只覆盖部分独立版范围。需要提供方继续交付相应能力或明确版本化 Host 接口需求，并交付正式签名包；Studio 后续逐包验收真实目录发现、按需加载、执行/View 定位、权限、超时取消、错误隔离、结果接力与确认写入，以及其他系统运行。完整 DevTools **0/154**；ZiFile 本轮未改变。没有改应用版本号、发布 Windows 版本、生成 ZIP 或删除构建缓存。

## URL 文本资源 0.1.1 运行续验

普通 Studio Debug 进程后来已退出。0.1.1 包的 `plugin.json` 与旧 0.1.0 不同；新包 95 文件、687,946 逻辑字节，在安装前由用例按包外收据逐文件复核。Studio 将现有隔离 Host/真实 Worker 的资源接力用例参数化，以冻结 `9c17` 的 0.1.1 包为输入。Host 来自当前源码测试程序，Worker 使用现有 `target/debug/zicode-studio-desktop.exe`（SHA-256 `ffd5d76f20b4fd494bc709ce973fe19d6cf8ff6b34d58c6a020ea6de371907b1`）；没有重新生成应用 EXE。

首次运行的用例沿用旧顺序，先启用插件后授权 `resource.read`；新包将此权限设为 required，Host 在启用时正确拒绝。修正为先授权后启用后，用例通过：错误 MIME 不可转交、预览要求确认、未确认提交拒绝、确认后真实 Worker 执行 `devtools.transforms.url.encode`，得到 `ZiCode%20OCR%20test%202026`、源字节数 20，资源记录数不额外增加。旧 0.1.0 候选在当前 Host 安装阶段因缺少 `output.schema.v1` 和 `tool.directory.v1` 的 `requiredProfiles` 声明被拒；历史完整运行用例已改为显式验证该拒绝边界，不修改冻结旧包。

最终 0.1.1 Host/Worker 用例与旧 0.1.0 拒绝用例各 1/1 通过，均使用同一当前源码测试程序。两次失败留下的隔离 scratch `url-text-provider-bd2bb457-8460-4ad2-847c-c38dc2991494`、`url-text-provider-41e3830c-801c-477b-91c4-d5693971cd2f` 保留为诊断线索；成功轮次自清理。`bun run check:rust:static` 退出 0（Cargo check、严格 Clippy 通过；全仓 fmt 仅提示既有漂移），改动文件定向 rustfmt 检查通过。测试中通过注册表接口授予隔离权限，不代表原生 UI 中用户完成授权。0.1.1 没有 Pi 工具声明，本次不宣称 Pi 动态调用；原生 View、正式签名包、完整源工具范围、超时取消和其他系统仍待验，完整接受保持 **0/154**。

测试后只读空间扫描退出 0：`target` 22,551,544,894 逻辑字节、task scratch 2,699,496,212 逻辑字节，E: 空闲 63,518,183,424 字节。未生成新运行目录或 ZIP，未清理缓存。

## 九包隔离注册表准入与 View 目录缺口

Studio 用冻结目录收据的九份包路径运行当前 `PluginRegistry::install_developer`，逐包检查安装返回 ID、登记版本、场景列表、默认禁用和权限全未授权；9/9 通过，成功后的隔离注册表自动清理。这是测试注册表中的 Host 清单与安装准入，不写用户插件配置、不启用 JSON Object，也不执行九包能力。九包此前已由独立只读脚本逐文件及收据核验；本用例不代替该核验、签名发行或真实 UI。

`cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop frozen_devtools_nine_package_bundle_passes_registry_admission_disabled -- --nocapture --test-threads=1` 退出 0，1/1 通过。`bun run check:rust:static` 退出 0，Cargo check 和严格 Clippy 通过；全仓 fmt 仍提示既有漂移，改动的测试文件定向 rustfmt 检查通过。成功后 `devtools-nine-registry-*` scratch 目录数为 0。

冻结目录的 Agent Assist 2 项、Spring Actuator 4 项虽有 View 操作映射，两包 manifest 仅声明应用与主 View；Studio 当前 `tool.open.v1` 只接受已声明 capability ID。因此它们不能作为单项工具进入搜索/收藏/最近，亦不能成为 Pi 动态能力。已形成[View 操作目录接口需求](../plugins/view-operation-directory-request-2026-10-18.md)，要求提供方先用现有 `application.directory.v1` 改善整包应用发现，六项单独定位待 Studio 实现新版本化合同，再由提供方交新版包/收据。已向授权的 DevTools 原会话发送具体字段与样例需求。完整接受仍 **0/154**。

后态只读扫描退出 0：`target` 22,551,617,132 逻辑字节、task scratch 2,699,496,212 逻辑字节，E: 空闲 63,513,161,728 字节。相比本轮前态，任务 scratch 逻辑字节未增加；没有删除缓存、构建应用 EXE 或生成 ZIP。
