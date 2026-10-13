# 手动工具目录 Host API

2026-10-09，响应 schemaVersion=1。Studio本地桌面接口；不要求生产者新增协议声明。
现有Pi目录继续使用独立的runtime/session身份，本接口不替代其授权。

## 搜索与分页

`GET /v2/plugin-tool-directory?sceneId=programming&query=JSON&offset=0`

要求当前桌面令牌。query最多512 UTF-8字节，offset最多1,000,000。
每页最多40项；返回schemaVersion、sceneId、revision、total、offset、pageSize、nextOffset及items。
后续页必须携带首次响应revision；注册表改变返回409 `catalog_changed`，调用方回到第一页刷新。
查询变化也应回到第一页。当前offset是位置而非可移植的目录标识。

每项仅含稳定toolId（pluginId/capabilityId的JSON字符串元组）、accessId（该元组的SHA256收藏标识）、pluginId、capabilityId、title、
applicationName、publisher、version、enabled、status、runtime；不含输入输出schema、脚本、文件路径或用户内容。
搜索名称、工具ID/标题、应用描述及发布者；Unicode小写、空白分词、全部词匹配，按稳定toolId排序。
支持工具级全部/收藏/最近筛选及来源筛选，先筛选再分页，详见下方当前进展。暂未实现NFKC、别名、任务分类、相关度排序或跨页面索引缓存。

安装但当前场景禁用的工具仍可发现，status=plugin_disabled；enabled时为available_to_request。
后者只表示可以请求调用，**不保证运行时、权限、输入、业务条件或契约校验通过**。
手动发现不依赖pi.tools.register，搜索与收藏也不授予权限。

## 按需详情

`GET /v2/plugin-tool-directory/detail?sceneId=programming&pluginId=…&capabilityId=…&revision=…`

同样要求当前桌面令牌及当前revision；只返回选中能力的声明（包括schema）、插件版本、enabled和已声明权限的required/granted/reason。
返回409 catalog_changed或404 tool_unavailable时，调用方不得继续使用缓存schema。
目录revision绑定当前场景、注册表epoch、状态和完整已加载manifest；同版本重装改契约、撤权再授权都会使旧详情失效。
全局epoch意味着无关插件变化也会保守刷新；revision是失效标记，不是调用或写入授权。

两个接口只读当前内存注册表，不加载View、实例化WASM、启动Worker、注册Pi工具或保存输入。
执行仍通过现有能力接口完成所有Host检查；本接口没有增加执行、取消或保存功能。
不得把详情加载当作指定自定义View已定位，tool.open.v1仍为待版本化需求。

`resourceOnly=true` 限定已启用、获授 `resource.read` 的 WASI draft2 文件资源工具；可进一步带经过验证的 `fileName` 匹配插件后缀声明。`directoryOnly=true` 单独限定已启用、同时声明并获授 `resource.read` 与 `resource.directory.read` 的 WASI draft2 工具；两种筛选不能同时使用。目录筛选只读元数据，不选择目录、读取名称、加载工具或执行。可信工具中心仅在当前桌面网关提供项目目录选择器时显示该选项；用户选择工具后仍需分别选择目录、确认共享和执行。

## 实现与验证边界

注册表实现位于plugin_registry/manual_catalog.rs，HTTP适配位于host_server/manual_tool_catalog.rs；
大文件只添加模块声明/路由。PluginCapabilityGateway新增searchTools和loadTool。
工具中心现已接入分页搜索与按需详情，分为“具体工具”和“完整应用”。具体工具每页40项，最多保留8个已打开工具页；切换工具页保留当前输入和最近成功结果。打开不执行，执行由用户明确触发。

当前通用表单支持最多16个平面string/integer/number/boolean字段及同类型有限枚举（1–40项）。数值输入保留原文字，在显式执行时检查JSON数值格式、有限值、整数安全范围、minimum/maximum和十进制精度；不静默舍入。枚举以索引表示选择，0、false、空字符串与未填写分开；可选未填写省略。字符串按Unicode码点检查长度，最多32768码点。未知schema关键字、复杂schema、资源输入、内建动作和其他必需权限明确显示未支持原因，可回到应用入口。执行请求携带catalogRevision，Host拒绝陈旧目录再执行；旧客户端不携带时维持原行为。工具级收藏/最近筛选、来源筛选及命令面板具体工具入口已接线；打开不执行或记录recent。

真实Windows调试程序中，273项声明能力（含205项Studio验收夹具）搜索、分页、选择、执行与结果展示已检查；不能把夹具计作DevTools工具。此前Base64执行5220ms超时保留；优化dev运行时编译热点后，当前EXE真实编码/解码两个基本样例494/626ms成功，工具页切换保留输入/结果。154项全量工具验收仍为0。证据见iterations/tool-workbench-2026-10-09与iterations/wasi-startup-2026-10-09；自动结果传递/保存不由本项证明。

规范文本结果已接入兼容接收工具搜索、映射预览/确认执行与保存预览/确认；仅Host既有resultRef支持范围可用。类型输入不扩大文本结果映射的能力；Studio类型夹具输出显示result_profile_unsupported符合现有边界，不能据此声称任意Worker结果可接力。原生取消、新表单写入授权流程、离开整个工具中心的草稿保护、工具任务分类仍待完成。页面退出不代表取消执行。仅检查1442×931浅色Windows截图；控制台健康、其他视口/主题/平台待验证。

本轮日志及真实HTTP记录见技术博客项目档案iterations/manual-tool-catalog-2026-10-09；以终态记录为准。
当前目录每次读取都扫描/哈希manifest，响应虽分页，Host内部并非增量索引；更大规模需要独立基准与有界索引设计。

2026-10-09类型输入验证：Studio自有临时Worker夹具，经命令面板发现→按需加载→显式执行→结果展示，实际收到count=0/flag=false/mode=0.5/note=""/ratio=1.25及正确类型，可选布尔字段未出现。9007199254740993在客户端拒绝且该插件审计记录0；修正后唯一成功审计94ms。76项前端定向回归/check/React构建通过；全量typecheck保留Habits/Watch两项既有错误。复用EXE303fd49a，未构建Rust/发布；临时安装2文件清理且源证据保留。见技术博客iterations/typed-tool-inputs-2026-10-09，不提高154完整工具验收数。
