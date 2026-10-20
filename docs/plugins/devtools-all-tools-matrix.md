# Zi DevTools 全工具接入矩阵

日期2026-10-09；提供方公开目录0.82.0-dev.105，154项。完整工具验收0项，首批3条目的5能力已有Windows接入验证。诊断11项及文本转换9项候选已接收，尚未兼容验收；不能等同全部scope完成。源状态来自声明，评审路径非完整运行/可行性证明。

[目标](devtools-all-tools.md) · [阻塞清单](devtools-blocked-tools.md) · [完整scope/版本/责任方JSON](devtools-all-tools-matrix.json) · [诊断接收记录](devtools-diagnostics-acceptance.md)。

此前Windows开发Host通用工具工作台的Base64编码实际worker_timeout（5220ms）保留为previousManualToolAcceptance。优化dev运行时编译热点后，当前debug EXE的真实搜索→表单→编码/解码→结果分别494/626ms成功，工具页切换保留输入/结果。后续精确恢复5个JSON原冻结摘要，13文件及既有真实HTTP专项重新通过，旧失败保留。当前Inspect84/Transforms164个可表达Worker语义用例全通过，20个raw用例仍未覆盖；真实工作台JSON→YAML/URL解码基本样例1252/1015ms通过。见currentRuntimeVerification及iterations/fixture-integrity-2026-10-09；不替代Pi、完整scope或其他OS验收，完整接受仍0。

状态统计：首批子能力已验证3项；候选包已接收待验收27项；待提供方插件包13项；待Host扩展43项；待Host conformance 1项；提供方规划未实现43项；提供方部分实现20项；待Host接口映射4项。

