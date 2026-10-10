# 下一批纯文本计算工具交付需求

日期：2026-10-09。基于公开dev.105目录。这是提供方接口需求，不是新Host协议或验收通过声明。全部154项目标及逐项阻塞清单保持。

## 范围

| sourceToolId | 独立版版本 | 必须逐操作映射的范围 |
| --- | --- | --- |
| url | 1.0.2 | URL参数百分号编码、还原 |
| url-inspect | 1.0.2 | 协议、主机、路径、重复查询参数 |
| html-escape | 1.0.2 | HTML特殊字符转义、还原 |
| text-escape | 1.0.2 | JSON字符串转义、还原 |
| case-convert | 1.0.2 | camel、Pascal、snake、kebab |
| text-stats | 1.0.2 | 字符、UTF-8字节、行数、词段 |
| lines | 1.0.2 | 稳定去重、排序、去空行、空白处理 |
| number | 1.0.2 | 二、八、十、十六进制互转 |
| hex | 1.0.2 | UTF-8文本、十六进制字节互转 |

以上9项目前均await_provider_package。不得用一项操作通过代表整个工具完成。操作、Unicode、整数精度、非法编码、空输入、换行与排序规则必须由提供方在schema/fixtures中明确；不能推定任意大整数、全Unicode语言分词或所有URL协议已支持。

## 交付与依赖

自包含分组WASI包，保持同一核心供独立程序及插件使用；不引用Studio源码/绝对路径、私有HTTP、DevTools.exe或共享数据库。采用现有Plugin API与View SDK，不为每个工具增加主导航。工具ID、Capability ID、版本及sourceToolId逐操作对应。

冻结文本契约zicode.devtools-plugin/1.0.0-rc.1外层与错误枚举保持；8192 UTF-8输入、48KiB序列化请求/结果及生产Worker5秒/10M燃料/64MiB/2MiB栈不变。新输入类型、随机/当前时间来源、非既有错误码先交明确版本化提案。requiredProfiles声明只能选择已实现且实际符合的Host profile与版本范围，不得声明稳定1.0.0或诊断proposal已被接受。

每项提供输入输出schema、有效/无效/边界fixture、最终WASM和文件清单SHA256、LICENSE/NOTICE、包内来源及包外验证索引、unsigned或真实签名状态。内部裸字节一致性与Host重序列化后的语义一致性分别记录。不能交target、依赖树、模型、用户数据或运行环境。

## 接收验收

Studio固定交付包后核对完整scope与操作映射、发现/按需加载/View/真实Pi、预算与错误、结果接力、撤权/禁用/卸载/失败隔离。签名更新回滚、模型自主选工具、其他OS及未覆盖scope单独列待验收。提供方独立验证不是Studio验收。

已发送给原zi-devtools开发会话，要求当前构建完成后推进，不重启活跃构建。其余纯计算及资源/服务/桌面工具仍在总矩阵，以上9项是后续批次，不缩小全目录目标。

