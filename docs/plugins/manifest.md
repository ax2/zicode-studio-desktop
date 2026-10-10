# Plugin Manifest

每个插件根目录必须包含 UTF-8 编码的 `plugin.json`。Manifest 是安装校验、权限确认、
UI 注册和 Pi Tool 注册的唯一声明来源；运行时代码不能动态增加未声明的权限。

能力目录分类/别名/用途描述采用独立 [tool.directory.v1](tool-directory-v1.md) 预览扩展：schemaVersion 2与显式requiredProfiles版本协商后才允许capability.directory。旧包不要求迁移，不猜测工具类别。

## 完整示例

```json
{
  "schemaVersion": 1,
  "id": "com.zicode.notes",
  "name": "Notes",
  "displayName": "笔记",
  "description": "网页剪藏、本地 Markdown 笔记本与 Astro 内容库",
  "version": "0.1.0",
  "publisher": "zicode",
  "license": "MIT",
  "engines": {
    "zicode": ">=0.2.0 <0.3.0",
    "pluginApi": "^1.0.0"
  },
  "icon": "assets/icon.svg",
  "activationEvents": [
    "onView:notes.library",
    "onCommand:notes.captureUrl",
    "onCapability:notes.search",
    "onPiTool:notes.search"
  ],
  "runtime": {
    "worker": "dist/worker.js"
  },
  "contributes": {
    "activities": [
      {
        "id": "notes",
        "title": "笔记",
        "icon": "assets/activity.svg",
        "order": 200
      }
    ],
    "views": [
      {
        "id": "notes.library",
        "activity": "notes",
        "location": "sidebar",
        "title": "笔记本",
        "entry": "views/library/index.html",
        "order": 100
      },
      {
        "id": "notes.editor",
        "activity": "notes",
        "location": "main",
        "title": "笔记",
        "entry": "views/editor/index.html"
      }
    ],
    "commands": [
      {
        "id": "notes.captureUrl",
        "title": "笔记：剪藏网页",
        "category": "Notes",
        "icon": "assets/clip.svg"
      }
    ],
    "keybindings": [
      {
        "command": "notes.captureUrl",
        "key": "Ctrl+Shift+C",
        "when": "plugin.com.zicode.notes.enabled"
      }
    ],
    "capabilities": [
      {
        "id": "notes.search",
        "title": "搜索本地笔记",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "minLength": 1 },
            "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
          },
          "required": ["query"],
          "additionalProperties": false
        }
      }
    ],
    "piTools": [
      {
        "name": "notes_search",
        "title": "Search notes",
        "description": "Search approved local notebooks and return matching excerpts.",
        "capability": "notes.search",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "minLength": 1 },
            "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
          },
          "required": ["query"],
          "additionalProperties": false
        }
      }
    ],
    "settings": [
      {
        "id": "notes.defaultNotebook",
        "scope": "scene",
        "type": "string",
        "title": "默认笔记本"
      }
    ]
  },
  "permissions": {
    "required": [
      {
        "name": "storage.plugin",
        "reason": "保存笔记本和索引"
      }
    ],
    "optional": [
      {
        "name": "network.fetch",
        "reason": "下载用户明确剪藏的网页"
      },
      {
        "name": "pi.tools.register",
        "reason": "允许对话搜索已授权笔记"
      }
    ]
  }
}
```

## 标识与版本

- `id`：反向域名格式，小写 ASCII，例如 `com.example.research`；发布后不可变。
- `version`：完整 SemVer，包内容必须与版本哈希一一对应。
- `publisher`：签名主体或开发模式发布者。
- `schemaVersion`：历史格式为 `1`；显式requiredProfiles使用新格式 `2`，见下文。
- `engines.zicode`：可安装的桌面程序版本范围。
- `engines.pluginApi`：插件使用的 Host API 版本范围。

## Runtime

`runtime.worker` 是本地开发插件的无 DOM JavaScript 后台入口；它不是敌对代码的 OS
沙箱。签名包后台代码必须使用 `runtime.wasi` 指向 WASI Preview 1 模块。公共第三方仓库
仍需通过远程审核、在线撤销同步和分发服务门禁，当前不开放。

没有后台能力的 UI 插件可以省略 `runtime`。没有 Activity 或 View 的轻量插件可以只
声明 Command 和可选 Keybinding，通过 Command Palette 使用。

## Activity 与 View

- 一个 Activity 在左侧 Activity Bar 占一个入口；
- `location: "sidebar"` 的 View 出现在该 Activity 的风琴区域；
- `location: "main"` 的 View占用主内容槽并隐藏 Chat；
- 同一 Activity 可以有多个可折叠 Sidebar View，但只能有一个当前 Main View；
- `entry` 必须指向包内 HTML，禁止绝对路径、`..`、网络 URL 和 `file://`。

## Command、Keybinding 与局部动作

Command 是所有用户动作的稳定 ID。Command Palette、快捷键、上下文动作和插件 View
内部按钮只引用 Command，不重复实现处理逻辑。应用插件不贡献顶部 Toolbar 或应用
Menu。`when` 表达式只能读取 Host 提供的有限上下文键，不能执行 JavaScript。