| ID / 工具 | 独立版版本 / 状态 | 插件状态 | 接入评审路径 | 当前原因 |
| --- | --- | --- | --- | --- |
| json / JSON | 1.1.3 / implemented | 首批子能力已验证 | compute.wasi.v1 / 新工具输入输出契约 | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 |
| base64 / Base64 | 1.1.3 / implemented | 首批子能力已验证 | compute.wasi.v1 / 新工具输入输出契约 | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 |
| url / URL 编码 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 URL编码基础样例已验证传给独立Base64工具及用户预览确认保存，磁盘内容精确核对；不外推23全部结果场景。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| sha256 / SHA-256 文本摘要 | 1.1.3 / implemented | 首批子能力已验证 | compute.wasi.v1 / 新工具输入输出契约 | 固定dev57包中列出的能力已通过Windows真实Host/Worker/Pi/View；包内工具版本1.1.0，与当前独立版版本不同。完整工具范围和当前版本尚未验收。 |
| timestamp / 时间戳 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 时间格式/显式时区换算可纯计算；自动当前时间/本地时区需单独声明来源并验证，不能仅按名称断言一定需要Host。 |
| uuid / UUID | 1.0.1 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 尚无插件实包；可评审WASI系统随机源或确定性输入方案，但系统安全随机与种子重现须分开声明并跨平台验证，不能使用不安全随机替代；当前冻结首批契约未定义此操作。 |
| jwt / JWT 内容查看 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具1操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；历史候选Pi门禁曾失败（yaml.from_json真实worker_timeout，5000ms预算未变），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| regex / 正则表达式 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| number / 进制转换 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具4操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| ascii-codes / ASCII 码表 | 1.0.0 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| symbol-library / 特殊字符与表情 | 1.0.0 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| ascii-art / ASCII Art 字符画 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | 缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 文本/图形生成可拆为纯计算；图片输入、PNG/TXT导出与保存仍缺资源和二进制结果协议。 |
| qr / 二维码 | 1.0.2 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | 缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 文本/图形生成可拆为纯计算；图片输入、PNG/TXT导出与保存仍缺资源和二进制结果协议。 |
| color / 颜色转换 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已核对 Inspect 0.1.1 无签名候选；颜色能力在隔离 Windows 真实 Host/Worker 与无模型 Pi/Broker 样例执行通过，复制前后 606 文件及目录索引均匹配。正式签名包、模型自主选择、原生界面、完整边界和其他系统验收仍待，不计完整工具接受。 |
| text-stats / 文本统计 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具1操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| html-escape / HTML 转义 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| text-escape / 文本转义 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| case-convert / 命名转换 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具4操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| yaml / YAML / JSON | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具2操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；历史候选Pi门禁曾失败（yaml.from_json真实worker_timeout，5000ms预算未变），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| hex / UTF-8 / Hex | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具2操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| lines / 文本行处理 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具5操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| url-inspect / URL 解析 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收无签名文本转换候选0.1.0，共9类23操作；本工具1操作，版本1.0.2。797文件摘要一致。Windows实际生产Worker164/164语义结果通过、0失败；10原始字节不能原样重构单列跳过。Host/View/Pi、全部源scope映射、签名安装/更新回滚、撤权与其他OS仍待验收；8192 UTF8字节及48KiB结果限制保留，不计完整工具接受。 实际Windows发现/加载及23基础样例、操作搜索、业务错误保留与恢复已验证；文本框CRLF转LF行为单列，原始fixture不变。 历史真实Pi两页20+3发现/按需加载和23精确样例、10授权阶段、115缓存拒绝与5独立对照通过；原始CRLF统计结果精确匹配。 历史Pi回归曾在url.decode出现worker_timeout；失败记录保留，不计完整接受。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| cidr / IPv4 CIDR | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具1操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；历史候选Pi门禁曾失败（yaml.from_json真实worker_timeout，5000ms预算未变），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| data / CSV / JSON 数据工作台 | 1.10.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需CSV/TSV/列结构JSON实包及空表/列序/数值类型、草稿实例恢复和范围接力的一致性；输出文件不等同持久实例状态。
| files / 批量文件校验 | 1.1.1 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需多文件/大文件身份、流式输入、进度/取消契约和SHA256/SHA512实包；单个32MiB快照不证明全部文件范围。
| http / HTTP 请求调试 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| diff / 文本差异对比 | 1.0.0 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| network / 网络诊断 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| services / 本地服务管理 | 1.8.0 / implemented | 待Host扩展 | service.v1 / 受控进程扩展 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| json-path / JSON 路径查询 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| json-diff / 结构化 JSON 对比 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| data-schema / 数据质量检查 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| data-transform / 数据列变换 | 1.2.0 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| csv-merge / CSV 合并与关联 | 1.2.0 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| checksum-manifest / 校验清单 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需同目录1–64文件集合/受限相对名称/身份与清单定位匹配；提供方交付穿越/重复名称/链接/取消正反例。
| disk-inspector / 目录空间分析 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需用户确认的目录只读授权、条目/深度/时间预算、跳过链接和部分结果契约；现有字节快照不授予目录枚举。
| duplicate-files / 重复文件检查 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需目录/候选集合授权、文件身份复核、哈希读取字节预算、取消和只读去重实包；不增加自动删除。
| file-compare / 目录内容对比 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需双目录独立授权、相对路径/类型/摘要比较、部分结果和CSV交付契约及实包。
| cron / Cron 表达式 | 1.0.2 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 固定偏移和显式起始时刻的计算可先接入；后台实际调度属于service扩展。 |
| random / 随机数据生成 | 1.0.1 / implemented | 待提供方插件包 | compute.wasi.v1 / 新工具输入输出契约 | 尚无插件实包；可评审WASI系统随机源或确定性输入方案，但系统安全随机与种子重现须分开声明并跨平台验证，不能使用不安全随机替代；当前冻结首批契约未定义此操作。 |
| sql-format / SQL 格式化 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| json-schema / JSON Schema 校验 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| log-viewer / 日志工作台 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| sqlite / SQLite 浏览器 | 1.1.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需只读数据库快照/VFS与表/列/分页类型化结果实包，文件变化/值预算/超时取消证据；不直接开放路径或任意SQL写入。
| http-collections / HTTP 集合与环境 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| curl-import / cURL 导入 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| tls-inspect / TLS 证书检查 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| encoding-detect / 文件编码转换 | 1.1.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需严格多编码/BOM、回读/SHA与目标字节预览实包，以及原文件身份变化/交付类型与生成名称契约。
| file-rename / 批量重命名 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| image-tools / 图片工作台 | 1.5.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需缩放/格式/质量/编码预览实包；独立版1600万像素与Studio4Mi像素/4096单边预览范围差异仍待协商验证。
| image-batch / 图片批处理 | 1.3.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需1–100输入集合、输出清单/命名/冲突预览、逐项进度/取消/部分成功与目录交付契约；4项输出不是100项批处理接受。
| image-crop-annotate / 图片裁剪与标注 | 1.4.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已用自有合成材料完成Windows原生确认资源→隔离SDK→Host→WASI→JSON显示、撤权拒绝及取消/回收底层验证；仍是内部resource draft，未发布公开profile。提供方dev.103新增共享图片预算与失败保留工作声明，尚未交付本项独立图片插件，缺正式二进制输入输出/结果存储、用户确认写入、完整算法范围与OS验收。自有WAT不替代提供方图片算法实包。 |
| image-metadata / 图片元数据检查与清理 | 1.3.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已用自有合成材料完成Windows原生确认资源→隔离SDK→Host→WASI→JSON显示、撤权拒绝及取消/回收底层验证；仍是内部resource draft，未发布公开profile。提供方dev.103新增共享图片预算与失败保留工作声明，尚未交付本项独立图片插件，缺正式二进制输入输出/结果存储、用户确认写入、完整算法范围与OS验收。自有WAT不替代提供方图片算法实包。 |
| markdown / Markdown 预览 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需结构化安全渲染实包及HTML交付MIME/生成名称/CSP契约；不执行原始HTML，.bin下载不等同HTML另存。
| unicode / Unicode 字符检查 | 1.0.2 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 已接收inspect无签名候选0.1.0，4工具7操作；本工具3操作。493文件路径/字节/摘要固定；Windows实际生产Worker84可表示向量语义结果全通过；10原始字节向量未覆盖。Windows隔离资料目录发现/启用/沙箱View及7操作样例通过；搜索/错误保留/原生取消与确认/独立工具恢复通过。仅开发目录安装；历史候选Pi门禁曾失败（yaml.from_json真实worker_timeout，5000ms预算未变），签发安装仍待，不计完整接受。沿用8192 UTF8字节/48KiB预算。独立版范围映射、YAML重复键/数值语义与旧JSON试点差异、JWT不验签、Unicode标量/NFC/NFKC边界需专项验收；签名生命周期/取消/结果接力及其他OS仍待。目录快照版本与候选工具版本分别保留，不覆盖原始快照。 后续当前debug EXE303fd49a重验：本候选全部基本操作、10授权阶段、缓存拒绝与独立对照通过；旧超时证据保留为历史失败。仅Windows无模型机制验收，完整scope/签名生命周期/其他OS仍待，不提高完整接受计数。 2026-10-11当前Host/Worker与Pi1.1.0的基本样例和10阶段权限生命周期回放通过，旧失败保留；只验证对应候选操作，完整scope/签名生命周期/其他OS仍待。 |
| escape-suite / 转义与转码扩展 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| time-zone / 时区工作台 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| regex-replace / 正则替换 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| jwt-verify / JWT 本地验签 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| crypto / 加密与签名实验台 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| pipeline / 可组合数据管线 | 0.17.0 / in-progress | 提供方部分实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| file-search / 文件内容检索 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| pdf-text / PDF 文本提取 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| openapi / OpenAPI 请求生成 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| plugins / 插件与连接器 | 1.0.0 / implemented | 待Host接口映射 | Host管理接口映射；需版本化插件扩展 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| integrations / 本机集成发现 | 1.0.0 / implemented | 待Host扩展 | service.v1 / 受控进程扩展 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| model-profiles / 模型连接配置 | 0.1.0 / in-progress | 提供方部分实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| model-chat / 多轮模型工作台 | 0.1.0 / in-progress | 提供方部分实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| model-compare / 模型对比评测 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| prompt-library / 提示词模板库 | 0.1.0 / in-progress | 提供方部分实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| token-budget / Token 与上下文预算 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据；其离线算法可按纯计算候选评审，不能仅按网络/AI分类推定必须访问服务；本地数据/公钥/tokenizer/时区表应显式输入或随包固定。网络修复、保存等可选操作另行授权。 |
| structured-output / 结构化输出验证 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1；可选模型修复另需service.v1 | 提供方目录标记planned，尚无插件实包。离线JSON Schema校验可先纯计算；若通过模型修复，需要单独授权服务调用、输入发送和结果预览，不能自动改写。 |
| embedding-playground / Embedding 工作台 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| model-benchmark / 本机模型性能测试 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| ollama-manager / Ollama 模型管理 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| mcp-connections / MCP 连接管理 | 0.1.0 / in-progress | 提供方部分实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| mcp-inspector / MCP 协议调试台 | 0.1.0 / in-progress | 提供方部分实现 | service.v1 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| mcp-permissions / MCP 工具权限 | 0.1.0 / in-progress | 提供方部分实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| screen-recorder / 屏幕录制 | 1.1.0 / implemented | 待Host扩展 | desktop.v1 + resource/service | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screen-recorder-multimonitor / 显示器选择录屏 | 0.1.1 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screen-recorder-audio-mix / 双声源混录 | 1.0.1 / implemented | 待Host扩展 | desktop.v1 + resource/service | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screen-recorder-audio-gain / 录屏独立音量调节 | 1.0.1 / implemented | 待Host扩展 | desktop.v1 + resource/service | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screen-recorder-audio-meter / 录屏实时音频电平 | 1.0.1 / implemented | 待Host扩展 | desktop.v1 + resource/service | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screen-recorder-long-audio / 录屏长时音频稳定性 | 0.1.0 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| mcp-export / MCP 客户端配置导出 | 1.0.0 / implemented | 待Host接口映射 | Host管理接口映射；需版本化插件扩展 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| mcp-server / Zi DevTools MCP Server | 1.0.0 / implemented | 待Host接口映射 | Host管理接口映射；需版本化插件扩展 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| agent-runner / Agent 任务工作台 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| agent-codex / Codex CLI 适配器 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| agent-claude / Claude CLI 适配器 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| agent-replay / Agent 记录查看器 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需v1/v2/v3解析/隐私默认隐藏/比较实包及顶层64记录目录授权、累计16MiB/跨记录查询契约；不执行模型或MCP。
| workflow-builder / 可视化工具工作流 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| agent-scheduler / 定时任务与触发器 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| rag-sources / 本地知识源管理 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-ingestion / 文档解析与分块 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-index / 增量知识索引 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-vectors / 本机向量索引 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-keyword-search / 本机关键词检索 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-search / 混合检索工作台 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-answer / 带引用的知识问答 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| rag-eval / RAG 质量评测 | 1.0.0 / implemented | 待Host扩展 | service.v1 | 当前WASI不能访问网络、模型凭据、数据库服务或MCP任务；缺少按目标授权、凭据引用、响应上限、任务进度/取消及审计契约。 |
| anythingllm / AnythingLLM 连接器 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| obsidian-vault / Obsidian / Markdown 库 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| ocr-documents / 本地 OCR 文档助手 | 0.0.0 / planned | 提供方规划未实现 | compute.wasi.v1 / 新工具输入输出契约 | 提供方目录标记planned，尚无该条目实现及插件交付证据。没有交付该工具完整范围的独立WASI包；需固定输入/输出schema、工具版本、资源预算与正反例；首批仅text输入和8192字节不能直接覆盖所有新操作。 |
| browser-clipper / 网页与对话收集 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需公开HTTPS地址/重定向/时长/体积权限边界、知识源目录Markdown命名/去重/无覆盖交付及实包；项目输出不等同知识源保存。
| plugin-updates / 插件版本与更新 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| plugin-sdk / 隔离进程插件 SDK | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| plugin-market / 插件目录与安装源 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| plugin-settings / 插件设置与凭据 | 0.1.0 / in-progress | 提供方部分实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| plugin-health / 插件健康诊断 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| global-launcher / 全局快捷启动器 | 1.4.0 / implemented | 待Host扩展 | desktop.v1 + resource/service | 当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| command-collections / 工作区与工具集合 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| clipboard-actions / 剪贴板动作 | 0.0.0 / planned | 提供方规划未实现 | desktop.v1 + resource/service | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| docker-panel / Docker 本地面板 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| git-workbench / Git 工作区面板 | 0.0.0 / planned | 提供方规划未实现 | service.v1 / 受控进程扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| parquet-workbench / Parquet / Arrow 工作台 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| java-trace / Java 异常链 | 1.0.3 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 未签名trace 0.1.0候选346文件摘要一致；Windows Pi/Host/Worker基本样例和10阶段权限通过。原生View、全部边界、签名安装及其他OS未验收。 |
| django-trace / Django / Python 堆栈 | 1.0.3 / implemented | 候选包已接收待验收 | compute.wasi.v1 / 新工具输入输出契约 | 未签名trace 0.1.0候选346文件摘要一致；Windows Pi/Host/Worker基本样例和10阶段权限通过。原生View、全部边界、签名安装及其他OS未验收。 |
| java-thread-dump / Java 线程转储分析 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入jstack/jcmd文本分析，不采集进程。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| java-dependencies / Maven / Gradle 依赖冲突 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入Maven/Gradle依赖文本，不执行构建。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| java-environment / JDK / 构建环境诊断 | 1.0.0 / implemented | 待Host扩展 | service.v1 / 受控进程扩展 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| java-gc-log / Java GC 日志分析 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入GC文本分析，不读取磁盘或采集进程。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| java-jfr / JFR 录制报告浏览 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入JFR JSON，不读取二进制JFR或启动JDK。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| spring-config / Spring 配置对比 | 1.1.2 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入两份JSON/YAML配置差异/脱敏，不请求Actuator。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| spring-actuator / Spring Actuator 只读诊断 | 1.0.0 / implemented | 等待Host conformance与提供方适配 | `service.http.get.v1 = 1.0.0-preview.1`（Host源码已实现，部分loopback conformance通过） | 工具在独立版中显式选择基础地址，对 health/info/metrics 发只读 GET，不跟随重定向或读取 env/configprops。Studio已有[固定 endpoint、逐次确认、批准后DNS、预算与取消实现](service-http-get-preview.md)；loopback Host 已验证200/503、确认前不连接、重定向拒绝、声明长度与chunked流式超过1 MiB拒绝、深层JSON复杂度拒绝、不受信任loopback TLS证书拒绝且未发送HTTP、测试专属CA信任后的HTTPS 200成功、审计落盘和在途取消终态；真实Host并发撤权用例验证撤销插件A会终止A、插件B仍成功。Rust静态检查与定向Host测试通过。操作系统默认根证书HTTPS、DNS变化、更多撤权/重载竞态、其余响应预算边界、审计故障恢复、完整Pi/View、跨平台、提供方包与fixtures仍待验收。WASI插件不得自行联网。 |
| django-environment / Python / Django 环境诊断 | 1.0.0 / implemented | 待Host扩展 | service.v1 / 受控进程扩展 | 当前插件不能执行本机程序或读取任意环境配置；需用户指定可信程序、固定/受限参数、目录授权、超时取消和日志预算，不能调用DevTools.exe代替插件。 |
| django-migrations / Django 迁移计划检查 | 1.1.2 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入迁移计划及SQL分析，不访问数据库或执行迁移。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| django-sql / Django SQL / N+1 分析 | 1.1.2 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入SQL查询日志JSON数组归一化/重复分析，不执行SQL。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| django-urls / Django URL / reverse 检查 | 1.1.2 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入URL列表及检索，不加载Django项目。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| django-drf / DRF OpenAPI 契约对比 | 1.1.2 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.2，456文件摘要一致；仅覆盖导入两份OpenAPI JSON差异，不调用远程API。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| django-checks / Django 部署检查报告 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入检查输出，不运行manage.py。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| celery-diagnostics / Celery 任务故障分析 | 1.1.3 / implemented | 候选包已接收待验收 | diagnostics.compute.wasi.v1.proposal / 完整范围另行映射 | 已接收unsigned诊断候选0.1.2/工具1.1.3，456文件摘要一致；仅覆盖导入Celery任务日志文本分析，不连接Broker。Windows生产Worker 141/142语义结果通过、1失败，46原始字节用例不可由Worker原样交付单列skipped。保留candidate01/02失败证据。正式诊断profile/完整scope/签名安装与升级回滚/模型自主选工具/签名更新回滚/执行中取消生命周期/结果操作及其他OS仍待验收。 新包实际Windows发现/加载/Host-WASI-View的11基本样例和一次恢复通过，不替代边界、完整scope或正式profile验收。 新包真实Pi11报告、10授权阶段、55逐能力缓存拒绝与5独立工具对照通过，原候选02失败保留。 |
| file-intake / 文件拖放入口 | 1.0.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需主窗/快捷面板多文件拖放路由、类型/数量/大小审核和用户选择接收工具契约；不自动执行/上传，不传任意本机路径。
| task-center / 后台任务中心 | 1.1.0 / implemented | 待Host接口映射 | Host管理接口映射；需版本化插件扩展 | 这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| workspace-sessions / 项目空间与工作实例 | 0.4.0 / in-progress | 提供方部分实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| artifact-hub / 类型化资料与结果 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| task-runtime / 统一后台运行管理 | 0.0.0 / planned | 提供方规划未实现 | Host管理接口映射；需版本化插件扩展 | 提供方目录标记planned，尚无该条目实现及插件交付证据。这是提供方自己的管理/运行基础设施，不能再在Studio插件内部维护另一套安装器、权限库或任务调度；需要将具体操作映射为Studio通用Host接口，保留功能而非启动独立程序。 |
| operation-permissions / 授权写入与变更预览 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| memos / 备忘录 | 1.3.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需记录CRUD/草稿、多窗口冲突、回收站和JSON备份合并/替换恢复契约及实包；持久输出文件不是应用记录库。
| calendar-planner / 万年历与日程 | 1.4.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需日期/重复/跨天实包及记录/提醒注册、延后/重启补提醒、时区/UID/导入导出/恢复的版本化契约。
| planner-interop / 日程进阶与互通 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| memo-library / 备忘资料库互通 | 0.0.0 / planned | 提供方规划未实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记planned，尚无该条目实现及插件交付证据。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| data-sqlite-export / 表格另存 SQLite | 1.1.0 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需SQLite结果类型/生成名称、范围/类型确认、事务生成/独立复核/提交前取消及实包；.bin保存不等同完整SQLite导出。
| recorder-tutorial / 教程录屏辅助 | 0.2.0 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| app-update-check / 程序更新检查 | 0.8.0 / in-progress | 提供方部分实现 | 独立程序生命周期例外 / 可拆分算法 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。DevTools自身双EXE/MSI升级和回滚不能原样作为Studio插件执行：它替换的是另一独立程序，违反插件不依赖/管理DevTools.exe的边界。签名/差分校验算法可以另做纯计算插件；Studio插件升级由Host生命周期管理。 |
| app-delta-update / 增量更新与回滚 | 0.2.0 / in-progress | 提供方部分实现 | 独立程序生命周期例外 / 可拆分算法 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。DevTools自身双EXE/MSI升级和回滚不能原样作为Studio插件执行：它替换的是另一独立程序，违反插件不依赖/管理DevTools.exe的边界。签名/差分校验算法可以另做纯计算插件；Studio插件升级由Host生命周期管理。 |
| advanced-calculator / 全能计算器 | 0.10.0 / in-progress | 提供方部分实现 | resource.v1；纯计算子集可先交付 | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。缺少供第三方插件使用的通用资源句柄、流式读取/取消、结果存储与用户确认写入接口；Host已有内置能力不等于插件已可调用。 |
| explorer-menu / 资源管理器统一右键入口 | 0.0.0 / planned | 提供方规划未实现 | desktop.v1 + resource/service | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| clock-workbench / 全功能时钟 | 0.4.0 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| screenshot-workbench / 截图与透明套索 | 0.4.5 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| unified-shortcuts / 统一前缀快捷键 | 0.7.0 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| super-clipboard / 超级剪贴板 | 0.5.0 / in-progress | 提供方部分实现 | desktop.v1 + resource/service | 提供方目录标记in-progress；已有子功能可单独交付，但不能代表完整范围。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| clipboard-workflows / 剪贴板数据工作流 | 0.0.0 / planned | 提供方规划未实现 | desktop.v1 + resource/service | 提供方目录标记planned，尚无该条目实现及插件交付证据。当前无第三方插件可用的屏幕/音频/剪贴板/全局快捷键与桌面回调契约；Windows专有实现不能直接作为跨平台WASI能力。 |
| text-flow / 文本 / 表格流程 | 1.6.1 / implemented | 待Host扩展 | resource.v1；纯计算子集可先交付 | Studio已验证确认资源输入/WASI消费/二进制输出/跨owner接力，以及resource.save.draft1保存与resource.library.draft1项目检索/分页/按需校验预览/原始下载；证据为源码HTTP Host/生产Worker/隔离Edge，非提供方算法。正式resource.v1、原生GUI/真实实包、统一备份/导入和完整scope仍待。 需22操作/最多16步实包、配方/类型/逐步结果/失败/取消/实例恢复不执行和文件交付契约；多次手工调用不等同流程接受。
| image-workflow / 图片操作流程 | 0.7.0 / in-progress | 提供方部分实现 | resource.v1 / 图片二进制结果与流程契约；纯计算子集可先交付 | 已接收并冻结 `com.zicode.devtools.image@0.1.1` 的单能力 unsigned candidate（`devtools.image.resize` / 0.11.0）；真实 Windows Debug EXE + HTTP Host 验证安装/发现、授权读取、WASI 缩放、输出登记/读回及坏图无输出，收据 7 文件、1,036,667 字节。2026-10-16 真实原生 Studio 窗口完成候选目录安装、权限门、工具发现/按需打开、资源确认、动态执行和 2×1 PNG 本机预览；转交面板没有兼容接收工具，未转交、未保存。截图未归档。签名生命周期、接力/保存、原生损坏图失败恢复、取消/撤权/并发边界、裁剪/OCR/批处理及其他 OS 仍待；不提高154项完整接受数。 |

