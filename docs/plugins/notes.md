# Notes 内置插件

Notes 是 P5 的本地优先 Markdown 笔记实现。一个 Notebook 对应一个独立 Vault；Markdown 和 Frontmatter 是内容真相，Astro 仅作为可选发布与内容集合适配层。

## Vault 目录

```text
plugin-data/com.zicode.notes/vaults/<vault-id>/
├─ astro.config.mjs
├─ package.json
├─ src/
│  ├─ content.config.ts
│  ├─ content/notes/<note-id>.md
│  ├─ layouts/
│  └─ pages/
├─ public/attachments/
└─ .zicode/vault.json
```

笔记 ID 使用 UUID，文件名不依赖标题；保存以当前文件 SHA-256 版本为前置条件，发生外部修改时返回 `version_conflict`。

## Host API

同源桌面 Host 提供：

- `GET /v2/notes`：列出笔记本、标签和笔记摘要，支持笔记本、标签、正文查询和网页剪藏过滤；
- `POST /v2/notes/notebooks`：创建 Vault 和 Astro 兼容骨架；
- `GET /v2/notes/note`：读取完整 Markdown 笔记；
- `POST /v2/notes/create`、`/save`、`/delete`：创建、带版本保存和带版本删除；
- `POST /v2/notes/capture`：受控抓取公开 HTTP(S) 页面。
- `POST /v2/notes/attachments` 与 `GET /v2/notes/attachment`：保存和读取受限附件；
- `POST /v2/notes/import-markdown`：导入普通 Markdown；
- `GET /v2/notes/export` 与 `POST /v2/notes/import-backup`：导出/导入包含附件的
  可读 JSON 备份；
- `POST /v2/notes/rebuild`：从 Markdown 重建 `.zicode/index.json` 并返回诊断。

所有接口都要求 Notes 在当前 Scene 启用并拥有 `storage.plugin` 权限。网页采集还要求 `network.fetch`。

## 网页采集边界

采集客户端不使用系统代理，不发送 Cookie、Authorization 或用户凭据；每次重定向都重新校验目标，只允许公共 IP，限制响应类型、重定向次数、时限和 2 MiB 正文大小。HTML 会移除脚本、样式、表单和嵌入内容，再转换为纯 Markdown。来源元数据记录 URL、采集时间、作者、发布时间和正文摘要，用正文摘要检测重复内容。

## Pi Capability

内置 Manifest 声明：

- `notes.search` / `notes_search`；
- `notes.get` / `notes_get`；
- `notes.create` / `notes_create`。

Pi 工具由 Host 生成快照并经 Broker 调用，仍受 Scene 权限、Runtime Token、输入输出上限、幂等和无正文审计约束。

## Chat 知识桥

助手消息可一键沉淀为结构化 Note，保留问题、回答、Session 来源与 `chat`/`captured`
标签。Note 编辑器的“带入对话”不会复制正文，而是写入 `zicode-note://<notebook>/<note>`
引用和 `notes_get` 参数，使 Pi 经现有 Capability Broker 读取最新版本。这形成
Chat → Notes 沉淀、Notes → Chat 继续推理的双向闭环。

## 附件、备份和重建

附件使用随机 UUID 文件名，按 Note 分目录，单文件上限 5 MiB，只允许常见静态图片、
PDF 和文本数据格式；SVG 和可执行文件被拒绝。Markdown 使用
`/attachments/<note-id>/<attachment-id>`，可由 Astro 的 `public/attachments` 直接
提供；桌面预览会改写为经权限检查的同源读取路由。

备份是可读 JSON，不是私有数据库快照，包含原始 Note ID、Markdown、Frontmatter 来源和
Base64 附件。导入会先校验完整载荷，再创建新 Vault；失败时清理导入目录，不覆盖现有
Notebook。重建操作始终以 Markdown 为真相，只写可删除的 `.zicode/index.json`，损坏
文件和孤立附件只报告、不自动删除。

P5 已实现 Vault、CRUD、标签与正文搜索、编辑预览、附件、网页采集、来源和重复检测、
Chat/Pi 能力、Markdown 导入、可读备份及索引重建。用户确认后可使用固定 Astro 与
随应用携带的 Bun 构建本地 `dist/`。增量协议提供游标、删除墓碑、自动压缩和
`resetRequired`；云端传输与端到端加密适配器仍保持关闭。
