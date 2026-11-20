# 阿里企业邮箱适配器

使用 [阿里邮箱官方企业域名配置](https://help.aliyun.com/zh/document_detail/36576.html)：IMAP `imap.qiye.aliyun.com:993`、SMTP `smtp.qiye.aliyun.com:465`，均使用隐式 TLS 并验证服务器身份。管理员须允许第三方客户端与 IMAP 服务；配置账号时应使用第三方客户端安全密码。没有后台轮询、账号探测或发送重试。

可信工作区调用 `mail_alibaba({workspaceId,request})`。账号及草稿由 `mail_local` 登记；每个请求必须包含当前工作区的 `accountId`，服务端据此取得账号地址。客户端不能指定任意服务器、端口、数据库路径、邮件发件人，不能读回密码。密码存入系统凭据库，按资料目录、命名测试配置、工作区及账号分隔，只在需要时读取。

| request.kind | 其他字段 | 结果 |
|---|---|---|
| credentialStatus / setPassword / forgetPassword | setPassword 需要 password | configured；查询还返回 enabled |
| sync / cachedPage | limit (1–40), cursor 可空 | {uidValidity,messages,next}，next 是 {uidValidity,before}；cachedPage 只读本机 |
| read / cachedBody | uidValidity、uid | {summary,text}；read 只请求已列出邮件，使用 BODY.PEEK，不设置已读；cachedBody 不联网 |
| replyDraft | uidValidity、uid | 创建并返回本地回复草稿；原邮件标识在同一数据库事务中保存，重新打开或编辑后仍保留回复关系 |
| send | draftId、revision、confirmed:true；可选 reply:{uidValidity,uid} | {status}；收件人、标题、正文按已保存草稿读取，回复标头取自本账号已有消息 |
| delivery | draftId、revision | {status}；未尝试为 null |

渲染器必须将返回的标题、地址及正文作为不可信**文本**显示，不应渲染原始 HTML 或加载远程图片。支持 MIME 编码标题和纯文本阅读，单封原文最大 4 MiB，单封摘要头小于 64 KiB。缓存只表示本机曾获取的消息，不承诺精确镜像服务器删除情况。

明确确认后，先将该账号、草稿和修订号的尝试记录写入 SQLite，再向 SMTP 提交一次。accepted 表示 SMTP 已接收，不代表收件人已读；rejected 表示收到明确拒绝；unknown 表示无法确认是否被接收（包括进程退出或最终回复丢失）。同一修订号再次提交时只返回已有结果，不自动再发。不要把 unknown 展示成“失败，请重试”。

独立回环协议验收：`cargo test --locked --manifest-path src-tauri/mail-alibaba/Cargo.toml`。夹具不连接或发送到真实邮箱，不往系统证书库安装证书。验收真实企业账号仍需账号所有者单独授权，并限制收件人为自有测试收件箱。