2026-10-09补充真实Windows结果链证据：诊断候选03→独立Base64编码→用户预览确认保存，磁盘内容SHA一致；业务错误保留输入/旧结果、恢复成功。证据见技术博客iterations/native-result-flow-2026-10-09。仅Java线程基础样例和单字符串结果，完整154工具接受仍0，不改变逐项状态/正式profile要求。

## 2026-10-10 插件资源输出预览

可信父级新增按点击读取的PNG/JPEG/WebP、纯文本和二进制预览；引用白名单、完整SHA-256、字节/像素预算、关闭/切换清理及每5秒授权复核。大型View Host只做必要接线，未覆盖其他修改。37项定向前端测试、check与Rust check/严格clippy通过；fmt既有漂移保留。真实HTTP Host+生产Worker+Edge隔离页面已完整验证发现→加载→执行→展示，五类输出、4097宽PNG拒绝、源撤销清屏/取消共享及4个Blob URL全部释放；桌面1280x900明暗/390x844深色截图已实看，补拍稳定主题后控件可读，无横向溢出，无页面脚本错误，仅故意撤销时一次预期HTTP拒绝。

这不是原生GUI或DevTools算法接受；跨owner授权接力/确认保存、完整源scope/审计/幂等和其他OS继续待验。154项工具/fullToolsAccepted=0保持；逐项阻塞原因与重开条件继续按matrix。版本0.1.0不变；复用单target，build:local保留target/debug完整运行目录与EXE，不生成ZIP或新完整副本。使用测试自有复制夹具，提供方冻结包未修改。三个失败浏览器初始化/按钮定位记录均保留，与通过证据并列。

