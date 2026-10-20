# Stage：文本结果接收目录取消过期搜索

日期：2026-10-17。目标是在工具数量扩大时，让普通文本结果的接收工具搜索及时释放旧请求。仅修改 Studio；DevTools 提供方包、授权协议和应用版本不变。

## 发现与修改

真实隔离 Debug 中从 Inspect 0.1.1 的 NFKC 规范化执行合成 `ＡＢＣ１２３`，结果为 `ABC123`；“发送到工具”显示 8 个兼容字段映射。最初误以为它应排除 NFKC 自身，复核后确认这是 `POST /v2/plugin-results/targets` 的普通文本结果接力，同一工具可以接收下一轮计算。上阶段的 `GET /v2/plugin-tool-directory` 分页前排除只适用于带 MIME 的资源输出接力；本次界面不能验收该资源接口。

普通文本接收目录此前用序号忽略迟到响应，但新搜索、视图切换、关闭或卸载后，旧 HTTP 请求仍在进行。Studio 网关的 `searchTargets` 现在接受可选 `AbortSignal`，可信接力界面在新搜索、转到输入/预览、取消和销毁时中止在途目录请求。旧客户端不传信号时请求体保持不变；取消不触发保存、授权确认或工具执行。

## 验证

- 网关与接力定向 Vitest 2 文件 51/51，通过新搜索中止前一请求、取消/销毁中止请求、网关传递信号、原分页/收藏/最近/预览/确认回归。
- `bun run typecheck` 与 `bun run check` 均退出 0；Biome 报 147 warning、10 info，设计检查仍有 1 项生成文件 inline-style 提示。相关文件 `git diff --check` 退出 0。
- 两次 `bun run build:local` 均成功，复用同一 `target/debug` 完整运行目录，缓存资源均命中，版本仍 0.4.2。第二次构建后的 EXE SHA-256 为 `20F312C9797EEA6A5E47E2B1EDE04771383E8366DBAA65283F0C9FBE91C5341D`；`public/native/plugins/plugin-result-transfer.js` 与 `target/debug/public/native/plugins/plugin-result-transfer.js` SHA-256 均为 `394EBA7513BA6E19E7B4B3E56052E5851CE80A86C6785EF18497B94DE64EDD75`。
- 本次原生 NFKC 执行和接收目录截图发生在第二次前端取消改动之前，只证明当前 Host 的普通结果查询仍可用；没有注入慢查询，因此不声称新取消行为已有原生慢 Host 验收。弹窗没有执行接收工具或保存数据，随后取消发送并按确切路径及隔离参数停止测试进程。

## 空间与边界

构建前只读扫描 `target` 30,011,610,106 B，最终为 30,011,794,438 B，新增 184,332 逻辑字节；非 scratch `.cache` 均为 355,458,670 B。最终 task scratch 1,137,982,896 B，未知项均 0。E 卷可用受其他进程影响，不将差值归因于本阶段。扫描因既有容量建议退出 1；没有清理有用缓存或生成 ZIP。

资源输出接力的分页前排除、真实慢 Host 取消、macOS/Linux 和正式签名包仍待验收；DevTools 154 项完整接受保持 0/154。
