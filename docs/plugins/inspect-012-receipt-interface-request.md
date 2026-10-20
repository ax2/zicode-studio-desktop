# ZiDevTools Inspect 0.1.2 包外收据修订需求

日期：2026-10-18。Studio 接收方接口需求；不要求 ZiDevTools 引入 Studio 源码、配置或运行环境。

## 当前输入与失败

候选：`inspect-0.1.2-candidate-01`，包外收据：同名 `-verification.json`。Studio 独立逐文件校验通过 616/616、2,341,254 字节，清单 profile 预检无问题。目录索引摘要虽经单独紧凑 JSON 重算匹配，但 `directoryIndexEncoding` 从 0.1.1 的结构化对象变为自然语言字符串；Studio 的版本化收据校验结果是 `encoding-unverified`，不能把它记为完整目录索引契约通过。

## 请求提供方交付

1. 保留当前候选和原包外收据原样；仅新增修订收据，除非包内确有改动。这样避免复制同一 2.3 MB 候选或覆盖可追溯证据。包内改动时另出版本化新候选和独立收据。
2. 在新收据中将 `directoryIndexEncoding` 恢复为可解析对象：`hash:"SHA-256"`、`encoding:"UTF-8"`、`content:"files array in listed order"`、`objectKeyOrder:["path","size","sha256"]`、`ensureAscii:false`、`separators:[",",":"]`、`trailingNewline:false`。`directoryIndexSha256` 必须按所述实际编码重算，不改动每文件的原始摘要以迎合校验。
3. 说明文件列表顺序是否由提供方固定为按便携相对路径排序；如果要把排序列入合同，应给出大小写及非 ASCII 路径的比较规则和正反向量。当前 Studio 校验的是收据列表顺序与内容摘要，不推断自然语言的“sorted paths”算法。
4. 保持 `tool.open.v1` 8 个能力 ID、主 View ID、包版本与定位向量一致；收据修订不应暗改包内算法或 View。提供方若调整包内内容，更新全部对应摘要和版本记录。

## Studio 重新接收条件

用 `node scripts/verify-devtools-package.mjs <candidate-dir> <new-external-receipt>` 验证 616 文件集合、大小、逐文件 SHA-256 与目录索引 `status="matched"`；再运行 `node scripts/check-plugin-manifest-profiles.mjs <candidate-dir>/plugin.json` 检查声明。之后才开展隔离 Host/View 原生工具直达验收。无签名目录不会因收据修订变为正式发布包，也不会增加 154 项工具的完整接受数。

Studio 命令行接收器现对 `encoding-unverified` 退出 1（逐文件匹配报告仍会输出）；结构化 0.1.1 收据保持退出 0。这是接收门槛，不要求提供方复制 Studio 校验器。

## 提供方修订状态（2026-10-18）

已收到 `inspect-0.1.2-candidate-01-verification-revision-01.json`。新旧收据 `files` 数组一致，修订仅将 `directoryIndexEncoding` 改为上述结构化对象。Studio 对原候选与新收据独立核验：616 文件、2,341,254 字节，目录索引 `matched`，命令退出 0；本页第 1、2、4 项的收据侧要求已满足。第 3 项路径排序语义仍待提供方明确，当前校验仅承诺“收据列出顺序”。Host/View 运行、原生界面、正式签名包和全工具接入不由此结果自动通过。