文档：[预览边界](E:/zicode-studio-desktop/docs/plugins/resource-output-preview.md)；[本轮阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-output-preview-2026-10-10/work-log.md)。



## 2026-10-10 资源跨工具授权基础

新增内部resource.transfer.draft1两步Host接口：准备无目标读取权；仅桌面明确确认后生成同runtime/session中目标插件/能力专属引用，16张/60秒票据，32条/128MiB配额，重复确认返回原引用、不重复登记。不可变Arc分块避免锁内复制大字节。显式祖先owner/proof贯穿读取、Worker运行和输出登记；源撤销/过期级联，双方撤权重授拒绝旧授权，未开放任意路径、Broker转授权或写盘。大型host_server.rs只增加路由与桌面白名单接线。

25项资源域测试通过（1 ignored另行显式执行），check/严格clippy通过，fmt既有漂移保留，frontend check/设计回归通过。0.1.0本地EXE fae1acb22439612428f31c0f42ca81fdd155dd27ae0773c36451e2623469d346实际专项通过：Studio自有源Worker生成300000字节原始输出→准备/确认→另一插件Worker消费；32KiB读回对照、Broker/未确认/owner覆盖拒绝、重复确认单记录、双方撤权重授拒绝、有效新来源撤销级联与独立目标输入成功。旧授权/配额/取消/断连/输出发布七边界和Edge预览同次回归通过。

