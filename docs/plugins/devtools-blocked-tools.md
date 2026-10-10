# 当前尚不能完整接入的工具及原因

这是暂时阻塞清单，不是永久放弃名单。dev.105共154条目均未完整验收；首批5子能力和诊断候选接收不代表完整scope。下表逐项列原因/责任方/重开条件，原始scope见[JSON](devtools-all-tools-matrix.json)。

独立程序双EXE/MSI更新不能原样作为Studio插件功能；插件生命周期由Studio管理，可另拆通用算法。其他条目没有被证明永久不兼容；已完成子能力可先交付。

此前Base64工作台执行超时5220ms的失败证据保留；优化后编码/解码基本样例494/626ms成功，未改Worker预算。原HTTP专项的5个JSON漂移已证明为排版差异，备份后精确恢复原冻结摘要，13文件完整验证及原专项重新通过，原失败保留且未改期望值。当前Inspect84/Transforms164个Worker语义用例与工作台JSON→YAML/URL解码基本样例1252/1015ms通过；20个raw用例未覆盖，旧Pi超时尚未重验，完整scope/生命周期/签名/其他OS仍待。见iterations/fixture-integrity-2026-10-09及JSON currentRuntimeVerification；不将临时阻塞从154范围删除。

## compute（63项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| json / JSON | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| base64 / Base64 | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| url / URL 编码 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 URL编码基础样例已验证传给独立Base64工具及用户预览确认保存，磁盘内容精确核对；不外推23全部结果场景。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| sha256 / SHA-256 文本摘要 | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| timestamp / 时间戳 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 时间格式/显式时区换算可纯计算；自动当前时间/本地时区需单独声明来源并验证，不能仅按名称断言一定需要Host。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| uuid / UUID | 尚无插件实包；可评审WASI系统随机源或确定性输入方案，但系统安全随机与种子重现须分开声明并跨平台验证，不能使用不安全随机替代；当前冻结首批契约未定义此操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| jwt / JWT 内容查看 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具1操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；当前候选Pi门禁未通过（yaml.from_json真实worker_timeout，5000ms预算未变，原因待分段定位），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| regex / 正则表达式 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| number / 进制转换 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具4操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| ascii-codes / ASCII 码表 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| symbol-library / 特殊字符与表情 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| color / 颜色转换 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| text-stats / 文本统计 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具1操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| html-escape / HTML 转义 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| text-escape / 文本转义 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| case-convert / 命名转换 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具4操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| yaml / YAML / JSON | 已接收inspect无签名候选0.1.0，4工具7操作；本工具2操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；当前候选Pi门禁未通过（yaml.from_json真实worker_timeout，5000ms预算未变，原因待分段定位），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| hex / UTF-8 / Hex | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| lines / 文本行处理 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具5操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| url-inspect / URL 解析 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具1操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 本轮Pi回归在url.decode出现worker_timeout，整体当前Pi状态未通过；历史通过记录保留，原因待与Inspect超时一起定位，不计完整接受。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| cidr / IPv4 CIDR | 已接收inspect无签名候选0.1.0，4工具7操作；本工具1操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；当前候选Pi门禁未通过（yaml.from_json真实worker_timeout，5000ms预算未变，原因待分段定位），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| diff / 文本差异对比 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| json-path / JSON 路径查询 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| json-diff / 结构化 JSON 对比 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| data-schema / 数据质量检查 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| data-transform / 数据列变换 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| csv-merge / CSV 合并与关联 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| cron / Cron 表达式 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 固定偏移和显式起始时刻的计算可先接入；后台实际调度属于service扩展。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| random / 随机数据生成 | 尚无插件实包；可评审WASI系统随机源或确定性输入方案，但系统安全随机与种子重现须分开声明并跨平台验证，不能使用不安全随机替代；当前冻结首批契约未定义此操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| sql-format / SQL 格式化 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| json-schema / JSON Schema 校验 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| http-collections / HTTP 集合与环境 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| curl-import / cURL 导入 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| tls-inspect / TLS 证书检查 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| unicode / Unicode 字符检查 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具3操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；当前候选Pi门禁未通过（yaml.from_json真实worker_timeout，5000ms预算未变，原因待分段定位），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| escape-suite / 转义与转码扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| time-zone / 时区工作台 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| regex-replace / 正则替换 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| jwt-verify / JWT 本地验签 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| crypto / 加密与签名实验台 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| openapi / OpenAPI 请求生成 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| model-profiles / 模型连接配置 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| model-chat / 多轮模型工作台 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| model-compare / 模型对比评测 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| token-budget / Token 与上下文预算 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 | DevTools提供方；Studio做包/schema与运行验收；先实现并独立交付有界离线算法、版本化schema和测试向量，通过真实插件链路及资源/安全边界验收 |
| structured-output / 结构化输出验证 | 提供方目录标记planned，尚无插件实包。离线JSON Schema校验可先纯计算；若通过模型修复，需要单独授权服务调用、输入发送和结果预览，不能自动改写。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| mcp-connections / MCP 连接管理 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| mcp-permissions / MCP 工具权限 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| anythingllm / AnythingLLM 连接器 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| ocr-documents / 本地 OCR 文档助手 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| java-trace / Java 异常链 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| django-trace / Django / Python 堆栈 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| java-thread-dump / Java 线程转储分析 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入jstack/jcmd文本分析，不采集进程。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| java-dependencies / Maven / Gradle 依赖冲突 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入Maven/Gradle依赖文本，不执行构建。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| java-gc-log / Java GC 日志分析 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入GC文本分析，不读取磁盘或采集进程。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| spring-config / Spring 配置对比 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入两份JSON/YAML配置差异/脱敏，不请求Actuator。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| spring-actuator / Spring Actuator 只读诊断 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 | DevTools提供方；Studio做包/schema与运行验收；交付独立包及fixtures，并通过真实Host/Worker/View/Pi、边界与撤权验收 |
| django-migrations / Django 迁移计划检查 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入迁移计划及SQL分析，不访问数据库或执行迁移。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| django-sql / Django SQL / N+1 分析 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入SQL查询日志JSON数组归一化/重复分析，不执行SQL。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| django-urls / Django URL / reverse 检查 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入URL列表及检索，不加载Django项目。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| django-drf / DRF OpenAPI 契约对比 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入两份OpenAPI JSON差异，不调用远程API。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| django-checks / Django 部署检查报告 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入检查输出，不运行manage.py。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| celery-diagnostics / Celery 任务故障分析 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入Celery任务日志文本分析，不连接Broker。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |

