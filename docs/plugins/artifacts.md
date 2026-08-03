# Artifacts 内置插件

Artifacts 是 P6 的统一结果库。它保存应用插件产生的有界 JSON、Markdown 或文本内容，
并向界面与后续 Capability 提供不含本地路径的 `artifact:<uuid>` 资源句柄。

## 界面

Artifacts 使用统一三栏 Shell：

- 导航区负责切换到 Artifacts；
- 功能区提供搜索、类型、来源插件和最近产物；
- 主视图显示内容、来源、元数据、导出和删除动作。

普通界面不显示 P5/P6 等内部路线图标签。阶段编号只保留在实施文档中。

## 数据模型

每个 Descriptor 包含：

| 字段 | 含义 |
| --- | --- |
| `id` | Host 生成的 UUID |
| `handle` | `artifact:<uuid>` 形式的跨界面引用 |
| `sceneId` | 数据所属场景 |
| `pluginId` | 产物来源插件 |
| `kind` | `report`、`chart`、`dataset` 或 `file` |
| `mimeType` | `application/json`、`text/markdown` 或 `text/plain` |
| `version` | 内容 SHA-256，用于完整性和乐观删除 |
| `provenance` | 引擎、数据时间、执行 ID 等来源元数据 |

内容限制为 1 MiB，来源信息限制为 32 KiB，每场景最多 2,000 条。Host 只接受固定类型
和 MIME 白名单。

## Host API

| 路由 | 用途 |
| --- | --- |
| `GET /v2/artifacts` | 按场景列出并筛选 Descriptor |
| `GET /v2/artifacts/item` | 读取一条完整产物并校验内容哈希 |
| `POST /v2/artifacts/create` | 由当前场景中已启用的来源插件创建 |
| `POST /v2/artifacts/delete` | 使用 `expectedVersion` 删除 |

四个路由都重新检查 Artifacts 已启用且获 `storage.plugin` 权限。创建还会检查来源插件在
同一场景已启用。客户端不能传入或得到绝对存储路径。

## Finance 集成

Finance 的市场快照以 `dataset` 保存，确定性回测和多因子选股以 `report` 保存。内容
同时保留输入和结果；来源记录本地引擎或 QVeris 执行信息。归档采用 best-effort：
Artifacts 暂时不可用时，Finance 仍显示已经成功生成的结果并给出提示。

## 文件与导出

Host 数据位于 ZiCode 数据根下的 `plugin-data/com.zicode.artifacts/items`，但该路径不
进入前端响应。界面导出可读的 `.zicode-artifact.json`，包含 Schema 版本、Descriptor、
内容和来源，便于审计和后续迁移。