当前是Host协议接受，尚未接入接收工具搜索/分页/确认与切换界面，非原生GUI、人类实际确认、真实DevTools算法或其他OS接受。正式resource.v1、跨会话、持久审计/幂等、确认保存与冲突恢复仍待。154条/fullToolsAccepted=0不变，资源类原因已更新为候选Host已验证而真实界面/正式协议/实包仍缺。单target缓存与完整target/debug/EXE保留，不生成ZIP。

文档：[跨工具候选](E:/zicode-studio-desktop/docs/plugins/resource-transfer-candidate.md)；证据：[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-transfer-grants-2026-10-10/work-log.md)与actual-host-transfer-attempt1.json。goal active。

## 2026-10-10 资源输出确认保存

新增内部resource.save.draft1与可信父级保存对话框：准备仅元数据，不写盘；用户确认后以生成名称写入当前项目.zicode/outputs，原始二进制与来源收据各自刷盘，不覆盖已有文件。票据60秒/最多16张，绑定源/祖先授权、项目位置及存储授权世代；重复确认核验字节和收据，不新增文件，用户编辑后拒绝重放。32MiB单资源、128目录/256MiB项目预算只限制新保存，不删除用户数据。大型View Host/HTTP facade只必要接线，新逻辑独立模块。

40项前端、31项资源域测试通过（1 ignored另行显式运行）；check/strict clippy/build:local通过，fmt既有漂移保留，全量typecheck仍仅Habits/Watch两个既有测试mock错误。0.1.0 EXE 5718a655be11cd311c0c78d0ddda5105e39a03ebb4f9a0b88ac4cde32d363b1a 完成真实HTTP源码Host+生产Worker+Edge：300000字节原始输出保存、同票据重放、用户编辑保留、Broker/路径覆盖/未确认拒绝、存储撤权重授/项目改变/祖先撤销拒绝，发布前两类撤权清理未发布字节且资源库锁可获取，独立新资源仍正常。浏览器发现→加载→执行→预览→取消保存无磁盘变化→确认保存精确PNG/来源→重放不增文件通过，跨工具接力/五类预览/撤权清屏同次回归通过。

