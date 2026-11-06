# Windows Studio 表格工作台增量交付

核对时间：2026-10-23T01:19:17.341714+00:00。Compute已升级0.2.0，共26项操作（原23项保留，新增3项）；当前共12包启用、86项能力操作、6项View定位操作。

新增：表格转JSON、表格转CSV、表格筛选与排序。复用独立版zi-data-core的Dataset::parse/view/export，不依赖ZiDevTools.exe，不读写文件。将原先整体标记“等待Host”的data工具中已可独立交付的粘贴数据子范围先导入；文件读取/保存、后台流水线与原生完整工作台仍单独跟进。

## 使用

Studio左侧“工具”→“具体工具”，搜索“表格转JSON”“表格转CSV”或“表格筛选与排序”。text粘贴CSV、TSV或JSON；options填写JSON参数。结果外层报告含inputRows、selectedRows、columns、format，text字段是可复制的转换结果。

例如text填：

```csv
id,name
1,Alice
2,Bob
3,ALICE
```

选择“表格筛选与排序”，options填：

```json
{"format":"csv","query":"alice","sort":"id","descending":true,"output":"json"}
```

返回第3、1行。format支持csv、tsv、json；query在所有列中匹配，忽略大小写；sort填已有列名，descending为布尔值。JSON数值按数值排序；CSV/TSV保持字符串，数字文本采用文本排序，不擅自转换类型。JSON输出保留null、布尔值、嵌套值；CSV/TSV使用原生共享导出算法处理引号、分隔符与换行。

转JSON/转CSV操作只需 `{"format":"csv"}` 或 `{"format":"json"}`，可追加query/sort/descending；output仅用于“表格筛选与排序”，支持json、csv、tsv。筛选无匹配时导出空结果及0行报告；未指定列名、重复表头、非法JSON/参数被拒绝。原输入不修改。

## 证据与边界

真实当前Studio Host/生产Worker：新增31个正反例全部通过；原有23操作各1个固定正例回归通过，合计54例，另6项安装/目录/授权/字段/启停/字节校验通过。包内100个原生向量全部运行，前69个与0.1.0冻结预期完全一致；本次未把旧69个Host正反例全部重跑，旧验收证据保留。

真实React前端通过工具中心搜索、打开表格筛选表单、填写两字段、点击执行并显示实际筛选/排序结果。适配器3项测试、选定包格式检查/严格Clippy、原生适配器和WASI构建通过；未重复完整独立版或Studio构建，未结束旧ZiDevTools实例。

text最多8192 UTF-8字节、options最多16384字节，请求/结果48KiB，沿用5秒/10M fuel/64MiB预算；复杂输入或膨胀结果可被预算拒绝。仅显式粘贴数据计算与可复制结果；文件选择/保存、撤销、后台工作流及大数据集未在本次交付。签名、其他平台、原生computer use均不作为阻挡。

逐项账本现46/154个源ID有部分操作映射，108个尚无映射；不等同46个完整工具验收。后续优先现有Host资源接收下可交付的资源子范围，再处理必需的版本化Host接口。两项目保持独立，冻结旧候选及失败证据均保留。

普通脚本重启确认：12包启用、Compute 0.2.0持久化、Studio窗口响应且9227临时调试接口关闭，见devtools-tables-normal-startup.json。构建后预算扫描UnknownEntries均为0，未超预算，未删除缓存。

排序精度说明：JSON数值排序继承原生f64比较；超过2^53的大整数不保证精确次序，格式转换本身仍保留JSON整数值。
