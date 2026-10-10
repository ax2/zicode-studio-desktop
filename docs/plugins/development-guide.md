# 插件开发指南

> 当前状态：Rust Registry、Manifest 校验、开发包生命周期、按 Scene 启停和权限持久化、
> Capability Registry、Chat 调用入口及 Pi Broker 已可执行。Developer View 已通过
> opaque sandbox iframe、限制性 CSP 和消息桥接运行；Notes 的 `notes.search`、
> `notes.get` 和 `notes.create` 是内置 Host Handler。Developer Worker 已通过独立隐藏
> 子进程执行同步 JavaScript Capability Handler；公开第三方包仍须等待 WASI 或等价
> OS 级沙箱。

## 前置条件

第一阶段 SDK 使用 TypeScript 类型和标准 Web API。项目自身仍使用 Bun；官方脚手架、
测试和打包命令也必须使用 Bun，避免同时维护 npm 锁文件。

## 当前 Registry 开发入口

桌面 Plugin Manager 的 “Install local plugin” 会打开目录选择器。选择包含
`plugin.json` 的包根目录后，Host 将源目录只读校验并复制到：

```text
%LOCALAPPDATA%\zicode\plugins\developer\<package>\plugin.json
```

也可以在开发阶段手动放入该目录。Host 只发现一级包目录。包目录或包内任意符号链接
不会被安装；Manifest 或资源路径不合法时插件保持未注册，并在 Plugin Manager 的诊断
区域显示原因。有效 Developer 插件默认禁用，全部权限默认拒绝。

同 ID 本地包再次安装会执行原子升级：新包先复制到 staging 并重新校验，旧包移动到
backup，只有新包成功注册后才删除 backup。失败会恢复旧包。当前限制为最多 2,048 个
文件、单文件 10 MiB、总计 50 MiB。

卸载只删除 `%LOCALAPPDATA%\zicode\plugins\developer\<plugin-id>`。用户选择的源目录、
场景权限记录和未来的 `%LOCALAPPDATA%\zicode\plugin-data\<plugin-id>` 不会被删除。

当前同源管理 API：

```text
GET  /v2/plugins?sceneId=<scene>
POST /v2/plugins/enablement
POST /v2/plugins/permission
POST /v2/plugins/reload
POST /v2/plugins/uninstall
GET  /v2/plugin-capabilities?sceneId=<scene>
POST /v2/plugin-capabilities/invoke
GET  /v2/plugin-views/source
```

前五个 API 管理 Contribution 元数据、启停和权限。后两个 API 是 Chat/应用层的
Capability 入口，Host 会重新检查当前 Scene、插件启用状态和输入 Schema。目录选择安装
只通过本地 Tauri 命令提供，远程浏览器不能提交本机路径。

`examples/plugins/view-demo` 是当前可运行的最小 View 示例。它只使用内联静态资源，
由 Host 注入 `window.zicode` 消息 SDK；iframe 没有 `allow-same-origin`、网络权限或
Shell DOM 访问能力。当前 View SDK 支持：

- `ready()` 和 `context.get()`；
- `setDirty()` 与离开页面前确认；
- `ui.showInformation()`；
- 执行本插件 Manifest 声明的 Command；
- 调用本插件 Manifest 声明的 Capability。

规划中的命令：

```powershell
bunx @zicode/create-plugin my-plugin
bun run dev
bun run validate
bun run test
bun run package
```

脚手架输出：

```text
my-plugin\
├── plugin.json
├── src\
│   ├── worker.ts
│   ├── sidebar.ts
│   └── main.ts
├── views\
│   ├── sidebar\index.html
│   └── main\index.html
├── assets\
├── tests\
├── README.md
├── bun.lock
└── tsconfig.json
```

## 最小 Command 插件

Manifest 只需要 Command，不需要 Activity 或 View；Command 自动进入 Command Palette：

```json
{
  "schemaVersion": 1,
  "id": "com.example.timestamp",
  "name": "Timestamp",
  "version": "0.1.0",
  "publisher": "example",
  "engines": {
    "zicode": ">=0.2.0 <0.3.0",
    "pluginApi": "^1.0.0"
  },
  "activationEvents": ["onCommand:timestamp.copy"],
  "runtime": { "worker": "dist/worker.js" },
  "contributes": {
    "commands": [
      {
        "id": "timestamp.copy",
        "title": "复制当前时间"
      }
    ]
  },
  "permissions": {
    "required": [{ "name": "clipboard.write", "reason": "复制时间" }]
  }
}
```

后台入口：

```ts
zicode.capabilities.register("timestamp.now", (input, call) => ({
  value: new Date().toISOString(),
  sceneId: call.sceneId,
}));

zicode.commands.register("timestamp.copy", (args, call) => ({
  message: `${args.label ?? "Timestamp ready"} (${call.sceneId})`,
}));
```

当前 Developer Worker SDK 提供同步 `zicode.capabilities.register(id, handler)` 和
`zicode.commands.register(id, handler)`。命令从统一命令面板或 View 的 Own Command API
进入同一个 Host Broker；Host 会先检查当前 Scene 中插件是否启用且命令是否唯一声明。每次
调用在独立隐藏进程中的纯 JavaScript 引擎执行，没有 DOM、`fetch`、文件系统、环境变量
或进程 API；请求不超过 256 KiB、Worker 文件不超过 1 MiB、结果不超过 1 MiB，Host 在
5 秒后终止进程。签名包不得使用 JavaScript Worker；后台入口必须是 `runtime.wasi`
指向的 WASI Preview 1 `.wasm` 模块，通过 JSON stdin/stdout 通信。WASI 不预打开目录、
不继承环境变量或网络，并受内存、燃料、输出和进程超时限制。