## resource（38项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| ascii-art / ASCII Art 字符画 | 缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 文本/图形生成可拆为纯计算；图片输入、PNG/TXT导出与保存仍缺资源和二进制结果协议。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| qr / 二维码 | 缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 文本/图形生成可拆为纯计算；图片输入、PNG/TXT导出与保存仍缺资源和二进制结果协议。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| data / CSV / JSON 数据工作台 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需CSV/TSV/列结构JSON实包及空表/列序/数值类型、草稿实例恢复和范围接力的一致性；输出文件不等同持久实例状态。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| files / 批量文件校验 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需多文件/大文件身份、流式输入、进度/取消契约和SHA256/SHA512实包；单个32MiB快照不证明全部文件范围。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| checksum-manifest / 校验清单 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需同目录1–64文件集合/受限相对名称/身份与清单定位匹配；提供方交付穿越/重复名称/链接/取消正反例。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| disk-inspector / 目录空间分析 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需用户确认的目录只读授权、条目/深度/时间预算、跳过链接和部分结果契约；现有字节快照不授予目录枚举。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| duplicate-files / 重复文件检查 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需目录/候选集合授权、文件身份复核、哈希读取字节预算、取消和只读去重实包；不增加自动删除。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| file-compare / 目录内容对比 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需双目录独立授权、相对路径/类型/摘要比较、部分结果和CSV交付契约及实包。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| log-viewer / 日志工作台 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| sqlite / SQLite 浏览器 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需只读数据库快照/VFS与表/列/分页类型化结果实包，文件变化/值预算/超时取消证据；不直接开放路径或任意SQL写入。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| encoding-detect / 文件编码转换 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需严格多编码/BOM、回读/SHA与目标字节预览实包，以及原文件身份变化/交付类型与生成名称契约。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| file-rename / 批量重命名 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| image-tools / 图片工作台 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需缩放/格式/质量/编码预览实包；独立版1600万像素与Studio4Mi像素/4096单边预览范围差异仍待协商验证。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| image-batch / 图片批处理 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需1–100输入集合、输出清单/命名/冲突预览、逐项进度/取消/部分成功与目录交付契约；4项输出不是100项批处理接受。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| image-crop-annotate / 图片裁剪与标注 | Studio已用自有合成材料完成Windows原生确认资源→隔离SDK→Host→WASI→JSON显示、撤权拒绝及取消/回收底层验证；仍是内部resource draft，未发布公开profile。提供方dev.103新增共享图片预算与失败保留工作声明，尚未交付本项独立图片插件，缺正式二进制输入输出/结果存储、用户确认写入、完整算法范围与OS验收。自有WAT不替代提供方图片算法实包。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| image-metadata / 图片元数据检查与清理 | Studio已用自有合成材料完成Windows原生确认资源→隔离SDK→Host→WASI→JSON显示、撤权拒绝及取消/回收底层验证；仍是内部resource draft，未发布公开profile。提供方dev.103新增共享图片预算与失败保留工作声明，尚未交付本项独立图片插件，缺正式二进制输入输出/结果存储、用户确认写入、完整算法范围与OS验收。自有WAT不替代提供方图片算法实包。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| markdown / Markdown 预览 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需结构化安全渲染实包及HTML交付MIME/生成名称/CSP契约；不执行原始HTML，.bin下载不等同HTML另存。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| pipeline / 可组合数据管线 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| file-search / 文件内容检索 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| pdf-text / PDF 文本提取 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| prompt-library / 提示词模板库 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| agent-replay / Agent 记录查看器 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需v1/v2/v3解析/隐私默认隐藏/比较实包及顶层64记录目录授权、累计16MiB/跨记录查询契约；不执行模型或MCP。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| obsidian-vault / Obsidian / Markdown 库 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| browser-clipper / 网页与对话收集 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需公开HTTPS地址/重定向/时长/体积权限边界、知识源目录Markdown命名/去重/无覆盖交付及实包；项目输出不等同知识源保存。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| parquet-workbench / Parquet / Arrow 工作台 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| java-jfr / JFR 录制报告浏览 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入JFR JSON，不读取二进制JFR或启动JDK。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 | Studio：候选协议/启动预算与实包验收；DevTools：交付兼容包及未覆盖操作；在既定或公开版本化预算内完成真实Host/Worker/View/Pi、全部声明操作与边界、撤权/更新及OS验收；未覆盖源scope另交子能力与接口 |
| file-intake / 文件拖放入口 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需主窗/快捷面板多文件拖放路由、类型/数量/大小审核和用户选择接收工具契约；不自动执行/上传，不传任意本机路径。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| workspace-sessions / 项目空间与工作实例 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| artifact-hub / 类型化资料与结果 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| operation-permissions / 授权写入与变更预览 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| memos / 备忘录 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需记录CRUD/草稿、多窗口冲突、回收站和JSON备份合并/替换恢复契约及实包；持久输出文件不是应用记录库。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| calendar-planner / 万年历与日程 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需日期/重复/跨天实包及记录/提醒注册、延后/重启补提醒、时区/UID/导入导出/恢复的版本化契约。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| planner-interop / 日程进阶与互通 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| memo-library / 备忘资料库互通 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| data-sqlite-export / 表格另存 SQLite | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需SQLite结果类型/生成名称、范围/类型确认、事务生成/独立复核/提交前取消及实包；.bin保存不等同完整SQLite导出。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| advanced-calculator / 全能计算器 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| text-flow / 文本 / 表格流程 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需22操作/最多16步实包、配方/类型/逐步结果/失败/取消/实例恢复不执行和文件交付契约；多次手工调用不等同流程接受。 | Studio资源/结果Host；DevTools工具适配；版本化资源grant、文件身份/内容版本、写入预览/冲突/恢复和conformance完成后交付实包 |
| image-workflow / 图片操作流程 | 独立版流程尚在开发且未交付插件包；Studio资源输入/输出/预览/跨owner接力/确认保存/项目文件库已通过通用候选验证，但非DevTools算法或流程接受。逐步图片操作/实例状态/有界载荷池、多跳用户确认、中间结果保留、正式resource.v1/备份及完整scope仍缺。禁止共享路径或启动独立程序替代。 | DevTools提供方负责流程核心与包；Studio负责资源/结果/确认保存Host；先交付已实现裁剪/缩放/编码/报告子能力的独立包和fixtures；发布版本化资源与流程协议并通过真实Host/View/Pi、取消、冲突及支持OS验收；全工具验收另需覆盖剩余scope |

