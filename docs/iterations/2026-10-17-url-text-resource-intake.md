# ZiDevTools 文本资源接收候选接收记录（2026-10-17）

## 目标与来源

Studio 需要把 OCR 产生的 `text/plain` 资源，经用户明确确认，交给独立 ZiDevTools URL 编码工具。只读检查提供方 `E:\zi-devtools\release\plugin-candidates\url-text-resource-0.1.0-candidate-02`，不修改 DevTools 源码或候选。候选的 `devtools.transforms.url.encode` 属于 URL 工具的单能力资源输入适配，不代表 URL 工具完整范围或 DevTools 154 项完整接入。

## 收据和冻结副本

提供方收据标记 `unsigned_provider_candidate_not_host_accepted`，源修订 `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8` 且 dirty；没有签名 `.zicode-plugin`。Studio 独立遍历候选目录并逐项比对收据中的路径、大小、SHA-256：92/92 匹配，合计 603,424 字节，额外/缺失文件 0，重解析项 0。WASM 摘要为 `ff233c72dcec2199aee7b559d6be9c1405e9d92ed72baaeb20b9468344dfe607`。相同字节冻结在 `tests/fixtures/devtools-url-text-resource-candidate02/`，外置收据在 `tests/fixtures/devtools-url-text-resource-candidate02.verification.json`；复制后再次逐项验证 92/92 匹配。不得为了通过测试更改这份夹具或摘要。

## Studio 实际接入结果

新增隔离 Host/Worker HTTP 验收门槛：重新核对冻结收据、开发模式安装、启用 `resource.read`、错误 MIME 拒绝、显式资源转交确认、实际 WASI 执行、编码结果和无自动保存。使用当前 `target/debug/zicode-studio-desktop.exe`（本地复用构建，应用版本 0.4.2）运行该门槛，**在安装时失败**：`Directory metadata requires schemaVersion 2 and tool.directory.v1`。Worker 未启动，未发生跨工具执行或结果展示；不把提供方自己的 Wasmtime vectors 算作 Studio 验收。

原因是 `plugin.json` 中能力声明了 `directory` 分类/别名，`requiredProfiles` 却只声明 `resource.input.types.v1`。Studio 的 `directory_metadata::validate` 要求同时声明 `tool.directory.v1: =1.0.0-preview.1`。源码检查还发现该能力声明 `outputSchema` 与 `maxResultBytes`，`output_contract::validate_contribution` 要求 `output.schema.v1: =1.0.0-rc.1`；这是当前失败后的下一道静态门槛，不声称已经从真实安装返回第二个错误。Studio 已将两项要求发给用户此前授权的 DevTools 原会话，请提供方生成新版本候选及全新收据，不原位改 candidate-02。

`bun run check:rust:static` 通过（Cargo check、Clippy；既有 rustfmt advisory 保留）；候选集成测试 0/1，失败位于注册表安装。失败 scratch `.cache/task-scratch/url-text-provider-65db4d10-bc70-4e0c-85c1-90b7588ecd55` 保留供诊断。没有生成 Release 或 ZIP，也没有重试此前被审批拒绝的清理。

构建/测试前只读盘点：`target` 29,398,976,379 逻辑字节，task scratch 800,262,668 字节，未知项 0，E 盘可用 54,424,289,280 字节。结束只读盘点退出码 0：`target` 29,399,124,662 字节 / 74,557 文件，task scratch 800,336,515 字节 / 30,625 文件，未知项 0，E 盘可用 54,426,087,424 字节。上述为独立读数，不把卷余量变化归因于本轮，也没有删除缓存。

## 遗留验收

收到新的未篡改候选后先验证逐文件收据与必需 profile，再运行 Host/Worker 和真实原生工具目录：搜索 → 按需加载 → OCR 文本显式共享 → URL 编码 → 展示结果；随后覆盖撤权、过期 grant、取消、失败隔离与未授权保存。当前包未签名、未正式安装，macOS/Linux 未实测；全量 DevTools 完整工具接受仍为 0/154。提供方的签名包、完整 URL 源工具范围和跨平台包仍需分别交付。