## 带主界面的插件

插件 View 不能直接 import Shell 模块。由 Host 注入的 SDK 建立握手：

```ts
import { connectPluginView } from "@zicode/plugin-sdk/view";

const view = await connectPluginView({
  viewId: "notes.editor",
  apiVersion: "1.0",
});

const note = await view.capabilities.invoke(
  "com.zicode.notes",
  "notes.get",
  { noteId: view.route.resource },
);

view.onThemeChanged((theme) => {
  document.documentElement.dataset.theme = theme.id;
});
```

View 必须处理：

- `loading`、`empty`、`error`、`permission-required`；
- Host 发出的 `routeChanged` 和 `willDeactivate`；
- `canDeactivate` 未保存检查；
- 键盘焦点退出 iframe；
- Theme、Locale 和缩放变化。

## 让 Chat 和 Pi 调用插件

先声明 Capability，再为其注册 Handler：

```ts
context.subscriptions.push(
  context.capabilities.registerHandler("notes.search", async (input, call) => {
    const matches = await index.search(input.query, input.limit ?? 10, {
      signal: call.signal,
    });
    return {
      matches: matches.map(({ id, title, excerpt, updatedAt }) => ({
        id,
        title,
        excerpt,
        updatedAt,
      })),
    };
  }),
);
```

如果 Manifest 同时声明了映射到 `notes.search` 的 Pi Tool，Host 会在当前场景已授予
`pi.tools.register` 时将工具暴露给 Pi。Handler 不应判断模型身份字符串，而应读取
`call.caller.kind` 和 Host 提供的有效权限。

当前可直接验证的 Chat 调用：

```http
POST /v2/plugin-capabilities/invoke
Content-Type: application/json

{
  "sceneId": "programming",
  "pluginId": "com.zicode.notes",
  "capabilityId": "notes.search",
  "input": { "query": "roadmap", "limit": 10 }
}
```

Pi 不直接调用这个端点。每个 Native Runtime 启动时，Host 生成当前 Scene 已授权的固定
工具快照并加载内置 `plugin-broker` Extension。Extension 使用一次 Runtime 令牌调用
`POST /v2/plugin-tools/invoke`；Host 校验令牌哈希、Runtime/Session 身份、当前工具授权、
Schema 和 `toolCallId` 幂等性。令牌和原始输入不会写入审计日志。

不允许：

- 直接编辑 Session JSONL；
- 从 View 打开原始 `/v2/ws`；
- 把完整笔记库塞进工具输出；
- 通过远程脚本动态改变 Tool Schema；
- 在后台静默发送 Prompt 或绕过费用确认。

## 测试层次

### Manifest

- Schema 和引擎范围；
- 资源路径、重复 ID、权限理由；
- CSP、包大小和 Tool Schema 上限。

### Unit

使用 SDK Fake Host 测试 Command、Capability、取消、超时和权限拒绝。测试不得依赖真实
用户数据或真实 API Key。

### Contract

同一组契约用例在 Developer JavaScript Worker 和未来 WASI Runtime 上执行：

- `activate/deactivate`；
- Storage 并发写入；
- Capability Schema；
- Scene 切换与权限撤销；
- Tool Call 幂等和取消。

### UI

使用 Plugin View Harness 在亮/暗主题、桌面/窄窗口、中文/英文环境检查：

- 无障碍名称和焦点顺序；
- iframe 大小与滚动；
- 加载、空、错误和权限缺失；
- `canDeactivate`；
- Host 崩溃/重连。

### End-to-end

至少验证：

1. 安装但未启用时没有 Contribution；
2. 在一个 Scene 启用不会泄漏到另一个 Scene；
3. Chat 可以调用 Capability；
4. Pi Tool 经 Broker 调用并产生审计；
5. 禁用时正在运行的 Tool 被取消；
6. 更新失败回滚；
7. 卸载默认保留数据。

## 调试

Developer Mode 只加载用户明确选择的目录。规划中的调试页面展示：

- Manifest 错误；
- 当前 Activation Event；
- 有效权限与被 Scene Policy 拒绝的权限；
- Command/Capability/Pi Tool Registry；
- 脱敏日志；
- View DevTools；
- Reload Plugin；
- 导出不含用户内容和密钥的诊断包。

## 打包发布

当前打包命令：

```powershell
bun run package:plugin . --key C:\secure\publisher-private.pem --out example.zicode-plugin
```

打包器会：

1. 运行测试；
2. 构建固定资产；
3. 生成文件哈希清单；
4. 校验 Manifest 与权限差异；
5. 拒绝 Source Map、`.env`、私钥和凭据；
6. 生成 `.zicode-plugin`；
7. 使用 Ed25519 发布者私钥签名固定的文件清单。

完整格式、首次信任、更新、回滚和撤销见[签名插件包与发布](signed-packages.md)。

插件包不得包含完整账号凭据、Cookie、API Key 或用户数据样例。文档中的 Secret 使用
占位符。

View能力调用的Promise失败现在可读取固定Error.code；成功/业务失败envelope保持。使用[公开错误字段规范](view-error-contract.md)，不要透传服务原消息；客户端等待超时不代表Host取消。

输入 Schema 的 Host 实际校验范围与敏感字段错误处理见 [参数约束校验](input-schema-validation.md)。不要将声明了 JSON Schema 等同于所有关键字均被执行；新提供方协议需逐项验证。

可选结果契约、预算、缓存复核和显式预览协商见 [结果声明校验](output-schema-validation.md)。旧 Host/旧候选包不能由源码验证推定支持。
