# 模型设置指引、确认本地化与名称保留

继续用户“精简界面、移除场景概念、提高日常可用度”的要求。上一轮窄窗遮罩修复已交付，本轮不重复该批验收。

## 改动

- 配置保存、凭据部分成功、模型渠道状态更新和配置切换的提示，不再要求用户寻找已不存在的“场景”入口。分别说明打开对话、重新打开模型设置、核对 API 密钥或新建对话后发送请求。
- 对话认证失败、通用模型错误、工具未启用/权限不足、翻译模型与 QVeris 缺少凭据等已知错误，提供不依赖场景概念的中文/英文指引。
- 删除已存 API 密钥、删除模型渠道及插入 Ollama 示例的确认经过同一语言管线。名称占位符用回调替换，保留名称中的 `$&`、花括号和中文。
- 实际 WebView 测试另外发现：渠道名 `Settings`、模型名 `Update` 被错误翻译为产品文字。对供应商名、渠道名、模型名、配置路径与渠道地址声明 `translate=no`；加载提示、模型健康状态及动作按钮仍可翻译。密钥编辑器的供应商名称和产品标签分别拥有内容边界。
- 仅改显示文本和内容边界；保留原 `sceneId`、Host 路由、凭据分区、版本检查和异步确认后的上下文复核。没有合并数据库、迁移数据、写用户凭据或调用模型。
- 大文件例外：`configStore.ts`、`ConfigTab.tsx`、`public/i18n.js` 仅作必要的文本、属性和字典局部修改。没有在大文件新增独立业务逻辑；新增验证放在独立测试文件。

## 验证与边界

| 项目 | 当前证据 |
| --- | --- |
| 新回归先失败 | 恢复文字/本地化 6 项失败、1 项隔离保护通过；名称原文测试在旧组件失败 |
| 最终回归 | 6 文件 67 项通过，覆盖错误指引、中英文确认、取消无写入、等待确认时配置切换、旧编辑器拒绝、名称/路径原文保留与产品按钮翻译 |
| 类型/前端/设计/构建 | 全部退出 0；既有 159 warnings、10 infos、终端生成样式 advisory 保留；无 Rust 改动或 EXE 替换 |
| 真实 Windows 设置组件 | 当前 Studio WebView2 挂载实际编译 ConfigTab/store，以独立内存渠道和凭据夹具测试中英文；真实鼠标点击，明确拒绝的确认回调验证文字；无有效会话时保存被阻止且输入保留；gateway/native 调用均为 0 |
| 实际产品入口 | 最终重新加载 Studio，打开真实模型设置入口；中英文均有内容，无可见“场景”提示，无框架错误遮罩、无 Runtime.exceptionThrown 或控制台 error |
| 资源 | 实际 Host 提供 i18n、settings/chat/translate bundle 的 SHA-256 与最终本地文件逐一相同 |
| 响应式 | 640×600、1000×700 测试组件中的输入区真实鼠标可命中；截图已查看。未声称更改 OS 窗框或验证其他平台 |
| 数据与普通启动 | 最终证据见下：原 26 文件 SHA、登记、固定目录选择与 SQLite 完整性；真实笔记 snapshot；普通启动单实例、19 个 DevTools 启用、9227 关闭 |

Browser 插件不可用，使用现有本地 WebView2 CDP。配置/凭据动作使用隔离内存夹具和拒绝确认回调，**没有实际删除用户密钥或渠道，也没有声称验收 Windows 原生确认框**。没有调用付费模型、生产服务、发布或外部消息，没有创建定时任务。

本轮未改变所有错误状态的存储方式；不宣称已有提示跨所有语言切换/所有错误来源的完整覆盖。旧兼容场景组件和底层隔离 ID 仍保留，因此也不宣称完成了全项目场景实现的删除或全部工具集成。

## 证据

会话证据根目录：`C:/Users/ax2/Documents/Codex/2026-10-22/clone-git-github-com-ax2-zicode`。

- `outputs/settings-recovery-live-before.json`：真实旧组件把用户名称译错。
- `outputs/settings-recovery-live-after.json`、`settings-recovery-640.png`：最终编译组件、中英文提示、拒绝确认与无写入、资源哈希。
- `outputs/settings-recovery-production.json`：最终真实产品设置入口的只读实测。
- `work/settings-recovery-regression.log`、`settings-recovery-check-final.log`、`settings-recovery-types-final.log`、`settings-recovery-build-final.log`。
- `outputs/settings-recovery-data-before.json`、`settings-recovery-data-final.json`、`settings-recovery-normal-final.json`。
- `outputs/settings-recovery-budget-before.json`、`settings-recovery-budget-after.json`；保留有用缓存。

失败与验证修正也保留：一次提升权限的 esbuild 写测试组件文件被系统拒绝，随后未使用更新组件的验证因此失败（`settings-recovery-live-stale-harness-failure.json`）；在原权限下重新编译测试组件成功。另一次夹具忘记设置活动目标，删除保护正确提前拒绝，所以确认框断言失败（`settings-recovery-live-missing-fixture-target-failure.json`）；修正夹具为有效目标并采用明确拒绝的内存确认回调后通过。未绕过任何产品删除保护，也未将这些失败称作产品成功。

固定数据仍使用 `D:/work/local-state/zicode-studio-desktop`，入口仍为 `D:/work/start-zicode-studio.cmd`。本轮只是持续优化的一个已验证交付，广泛目标继续保持进行中。