## service（13项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| http / HTTP 请求调试 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| network / 网络诊断 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| embedding-playground / Embedding 工作台 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| mcp-inspector / MCP 协议调试台 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| agent-runner / Agent 任务工作台 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-sources / 本地知识源管理 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-ingestion / 文档解析与分块 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-index / 增量知识索引 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-vectors / 本机向量索引 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-keyword-search / 本机关键词检索 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-search / 混合检索工作台 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-answer / 带引用的知识问答 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |
| rag-eval / RAG 质量评测 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 | Studio服务/任务Host；DevTools工具适配；发布服务接口及权限/取消/幂等/脱敏审计用例，提供方独立适配并真实验收 |

## process（10项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| services / 本地服务管理 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| integrations / 本机集成发现 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| model-benchmark / 本机模型性能测试 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| ollama-manager / Ollama 模型管理 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| agent-codex / Codex CLI 适配器 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| agent-claude / Claude CLI 适配器 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| docker-panel / Docker 本地面板 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| git-workbench / Git 工作区面板 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| java-environment / JDK / 构建环境诊断 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |
| django-environment / Python / Django 环境诊断 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 | Studio受控进程Host；DevTools工具适配；可信程序与工作区授权、参数策略、取消/回收/跨平台conformance及实包通过 |

## platform（13项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| plugins / 插件与连接器 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| mcp-export / MCP 客户端配置导出 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| mcp-server / Zi DevTools MCP Server | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| workflow-builder / 可视化工具工作流 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| agent-scheduler / 定时任务与触发器 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| plugin-updates / 插件版本与更新 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| plugin-sdk / 隔离进程插件 SDK | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| plugin-market / 插件目录与安装源 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| plugin-settings / 插件设置与凭据 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| plugin-health / 插件健康诊断 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| command-collections / 工作区与工具集合 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| task-center / 后台任务中心 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |
| task-runtime / 统一后台运行管理 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 | Studio平台Host；DevTools声明具体操作映射；逐操作列出Host API、权限与数据迁移，实际插件入口/行为等价验收；仅有相似内置界面不算完成 |

