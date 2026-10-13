# 工具目录元数据扩展

版本标识：`tool.directory.v1`，当前预览版本 **1.0.0-preview.1**。这是独立的目录扩展，不修改已冻结的 compute/output 契约；不声明 DevTools 已采用。Studio 的源码和当前开发程序验证范围以技术博客 `iterations/tool-directory-metadata-2026-10-10` 为准，其他平台尚待验证。

## 提供方声明

便携结构定义见 [JSON Schema](tool-directory.schema.json)；UTF-8字节、规范化重复及控制字符还必须按本文和Host校验，不能仅凭schema字符串长度通过就声明兼容。

Manifest 使用 schemaVersion 2，并添加 `requiredProfiles: {"tool.directory.v1":"=1.0.0-preview.1"}`。已有 compute/output 要求保留。每个 capability 可选增加 `directory`：

```json
{
  "id": "text.base64.encode",
  "title": "Base64 编码",
  "directory": {
    "categoryId": "text",
    "aliases": ["base64 encode", "编码", "转成 Base64"],
    "description": "在本机把文本编码为 Base64；不会读取文件或发送网络请求。"
  },
  "inputSchema": {"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}
}
```

字段是纯文本目录资料，不能声明新权限、改变执行语义或输入输出版本。schema1 携带 directory、未声明扩展、无效范围、未知字段和超额元数据都拒绝安装，不能静默忽略。

## 分类与预算

统一 categoryId：`text`、`data`、`web`、`code`、`files`、`media`、`system`、`ai`、`knowledge`、`automation`、`security`、`other`。一个主类，不从能力ID推断；所有提供方共享该任务分类。类别名称由Studio按当前界面语言显示，目前中英文；不接受同ID不同提供方名称，也不把新分类自动加入左侧图标。

categoryId 为 directory 唯一必填字段。aliases 可省略或为空数组，最多16项；每项非空、最多128 UTF-8字节，NFKC/小写/首尾去空白后不得重复。description 可省略，提供时非空、最多512 UTF-8字节。所有文本禁止控制字符；作为文本展示，不解析HTML、路径或命令。原有256KiB manifest上限保持。

旧包省略directory，归入Host保留分类 `uncategorized`，仍可按标题/ID/来源发现和执行；提供方不能声明此保留值。分类缺失不是工具失败。工具稳定ID、收藏和最近记录不变。新增类目需要新的扩展版本与迁移规则。

## Host目录查询

桌面内部 `GET /v2/plugin-tool-directory` 新增可选 `categoryId`（最多64 UTF-8字节）。省略或空值为全部分类；不存在分类返回零项，不能回退其他类。与来源pluginId、全部/收藏/最近、query、workspace/scene、revision/accessRevision组合。

Host统一对查询和可搜索字段进行Unicode NFKC与小写转换，以空白分词，所有词均匹配才返回。字段包括既有工具/插件标题及ID、插件描述/发布者，加上能力 aliases/description；不读取schema、View或Worker内容，不用浏览器仅过滤当前页。

先取当前工作区/场景的完整全部/收藏/最近列表，再统计sources/categories，随后组合分类、来源、搜索并每页最多40项。`categories:[{id,count}]`计数不受query、来源、分类或页码影响，表示所选完整列表；收藏/最近改变时计数跟随其列表。元数据/启停/安装卸载/权限变化沿用既有revision失效。客户端改变条件须回到第一页；未知分类保留选择并显示零结果，可清除恢复。

每项摘要新增categoryId/description，不返回aliases或inputSchema；打开工具后才加载schema，显式执行后才启动Worker。旧Host不返回categories时前端不显示分类筛选，旧客户端可忽略新增摘要字段。此接口仍仅可信桌面授权；不自动改动Pi工具激活或赋予插件查询其他工具的权限。

2026-10-14 后续：内置 Pi 的已授权插件目录搜索复用能力别名、标题与说明作为只读索引；它不把别名写进搜索摘要或注册成额外 Pi 工具。目录修订绑定该索引，提供方同版本变更别名时旧加载修订被拒。Studio 自有清单的真实 HTTP 专项已验证中文别名切换；DevTools 冻结候选未声明此扩展，不能将该专项算为提供方接入。

## DevTools 后续接口需求

1. 在独立构建的下一个候选包采用以上扩展精确版本；保留所有能力ID、独立程序和已有协议。
2. 为各能力声明任务主类、真实用途描述及中英文检索别名；不要把整个包统一归类代替逐能力分类，不声明尚未实现的功能。
3. 交付版本化包、逐文件摘要、目录快照及迁移说明。Studio不修改既有冻结包或维护DevTools专用分类表。
4. Studio对实际包补齐搜索/组合筛选/按需加载/执行与截图验收后才更新逐工具接入证据；合成规模夹具不代表提供方已接入。

预览扩展不代表 resource/service/desktop profile、完整154源功能或其他OS已接受。
