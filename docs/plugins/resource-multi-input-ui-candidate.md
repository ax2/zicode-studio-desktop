# 多资源输入界面与能力声明候选

2026-10-14 Explorer 选择数量过滤：Studio 工具目录现在只向 Host 传 2–4 的 `selectedFileCount` 元数据，Host 在分页前按声明的 `resourceInputMax` 筛掉单输入或容量不足的能力。它沿用已有 `resourceOnly` 的 WASI/权限前置门禁，不读取文件，不自动加载详情或执行。取消文件筛选恢复全部目录。文件类型提示尚不支持对异构多文件组合做准确匹配，不能把数量过滤解释为格式兼容或 ZiFile 功能接受。

日期：2026-10-13。适用范围：Studio 可信工具目录和 `resource.wasi.input.draft2`。这是当前源码候选，不是正式 `resource.v1` 或 ZiFile 原生归档能力。

## 能力声明

资源 WASI 能力可在 manifest 的单个 capability 上声明 `resourceInputMax`，整数 2–4。仅同时声明 `resource.wasi.input.draft2` 的 WASI 能力可使用；缺省保持旧单资源交互与调用。Host 在 manifest 校验和每次调用准入均核对上限。插件提供方不能用页面参数提高上限。

```json
{"id":"archive.compare","runtime":"wasi","resourceInputProfile":"resource.wasi.input.draft2","resourceInputMax":2}
```

可信目录界面一次选至多声明数量的普通文件，合计最多 32 MiB。显示名称和大小；用户确认后才逐个上传为短期资源。取消或部分失败撤销已创建授权；执行按钮与文件共享确认分开。调用携带首个 `resourceId/contentVersion` 与后续有序 `additionalResources`，网关转换为 Host 的 `additionalAccesses`，所有 owner 字段从当前可信会话构造。结果中的 `derivedFromAll` 必须与输入顺序和内容版本完全相同；任一来源失效，结果及再次执行均不能继续使用。

## 边界与提供方需求

当前只适合合计 32 MiB、至多4个普通文件的纯 WASI 计算。没有目录树枚举、大文件流式读取、原生 ZiFile Worker、归档条目分页、解压目标目录授权或归档写入。提供方应在新版本包中逐能力声明实际输入数量、文件类型提示、输出类型与算法预算，并提供多输入正反例；不可修改已冻结包来追认支持。具体 18×6 ZiFile 格式操作仍按 `zifile-integration-matrix.json` 逐项验收。

## 验证状态

源码 Host + 保留的 debug Worker EXE 的实际 HTTP 双输入专项通过；前端多选、网关、输出血缘和目录执行定向 52 项通过；Rust 能力声明专项通过。浏览器本地组件预览可见两个合成文件及确认状态，但截图接口失败，未取得可审阅截图；完整 Studio EXE 界面、ZiFile 实包、其他 OS 与真实归档算法均待验。此项不改变 ZiFile 接受数 0。

2026-10-13 晚间补验：当前debug EXE在隔离Windows桌面中发现自有双文件WASI包；真实原生文件选择器选择300000B与8B两个文件，确认上传后显式执行。自有guest核对第二输入内容`second!!`后输出首文件尾部`resource`，窗口实际展示该结果。两张1442×931浅色实机截图已读，记录在技术博客对应Stage；首张揭示浏览器文件控件错误显示“未选择文件”。源码已改为选择后保留控件值、取消或失败才清空，定向3测试与本地debug构建通过。重建后的界面复查因用户Esc终止Computer Use，尚无修正后实机截图；此专项仍不代表ZiFile或DevTools算法实包验收。