1280×900明亮保存确认与390×844深色成功/撤权截图已实看：不透明对话框、路径换行、关闭/确认可见，无横向溢出/错误覆盖；无页面脚本错误，只有两次故意撤权的预期HTTP拒绝，5/5 Blob URL释放。Browser plugin not available，使用已有Playwright/Edge隔离生产模块页面；临时本机端口结束后关闭，未保留具体端口。不是原生WebView、人类文件体验或真实DevTools资源算法验收。

两次真实环境失败均为测试恢复/顺序问题：撤销required权限同时禁用插件；旧票据在授权世代变化后应先被拒绝，文件编辑断言需先测。仅修正Studio测试，失败日志/自有目录保留。提供方冻结包未改，154条状态/fullToolsAccepted=0保持。正式resource.v1、真实算法包/完整scope、二进制交付物索引与备份、任意目的地/覆盖冲突恢复、跨重启幂等/崩溃恢复、多跳流程和其他OS仍待。持续目标active。

单target/已有Cargo缓存，完整target/debug运行目录与EXE保留，版本不变，无新发布/ZIP/完整运行副本。证据见[阶段日志](C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-save-2026-10-10/work-log.md)、actual-host-resource-save-attempt3.json与browser-result-2026-10-09T21-57-53-384Z.json；协议见[资源保存候选](E:/zicode-studio-desktop/docs/plugins/resource-save-candidate.md)。最终存储统计另见阶段storage-after.txt和verification-summary.json。


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

2026-10-11 当前Pi状态：当前源码Host/保留Worker/Pi1.1.0的Inspect7与Transforms23基本操作、两组10阶段权限生命周期均通过；对应13条目已同步，旧失败留历史。不代表完整scope或154工具完成。见[本轮真实记录](devtools-current-pi-lifecycle.md)。
