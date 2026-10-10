# 文本转换候选01范围映射审计

公开dev.105目录9项/版本1.0.2与候选目录、manifest能力、Pi声明及23基础样例逐项对应。此结论证明声明和样例映射齐全，不证明独立程序源码等价或完整接入验收。

| 源工具 | 目录范围 | 工具版本 | 对应操作 |
| --- | --- | --- | --- |
| url / URL 编码 | URL 参数百分号编码与还原 | 1.0.2 | url.encode, url.decode |
| number / 进制转换 | 二、八、十、十六进制互转 | 1.0.2 | number.from2, number.from8, number.from10, number.from16 |
| text-stats / 文本统计 | 字符、字节、行数与词段统计 | 1.0.2 | stats.inspect |
| html-escape / HTML 转义 | HTML 特殊字符转义与还原 | 1.0.2 | html.escape, html.unescape |
| text-escape / 文本转义 | JSON 字符串转义与还原 | 1.0.2 | string.escape, string.unescape |
| case-convert / 命名转换 | camel、Pascal、snake 与 kebab 命名 | 1.0.2 | case.camel, case.pascal, case.snake, case.kebab |
| hex / UTF-8 / Hex | UTF-8 文本与十六进制字节互转 | 1.0.2 | hex.encode, hex.decode |
| lines / 文本行处理 | 稳定去重、排序、去空行与空白处理 | 1.0.2 | lines.deduplicate, lines.ascending, lines.descending, lines.nonempty, lines.trim |
| url-inspect / URL 解析 | 解析协议、主机、路径和重复查询参数 | 1.0.2 | url.inspect |

插件为有界文本：8192 UTF-8输入，48KiB序列化请求/结果，128位进制结果用文本，HTML仅五种实体，统计字符指Unicode标量，行处理输出LF，URL拆解省略用户名/密码字段。独立程序输入范围不能由候选预算外推。原始CRLF经Pi/Worker保持原样；textarea按DOM规则变LF，两类证据分开。

生产Worker164向量通过/10 raw跳过；桌面23基础样例通过；真实Pi专项23精确样例、20+3分页、10阶段、115缓存拒绝及5独立对照已通过。URL encode→独立Base64接力及确认保存已在实际桌面验证（仅该链路）；签名生命周期、执行中取消、其余操作接力、其他OS仍待。完整154条目接受保持0。


