# Gmail provider for the built-in mailbox

The trusted workspace window calls `mail_gmail({accountId, request})`. The Host derives the workspace from its own window binding and resolves the selected Gmail account from the local accounts database. It never accepts a profile directory, arbitrary API server, account address, authorization callback or access token from this command. Gmail is separate from Pi model settings.

## Desktop OAuth client

Enable the Gmail API in the Google Cloud project, configure the OAuth consent screen and register a **Desktop app** OAuth client. For this development adapter, provision the client ID and desktop client secret to the Studio process as `STUDIO_GMAIL_CLIENT_ID` and `STUDIO_GMAIL_CLIENT_SECRET`; do not put their values in Git, logs, issues or test fixtures. Missing configuration is reported before opening the authorization browser. These identify the desktop client; they are not the user's credentials.

A person presses Connect to open Google's consent screen in the OS browser. A short-lived local callback checks the exact Host, path and state. A PKCE S256 verifier is retained only inside the Host. Studio verifies the authenticated Gmail address matches the local account. Only the refresh token and granted scope metadata are persisted, using the system credential vault, keyed separately for profile, named test profile, workspace and account. Anonymous isolated profiles cannot access this vault. Reauthorization and disconnect leave saved drafts untouched.

## UI contract

| Request kind | Input | Result / effect |
| --- | --- | --- |
| `status` | — | Local credential status and granted `read`/`send` flags; no network. |
| `connect` | `send: false` for reading, `true` to also request sending | Waits for explicit browser approval. Returns granted capabilities, never sends an email. |
| `cancel` | — | Cancels an outstanding authorization or Gmail list refresh. A cancelled request cannot write credentials or replace the cached page. The previous page remains available while the user retries. |
| `disconnect` | — | Removes local credentials, requests revocation and reports whether Google confirmed it. Locally cached mail and drafts stay on this device. |
| `list`, `cachedPage` | `cursor: null` or a previous token, `limit: 1..30` | Inbox metadata, subject/from/date, snippet and next cursor. Only `list` contacts Google; cache miss returns null. |
| `read`, `cachedBody` | `id` from the list | Returns metadata and plain text if available; does not execute HTML, fetch external images or load attachments. Only `read` contacts Google. |
| `send` | `draftId`, exact saved `revision`, `confirmed: true` | Only after showing the exact saved recipient, subject and content to the user. Supports one plain-text recipient, no attachments. Request uses the same account-scoped durable draft. |
| `delivery` | `draftId`, `revision` | Local attempt status, possible server message ID, or null. Never resends. |

`gmail_reauthorize` requests a new login; `gmail_permission_denied` may require explicit additional consent. `gmail_draft_changed` means reload and re-review. `gmail_attempt_already_recorded` means inspect delivery history instead of retrying. Before the single send request, the Host records the exact draft revision as unknown in a SQLite transaction. Timeouts, ambiguous server errors and interruption retain that state. A new, explicitly reviewed draft revision is required for a new attempt. Google accepting a message does not prove delivery to the recipient.

UI integrations must key asynchronous view results by account and generation, clear old content on switch, represent unconnected and uncached states distinctly, and never send as a continuation of authorization. List/body caches are local data in the selected profile (not encrypted by the credential vault).

## Verification boundary

Protocol tests bind only to loopback, use ephemeral OAuth credentials and synthetic messages, and override transport endpoints only inside Rust tests. A real Google test-user run and any external OAuth review are separate prerequisites to declaring Gmail publicly usable. No real account is used by CI.

References: [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending).

## 邮箱面板

在邮箱应用中选定 Gmail 账号后，默认只读本地连接状态与收件箱缓存。点击“登录 Gmail 以阅读邮件”才会请求 Google 授权；首次连接不请求发信。用户可取消登录、重新连接或断开连接，切换账号后不显示旧账号迟到的正文。点“从服务器刷新”读取在线邮件，离线阅读不会后台获取追踪图片或 HTML。

需要发信时，先单独授权发信、保存草稿，再核对发件账号、收件人、完整主题与正文，最后点击确认发送。授权完成不会衔接发送。桌面调用丢失回包时，界面仅查询本地投递记录；状态未知时引导先查看 Gmail 的“已发送”，不自动重投。公开分发及真实收发仍需完成上述 Google 测试账号和 OAuth 应用条件。