第一版上下文键：

- `activeActivity`
- `activeMainView`
- `scene`
- `workspaceTrusted`
- `plugin.<id>.enabled`
- `plugin.<id>.permission.<permission-name>`
- `pi.connected`
- `selection.hasText`

## Capability 与 Pi Tool

Capability 是插件之间以及 Chat 调用插件的通用接口。Pi Tool 是 Capability 的一个
模型可见投影：

- 两者必须有固定 JSON Schema；
- 输入默认不接受额外字段；
- 工具描述不能包含动态远程内容；
- 工具名在当前场景必须唯一，冲突时后安装插件不能启用该工具；
- Host 可以为 Pi Tool 设置更小的输出上限、超时和审批规则；
- 返回值必须是结构化 JSON，二进制数据使用 Host 生成的资源句柄。

## 权限

Manifest 将权限分成 `required` 和 `optional`。必需权限被拒绝时插件不能在该场景启用；
可选权限被拒绝时相关 Contribution 不注册。权限名称与行为见
[安全与生命周期](security-and-lifecycle.md)。

## 安装时校验

安装器必须验证：

- Manifest JSON Schema、SemVer 和 ID；
- 所有资源路径位于解包根目录；
- 解压后文件数、单文件大小和总大小上限；
- 文件哈希与签名清单；
- Contribution ID、Command ID、Tool Name 无重复；
- JSON Schema 深度和大小有界；
- CSP 不允许远程脚本、`eval` 或任意顶层导航；
- 引擎版本、权限和 Contribution 类型均受当前 Host 支持。

## 已声明引擎范围的加载门禁

Host在安装/发现的通用manifest校验中匹配`engines.zicode`和`engines.pluginApi`；Studio版本取应用Cargo包版本，当前Plugin API为1.0.0。与工具输入输出contractVersion及独立profile不同，不因为API主版本匹配就接受诊断proposal。

范围支持SemVer的精确值、比较符、caret/tilde/wildcard，多个条件可用空格或逗号作AND，`||`作OR；每条最多256 UTF8字节。所有OR分支均须有效，空分支/多余逗号、非字符串、非对象、不匹配版本或未知引擎字段拒绝。npm的连字符区间和比较符与版本分开书写未支持；使用例如`>=0.1.0 <1.0.0`。

兼容规则：历史省略engines/null/空对象仍可加载，其含义是未声明最低版本，不是已经验证所有版本。新提供方包应明确声明两个范围；未声明profile不能被目录或包ID隐式视为支持。新增引擎键需要版本化Host实现，不能通过未知字段静默放行。


## Schema 2 显式工具协议要求

新源码支持`schemaVersion:2`，必须同时声明`engines.zicode`、`engines.pluginApi`及`requiredProfiles`对象。无需工具协议的UI包可以声明空对象。例：

```json
{
  "schemaVersion": 2,
  "engines": {"zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0"},
  "requiredProfiles": {"compute.wasi.v1": "=1.0.0-rc.1"},
  "runtime": {"wasi": "runtime/tools.wasm"}
}
```

这是片段，其他必填标识/贡献/权限仍按完整manifest规范。Host源码可匹配冻结文本计算`compute.wasi.v1`及通用结果校验`output.schema.v1`的`1.0.0-rc.1`预览，未发布稳定1.0.0。稳定范围`^1.0.0`不会匹配预览版本；compute要求WASI runtime，output要求实际结果契约声明，见[结果声明校验](output-schema-validation.md)。Windows plugin-contracts-2026-10-09阶段EXE已包含新结果门禁并完成自有夹具原生验证；旧Host及其他OS须分别核对。匹配证明Host协议版本相容，不证明提供方算法/schema/预算或全部源scope已验收。

`diagnostics.compute.wasi.v1.proposal`、`resource.wasi.input.draft2`以及service/desktop未进入支持列表，即使目录或View声明也会拒绝。需求最多32项，ID最多128 ASCII字节，每范围最多256 UTF8字节；格式及SemVer范围沿用engine门禁。任一未知/不匹配要求拒绝整个包，不按包ID特判，不自动删除要求/降级重试。

Schema1保留既有加载方式，但不允许requiredProfiles对象；不能借旧格式规避新协商。旧版schema1-only Studio源码的格式门禁会拒绝schema2，避免忽略未知字段后加载。现有冻结EXE尚未构建这项新机制，其他第三方Host须单独核对；不得把此处设计当作所有旧Host的实测保证。

签名包容器schema与manifest schema分别版本化，容器保持既有格式，签名验证、权限审批、完整性及工具验收照常需要。提供方必须在自己的独立构建流程中输出新manifest，不能让Studio接收时偷偷修改签名内容。当前候选包保留原schema1，本会话没有改造DevTools包或宣称诊断profile兼容。

2026-10-09新debug EXE原生隔离验收已完成：schema2精确预览声明发现/加载/SDK-Host-WASI显示成功，未知profile/稳定范围不匹配/API不兼容实际拒绝，截图已读。自有fixture，不是诊断算法、签名安装或跨平台完整验收；旧优化/冻结EXE保持原快照。证据见技术博客iterations/native-plugin-negotiation-2026-10-09。