## desktop（15项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| screen-recorder / 屏幕录制 | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screen-recorder-multimonitor / 显示器选择录屏 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screen-recorder-audio-mix / 双声源混录 | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screen-recorder-audio-gain / 录屏独立音量调节 | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screen-recorder-audio-meter / 录屏实时音频电平 | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screen-recorder-long-audio / 录屏长时音频稳定性 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| global-launcher / 全局快捷启动器 | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| clipboard-actions / 剪贴板动作 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| recorder-tutorial / 教程录屏辅助 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| explorer-menu / 资源管理器统一右键入口 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| clock-workbench / 全功能时钟 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| screenshot-workbench / 截图与透明套索 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| unified-shortcuts / 统一前缀快捷键 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| super-clipboard / 超级剪贴板 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |
| clipboard-workflows / 剪贴板数据工作流 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 | Studio各OS适配Host；DevTools工具适配；逐OS定义支持/不支持项，显式采集许可、资源上限、取消/窗口生命周期及真实设备证据齐全 |

## lifecycle（2项）

| ID / 工具 | 当前原因 | 责任方 / 解除条件 |
| --- | --- | --- |
| app-update-check / 程序更新检查 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。DevTools自身双EXE/MSI升级和回滚不能原样作为Studio插件执行：它替换的是另一独立程序，违反插件不依赖/管理DevTools.exe的边界。签名/差分校验算法可以另做纯计算插件；Studio插件升级由Host生命周期管理。 | DevTools拆分算法；Studio插件生命周期；提供方拆分可复用校验功能并交付；独立程序自更新明确保留在DevTools，例外逐项记录，不把Studio更新器当等价证据 |
| app-delta-update / 增量更新与回滚 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。DevTools自身双EXE/MSI升级和回滚不能原样作为Studio插件执行：它替换的是另一独立程序，违反插件不依赖/管理DevTools.exe的边界。签名/差分校验算法可以另做纯计算插件；Studio插件升级由Host生命周期管理。 | DevTools拆分算法；Studio插件生命周期；提供方拆分可复用校验功能并交付；独立程序自更新明确保留在DevTools，例外逐项记录，不把Studio更新器当等价证据 |





