# Pi 1.1.0 / DevTools 实际接入复验（2026-10-10）

## 已验证

当前0.1.0 debug EXE不变，内置Pi1.1.0实际二进制版本和摘要已核对；测试Host按新Pi锁定版本编译一次（Cargo报告70秒，入口含摘要等总76.02秒），复用同一target/profile，然后两个精确ignored专项独立进程串行运行，避免重复编译。未修改生产源码/DevTools或扩大5秒Worker预算。

原始text/inspect/transforms三个包只读核验分别13/493/797文件，逐文件SHA与接收摘要一致。实际Pi→搜索→按需加载并注册→本机Host→生产Worker→精确输出：Inspect7基本操作通过、每项1290–1947ms；Transforms23基本操作通过、每项1142–1572ms，包含20+3工具分页。时延受本机负载影响，不将本轮与旧轮次当性能基准。

每个包验证10阶段：未授权、运行、撤权、恢复、禁用、启用、再次撤权、卸载、重装未授权、重装授权。150个旧缓存调用被拒绝；11次无关工具对照继续可运行，业务INVALID_INPUT/恢复与旧目录revision拒绝沿用专项断言通过。50个Worker启动均有唯一reaped/pipes_closed记录，终态对应Pi/Worker/测试Host路径活跃进程0。

Inspect专项32.18秒、Transforms51.80秒，均1通过/0失败。没有模型调用、UI改动或新截图；不冒充原生WebView、模型自主选工具或其他OS验收。

## 范围与记录

矩阵currentRuntimeVerification/currentPiVerification更新为本轮有界Pi机制证据，旧字段完整保留到historicalRuntimeVerifications/historicalPiVerifications；不把此前84/164个语义用例外推为新版完整回归。实际关联的13个sourceToolId添加基本操作证据，没有变更154项状态计数，完整工具接受仍0。旧0.84.2成功和早期超时记录保留。

Pi1.1.0的新能力/所有RPC命令、提供方全部边界输入/完整scope、签名安装生命周期、模型调度、其他OS与持续稳定性仍待。基本样例通过并不消除这些接入缺口。

## 磁盘和清理

compact证据已从两次成功专项临时目录复制并逐SHA核对。删除两个本轮目录的命令被自动审批拒绝（blocked by policy，未提供具体原因），整条命令未执行，实际删除0。保留1346文件/6812396逻辑字节，详见阶段manual-cleanup.md；不重试，也不删除历史已拒绝路径。

保留当前debug/release完整运行目录与EXE，无新版本、ZIP或完整运行副本。有用Cargo缓存沿用；新增编译量及卷空间前后记录在技术档案storage-comparison.json，不能把逻辑变化当物理释放。

证据：C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/pi-1.1-devtools-2026-10-10/ 的verification-summary.json、两份Pi日志/receipt、Worker事件、包核验和test-host.json。
