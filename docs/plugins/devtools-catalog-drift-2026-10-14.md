# ZiDevTools 目录在途变化与接入需求（2026-10-14）

Studio 对 `D:\Work\zi-devtools` 只读检查。提供方当前 HEAD 为 `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`，`docs/tools.json` 和 `docs/studio-plugin-migration.json` 均有**未提交修改**。本页是交接需求，不把在途源码复制到 Studio 冻结夹具，也不更新 154 项接受矩阵的基线。Studio 运行时不得依赖此路径。

将提供方 HEAD 的目录与当前工作树按工具 ID、版本、状态和范围比较：154→154 项，未增删；`agent-runner` 1.0.0→1.4.0、`super-clipboard` 0.5.0→0.17.0，两者范围变化、状态不变。目录头仍为 `0.82.0-dev.105`。当前工作树 `docs/tools.json` SHA-256 为 `45b33598923d9600127e03e660ced1aeec53545d9c35fcdc8e594ba23ea1ac04`，迁移清单为 `0f65dc2620f26462c8b07239218c6c2462da908a3ed9cdf8546c21b5b7980df6`；这些摘要仅标识此次只读观察，不是正式交付收据。

## 给提供方的交付要求

1. 完成这两项范围后冻结新的目录版本，附源码 revision、dirty 状态、目录/迁移清单摘要与逐工具版本；同一目录版本不能指向两份不同的工具范围。Studio 收到稳定快照后逐项重算完整 154 项矩阵，不以当前未提交状态覆盖旧证据。
2. `agent-runner` 的插件交付须拆清任务目标（2 KiB）、有界会话资料（合计 32 KiB、最多 32 项）、手选 UTF-8 文件和跨工具资料的来源及信任标记；只交给页面显示名，不泄漏原始主机路径。模型规划由用户触发，MCP 只读调用经明确批准并由 Host 按白名单、四次调用上限、预算、取消和审计约束。提供运行记录 schema v4、引用校验与失败/取消/来源缺失向量。不能让 WASI 插件自行启动 Ollama 或绕过 Host 调用 MCP；需要 Studio 的版本化 service/model/MCP/资源协议，当前尚未发布。
3. `super-clipboard` 须按 Windows 桌面能力逐项声明文本、图片、文件引用、HTML、RTF 与 OCR 的独立启用和权限；提供各格式容量、来源排除、复制回流、取消、标签/组合输出、快照 schema 1–7 迁移和错误向量。文件路径只能由可信 Host 转成待确认资源意图，插件页面不能直接获得任意绝对路径；OCR、富文本和文件内容不可自动上传或保存。macOS/Linux 未交付的功能须在平台矩阵逐项标为不支持或待适配，不能由 Windows 实现推断跨平台可用。Studio 尚无正式 `desktop.v1` 剪贴板/系统 OCR 回调协议。
4. 两项都需给独立版继续工作的证据，以及版本化插件包、清单、输入输出 schema、正反例、超时/取消/撤权、权限最小集、许可证、摘要和签名状态。现有 `plugins/trace` 等源码目录不是 `.zicode-plugin` 正式包；未收到新签名包前不得计为完整接入。

Studio 侧责任：先版本化通用 service/desktop 资源与调用接口，再按实际提供方包验证“发现→加载→执行→展示→接力/确认保存”和失败隔离。当前工作树变化不改变 `fullToolsAccepted=0/154`，也不影响 ZiFile 0/108 的独立阻塞。

## 2026-10-14 15:55 工作树续查（非冻结输入）

再次只读观察同一提供方 HEAD `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`：`docs/tools.json` 与迁移清单仍未提交，目录头仍为 `0.82.0-dev.105`，但当前文件 SHA-256 已变为 `c837c12af80e21950087d4201d40833016967dae043532ed184ce298be5e3713`、`2bef453eab27a56891c849533bde301a4c7096490cb540d6c79934b3b274a449`。相对 Studio 固定 dev.105 快照仍为 154→154 条、无增删；41 条版本/状态/范围变化，其中 32 条 scope 变化，9 条仅工具版本变化。`plugin-updates`、`plugin-market`、`explorer-menu` 从 planned 变为 in-progress。非忽略源码清单搜索仅发现现有 inspect/transforms/trace/diagnostics 开发目录的 `plugin.json`，未发现 `.zicode-plugin` 正式包；这不是对所有忽略输出目录的全盘枚举。此处摘要只标识一次在途观察，不能覆盖前述观察或冻结矩阵。

scope 变化 ID：`regex`、`disk-inspector`、`image-tools`、`image-batch`、`image-metadata`、`plugins`、`mcp-inspector`、`agent-runner`、`plugin-updates`、`plugin-market`、`java-thread-dump`、`java-dependencies`、`java-environment`、`java-gc-log`、`java-jfr`、`spring-config`、`spring-actuator`、`django-environment`、`django-migrations`、`django-sql`、`django-urls`、`django-drf`、`django-checks`、`celery-diagnostics`、`file-intake`、`task-center`、`recorder-tutorial`、`advanced-calculator`、`explorer-menu`、`screenshot-workbench`、`super-clipboard`、`image-workflow`。仅版本变化 ID：`ascii-codes`、`symbol-library`、`ascii-art`、`http`、`diff`、`json-path`、`json-diff`、`java-trace`、`django-trace`。

新增接收要求：提供方须先冻结新目录版本与源码 revision、逐工具版本和 scope 差异，再按独立包分别交付。`plugin-market` / `plugin-updates` 的目录和升级能力须映射到 Studio 自己的签名包管理、授权、回滚和跨平台生命周期接口；不能让外部插件自行更新 Studio 插件。`explorer-menu` 只能向 Studio 声明受支持的文件动作、类型和选中数量，由 Studio 注册单一系统入口、选择并确认，不能让 DevTools 插件单独改注册表或创建逐工具菜单。`agent-runner` 的后台任务和只读 MCP 白名单、`super-clipboard` 的原生格式/本机 OCR 仍分别需要版本化 Host 服务与桌面资源协议，不能由当前一次性 WASI 调用隐式获得。新范围中已验证的 DevTools 独立版行为可作为提供方证据，不能据此增加 Studio 的完整工具接受数。

## 原会话目录复核与交接

DevTools 原开发会话当前使用 `E:\zi-devtools`，其 HEAD 同为 `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`。后续复核时，该目录与 `D:\Work\zi-devtools` 的两份 JSON 文件逐字节摘要相同：`tools.json` 为 `ccbbcbcf2125eb186a689cd7c67bd58751cbc7ab46cf7178fb7d1a8f622da2f8`，迁移清单为 `21123c95d72fbe524c7a11d1eff8a9fe4c0241ad50c245741193d6f7ef0440aa`；154 个 ID 无差异。两处工作树都在变化，以上各摘要只对应记录时点，均不得作为稳定发布版本。已把本页接口需求发给 DevTools 原会话，请其返回需要 Studio 提供的具体 Host schema、回调与平台能力；Studio 只接收独立包和冻结证据，不修改 DevTools 源码。