## 2026-10-10 已保存插件文件库

交付物页面新增独立“已保存的插件文件”入口：按项目元数据搜索/40项分页，点击后核对来源记录版本/原始字节SHA-256并安全预览或明确下载，不新增工具侧栏图标，不复制原始文件到第二套索引。保存副本独立于源临时资源授权；当前交付物存储权限仍须有效，撤权5秒复核后清预览。选中预览位于列表上方，下载为正常状态提示；切换只重置自身组件，不重挂共享容器覆盖其他工具。大型Host facade只路由接线，ArtifactApp只必要组合，逻辑独立模块。

28项前端/5文件、36项资源域测试通过（1 ignored另行显式运行），check/strict clippy/local build通过，fmt既有漂移保留；typecheck仍仅Habits/Watch两个既有mock错误。当前0.1.0 EXE 5ea0dfe82bc8fef11409472ef6856c41977c21eaa6c9dd0f49f2ad842f268e67 的实际HTTP源码Host+生产Worker+Edge完整流程通过：发现→加载→执行→保存→项目库搜索→校验预览→原始PNG下载，字节完全一致、项目目录不增副本；同长度编辑保留/拒绝、收据替换拒绝、跨项目/Broker/路径覆盖拒绝、源撤销后批准副本仍可读、存储撤权清屏/重授恢复。旧资源生命周期/配额/取消/断连、输出发布/接力/保存/五类预览同次回归。

最终浏览器http://127.0.0.1:18508（临时端口已关闭），1280×900明亮预览、390×844深色下载/撤权截图已实看：无旧容器空白、路径换行/控件可读、预览靠前、无横向溢出/错误覆盖。页面脚本错误0，四次故意撤权/编辑HTTP拒绝符合预期，Blob URL 8/8回收。Browser plugin not available，使用已有Playwright/Edge隔离生产模块页面，非原生WebView/提供方算法或其他OS接受。

初次generic测试类型推断/可访问性/URL mock失败、早期验证容器空白、搜索过渡定位失败均保留。修正真实setTarget重挂风险并补其他活动工具容器回归；中间通过与最终通过分开，最终见actual-host-library-attempt3.json、browser-result-2026-10-09T22-31-46-962Z.json和verification-summary.json。

154条状态/fullToolsAccepted=0保持；18项资源工具加image-workflow的原因已按各自scope细化，新增[接口需求](E:/zicode-studio-desktop/docs/plugins/devtools-resource-library-gaps.md)，明确目录枚举、多文件/100项批量、图片预览像素差异、HTML/SQLite交付类型、持久记录/提醒等尚缺条件。未修改DevTools或冻结包、未发送跨会话消息。正式resource.v1、二进制备份/导入与统一交付物、持久副本重新授权给工具、原生下载/真实算法包/全scope/并发性能/其他OS仍待。

缓存/版本配置保持，完整target/debug和EXE保留，无ZIP/新发布/完整运行副本。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 12919088 B/49文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 149714 B/37文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-17440768 B，与逻辑字节分列；失败自有夹具保留37文件/149714 B，没有重试任何历史拒绝清理。持续goal active。

协议：[文件库候选](E:/zicode-studio-desktop/docs/plugins/saved-output-library-candidate.md)；证据：[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/saved-output-library-2026-10-10/work-log.md)。


## 2026-10-10 已保存结果作为工具输入

插件主视图可信文件选择区新增“从项目已保存文件选择”：按当前项目搜索/40项分页，只读元数据，选中后收起列表露出接收插件版本及确认。确认后读取收据版本和SHA校验原始字节，复用接收方runtime/session/capability绑定的临时资源上传；不会自动运行、不新增持久副本，取消/改选/销毁撤销临时授权。独立saved-output-picker模块，CapabilityGateway最小接线，上传增加所选摘要核对；未修改DevTools/冻结包。

