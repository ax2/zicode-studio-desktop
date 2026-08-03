# 插件安全、权限与生命周期

## 信任模型

插件分为三类：

| 类型 | 信任 | 后台代码 | 分发 |
| --- | --- | --- | --- |
| Core/Built-in | 随应用签名 | Host 内置模块或受控 Worker | 应用安装包 |
| Local Development | 用户明确完全信任 | 独立进程 JavaScript Worker | 本地目录 |
| Marketplace 候选包 | 发布者签名 + 沙箱 | WASI Preview 1 | 未来仓库，当前关闭 |

iframe、CSP 和 Web Worker 是隔离层，但不是 Windows OS 沙箱。公开第三方插件不能在
只有这三种 Web 隔离措施时被标记为“安全运行”。Developer Mode 每次新增目录都必须显示
完整信任提示。

Developer Worker 使用桌面程序自身的隐藏子进程和不提供 Host I/O API 的纯 JavaScript
引擎。它隔离崩溃并允许 Host 在超时后终止，但仍不作为敌对原生代码的 OS 安全边界；
签名包只有声明 `runtime.wasi` 时才允许后台执行；JavaScript Worker 不对签名包开放。
WASI Runtime 不预打开目录、不继承环境变量或网络，并施加内存、燃料、输出和超时限制。
公共仓库仍由远程审核、撤销同步和分发运维门禁阻塞。

## 权限目录

### 低风险

- `storage.plugin`：插件自己的结构化状态和数据目录；
- `ui.notifications`：受频率限制的系统通知；
- `commands.executeOwn`：执行自己的 Command；
- `theme.read`：读取主题和本地化环境。

### 中风险

- `workspace.read`：当前授权工作区只读；
- `clipboard.read` / `clipboard.write`：仅在用户动作窗口内；
- `network.fetch`：通过域名和响应大小受控代理；
- `commands.execute`：执行其他插件公开 Command；
- `pi.session.read`：读取当前会话有限摘要；
- `pi.context.add`：向下一轮增加带来源的上下文；
- `pi.tools.register`：向模型暴露工具。

### 高风险

- `workspace.write`：修改工作区；
- `pi.prompt.send`：触发可能付费的模型调用；
- `pi.runtime.control`：改变模型、压缩或运行选项；
- `secrets.plaintext`：读取密钥明文；
- `network.private`：访问私网或环回；
- `process.spawn`：启动受控进程。

`pi.rawRpc`、任意 Tauri IPC、任意进程启动和跨插件数据目录访问只对核心组件开放，不是
第三方可申请权限。

## 授权规则

- 权限授予按 `pluginId + sceneId + permission + constraint` 保存；
- 应用更新或插件小版本更新不自动扩大权限；
- 新增必需权限时插件保持禁用，直到用户确认；
- Scene Policy 可以拒绝已授权权限，例如 Finance 禁止任意 Shell；
- 临时授权可以限定为本次操作、本次会话或指定域名/目录；
- 权限提示显示发起插件、动作、资源、数据去向和是否可能产生费用；
- 权限撤销后立即更新 UI/Command/Pi Tool 注册并取消不再合规的调用。

## 包安全

安装流程：

1. 下载或选择包，但不执行；
2. 在临时目录中按文件数、大小和压缩比上限解包；
3. 拒绝绝对路径、`..`、NTFS Alternate Data Stream、设备名和链接逃逸；
4. 校验 Manifest、哈希清单、签名和引擎兼容性；
5. 展示发布者、来源、权限差异和 Contribution；
6. 用户确认后复制到不可变版本目录；
7. 原子更新 Registry；
8. 首次启用时再请求场景权限。

插件图标、Markdown 和 HTML 同样是不可信输入，必须消毒；SVG 禁止脚本、外部资源和事件
处理器。

## UI 隔离

- 通过 `zicode-plugin://<opaque-install-id>/...` 提供静态资产；
- 每个插件使用独立 Origin；
- 默认 CSP：`default-src 'none'`，只放行包内脚本、样式、字体和图片；
- 禁止 `eval`、远程脚本、Service Worker、弹窗、下载和顶层导航；
- iframe 使用最小 `sandbox` Token；
- 网络、剪贴板、文件和外链全部经 Host SDK；
- Host 对消息来源、插件实例、View ID、大小、频率和 Schema 做校验；
- 插件不能访问 Shell DOM 或其他插件 iframe。

## 数据与密钥

- 插件状态、数据、缓存分目录保存，缓存可随时清理；
- 持久数据默认按场景隔离，插件必须声明才能使用 Global 数据；
- Secret 存入 Credential Manager/DPAPI Broker，日志只记录 `secretRef` 后四位之外的
  不透明摘要；
- 日志、诊断包、崩溃报告和 Pi Tool 输出都执行敏感字段脱敏；
- 删除插件默认保留数据，删除数据和 Secret 是两个独立确认项；
- Notes 等用户内容必须提供可读的 Markdown 导出，不能只存在私有数据库。

## 激活与停用

激活步骤：

1. 核对当前场景启用状态；
2. 计算有效权限（用户授权与 Scene Policy 交集）；
3. 注册静态 Contribution；
4. 在触发 Activation Event 时启动后台 Runtime；
5. 等待 `activate()`，默认 5 秒；
6. 注册 Handler，并只公开 Manifest 中已声明的 Capability。

停用步骤：

1. 从导航、Command 和 Pi Tool Registry 移除新入口；
2. 发送 AbortSignal 取消调用；
3. 调用 `deactivate()`，最多等待 3 秒；
4. 关闭 iframe/Worker 和资源 Handle；
5. 写入脱敏状态与审计结果。

插件崩溃采用每插件熔断：一分钟三次激活失败后自动禁用本次窗口，其他插件和 Chat 不受
影响。

## 审计

需要审计：

- 安装、更新、回滚、启用、禁用、卸载；
- 权限授予、拒绝、撤销和约束变化；
- Pi Tool 注册与调用结果；
- 插件发起的 Prompt、费用确认和取消；
- 工作区写入、网络域名、外部打开和 Secret 使用；
- 数据迁移与恢复。

审计只记录必要元数据、输入哈希、资源类型、耗时和稳定错误码，不记录 API Key、网页
正文、完整 Prompt 或笔记内容。

## 更新与迁移

- 更新包与已安装版本并存，切换前不覆盖旧包；
- `migrate(fromVersion, toVersion)` 在临时数据副本运行并必须幂等；
- 迁移成功且插件首次激活成功后才清理备份；
- 失败自动回滚 Registry、权限保持不变并提供诊断；
- 降级时若数据不兼容必须明确阻止，而不是尝试静默读取；
- Core 插件随应用更新，仍执行同样的数据迁移测试。

## Threat Model 验收

实现公开第三方插件前至少覆盖：

- Zip Slip、符号链接和 Windows 设备路径；
- iframe 逃逸、XSS、跨插件消息伪造；
- SSRF、DNS Rebinding、重定向到私网；
- Secret/Authorization Header 日志泄漏；
- Capability 递归和循环调用；
- Pi Tool Schema Bomb、超大输出和超时；
- 更新签名替换、降级和供应链撤销；
- 禁用/卸载中的竞态和悬挂工具调用；
- Scene 切换后使用旧权限或旧 Runtime Token。