37项相关前端测试、check和i18n检查通过；实际HTTP Host+已有生产Worker+Edge回归通过：生产输出PNG→用户保存→搜索/选择不读字节→明确确认→接收方临时快照→独立点击运行→另一个Worker返回received→取消撤权且保存文件哈希不变。实际完整资源/输出/保存/文件库回归同次通过，页面脚本错误0，5次预期HTTP拒绝，Blob URL 8/8回收。最终浏览器http://127.0.0.1:13781（已关闭），1280×900明亮确认/390×844深色结果截图已实看。初轮截图发现确认按钮被列表推到滚动区下方，改为选中后收起列表并重验通过；早期通过不作为最终UI接受。运行按钮为独立验证适配，非原生完整界面/提供方算法接受。

初轮一个切换用例错误要求已失效旧视图重启控件，改按实际宿主销毁旧视图验证不发布；失败记录保留。最终证据actual-host-attempt2.json、browser-result-2026-10-09T22-48-14-094Z.json、verification-summary.json。

该实现为可信父界面重新上传，非Host零复制导入/签名来源链；文件库读取完成后持有的内存快照不随之后的存储撤权回收，接收权限仍实时校验。无主视图工具入口、正式导入协议、二进制备份/导入、原生WebView/真实DevTools包/全scope/其他OS仍待。154条工具及完整接受0保持，goal active。详见[候选说明](E:/zicode-studio-desktop/docs/plugins/saved-output-input-candidate.md)。

没有版本变更/新发布/ZIP/完整运行目录复制，未改Rust/React，debug解析主动使用项目public，复用完整target/debug及原生产Worker EXE 5ea0dfe82bc8fef11409472ef6856c41977c21eaa6c9dd0f49f2ad842f268e67。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 574246 B/10文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 0 B/0文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-1466368 B，与逻辑字节分列；成功夹具按原有所有权检查清理，未重试历史拒绝清理。

[阶段记录](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/saved-output-input-2026-10-10/work-log.md)。


## 2026-10-10 工具目录资源工具统一入口

无主视图资源工具已接入生产工具中心：元数据搜索→按需加载Host资源profile详情→确认共享本机/已保存项目文件→类型参数→独立执行/取消→结果展示。无需提供方主视图或新侧栏图标；普通invoke不绕过资源权限。Host准备请求可选catalogRevision，目录入口始终绑定当前详情版本，身份→目录→身份复核，旧目录拒绝且不分配资源；执行前再次检查。独立JS runner/React桥复用资源模块，相同scope值/回调更新保留运行，真实session变化清理，子参数React root延后卸载避免父清理冲突。大型plugin-shell仅getTarget接线，其他逻辑独立。

88前端/18文件、7目录、36资源测试通过（1 ignored另行实际专项），check/strict clippy/local build通过；fmt既有漂移，typecheck仍仅Habits/Watch两个既有mock错误。当前0.1.0 EXE 9b4b27f75818f3896f3a181ba7c80dfdcf9d1fd6d38912ebbddca4e2f26186f3 的实际HTTP源码Host+生产Worker+Edge最终attempt4通过：生产ToolCenter发现→无主视图接收工具→项目PNG搜索选择不读字节→目录版本绑定明确共享→类型false/0参数→独立运行另一个Worker→received→取消撤权清屏且持久文件哈希不变；此前完整资源、输出、接力、保存、文件库/下载回归同次通过。新目录入口资源输出预览/保存/接力仅接线，尚未在该入口实际接受；不将旧主视图回归泛化为新入口接受。

最终浏览器http://127.0.0.1:65425（临时已关闭），1280×900明亮确认/390×844深色结果截图已实看；数值输入盒模型越界已修正并加入卡片边界检查，控件/路径可读，无框架覆盖/横向溢出。页面脚本错误0，5次预期HTTP拒绝，Blob URL 8/8回收。Browser plugin not available，已有Playwright/Edge隔离生产模块验证；不是原生完整应用、提供方算法或其他OS接受。

attempt1验证脚本重复变量（未生成浏览器收据）、attempt2旧标题定位超时、attempt3功能通过但窄屏越界均保留为过程证据；最终见actual-host-attempt4.json、browser-result-2026-10-10T00-44-44-062Z.json和verification-summary.json。两个失败自有夹具保留72文件/254267B，未重试历史拒绝清理。

构建将可信controller作为运行时模块引用，tool-center.js 42506 B，未把旧生成文件递归打包。沿用单target及Cargo缓存，完整target/debug与EXE保留，无新发布/版本变更/ZIP/完整运行副本。前后存储扫描exit0/UnknownEntries=0：E:\zicode-studio-desktop\target 14189435 B/81文件；E:\zicode-studio-desktop\.cache 0 B/0文件；E:\zicode-studio-desktop\.cache\task-scratch 254267 B/72文件；E:\zicode-studio-desktop\site 0 B/0文件。E:可用空间观测变化-875888640 B，与逻辑字节分列。static clippy本次91m24s后终结通过，未因耗时或容量清除可复用缓存。

154项逐工具状态及完整接受0不变，goal active。正式resource.v1/来源链、目录入口资源输出实际验收、原生WebView/真实DevTools包完整scope、二进制备份/导入与其他OS仍待。[候选说明](E:/zicode-studio-desktop/docs/plugins/directory-resource-tools-candidate.md)；[阶段记录](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/directory-resource-tools-2026-10-10/work-log.md)。
## 2026-10-10 目录入口资源输出补充验证

本次补齐目录入口的真实资源输出验证：生产ToolCenter搜索文件输出示例→按需详情→明确共享输入→独立生产Worker生成PNG→按需预览→保存预览取消不写盘→明确确认保存原字节→选取另一工具并填写false/0参数→确认共享后独立执行接收Worker→展示received→撤销源输入清除临时预览/结果而保留已批准磁盘副本。该目录路径没有提供方iframe。

实际HTTP Host专项1通过（52.32s），复用已验证且相关Rust源摘要一致的测试Host及当前0.1.0/Pi1.1.0 debug EXE 6c14d757c277b87040f7c98c592e4e8380368a0ef4536d4641f38a428844ba6b。生产UI/Worker实际行为通过，不等于原生完整WebView或提供方算法验收。最终页面http://127.0.0.1:41108已关闭；页面脚本错误0，5次预期撤权/文件变更HTTP拒绝，Blob9/9回收。

已实看1280×900明亮保存确认与390×844深色转交结果截图：对话框背景/正文/生成路径可读，false/0及接收结果可见，无框架覆盖或横向越界。本轮无需修改生产代码或重新构建，也没有修改冻结提供方包。证据：技术档案iterations/directory-resource-output-2026-10-10/actual-host-attempt1.json、browser-result-2026-10-10T01-02-39-225Z.json、verification-summary.json。此前“目录资源输出仅接线”属于历史验证边界，本条补充该入口接受证据，不改写历史记录。

154条工具状态及完整工具接受0不变。正式resource.v1与签名来源链、多输入/目录/批量、真实DevTools包完整scope、原生完整应用与其他OS仍待。

## 2026-10-10 工具详情异常隔离
独立React异常边界保留其他工具/目录，失败不自动重试；共享vendor补Component并增加回归。真实HTTP Host+生产Worker+生产ToolCenter故障注入通过，桌面/窄屏截图已实看。页面脚本错误0，预期React捕获日志1/预期HTTP拒绝5，Blob9/9回收。94项前端通过；typecheck仅既有Habits/Watch错误。最初vendor缺导出失败保留，最终attempt2通过。未新增原生EXE构建/版本/ZIP/完整运行副本，154项完整接受仍0。详见[说明](E:/zicode-studio-desktop/docs/plugins/tool-view-failure-isolation.md)及技术档案iterations/tool-failure-isolation-2026-10-10。

## 2026-10-10 Pi1.1.0真实DevTools链路
当前debug EXE保持6c14d757，单target编译新版Pi锁定测试Host一次，Inspect7/Transforms23基本操作与各10权限阶段通过；150旧缓存拒绝、11独立对照、50Worker回收/管道关闭。三个原始包13/493/797文件逐SHA通过。矩阵current证据更新，旧记录保留历史；154项状态及完整接受0不变。没有模型/原生界面/其他OS/签名生命周期验收。清理本轮两夹具被自动审批拒绝（无具体原因），实际删除0，6812396B/1346文件保留并给手工清单；不重试。详见[复验记录](E:/zicode-studio-desktop/docs/plugins/pi-1.1-devtools-acceptance.md)及技术档案iterations/pi-1.1-devtools-2026-10-10。
