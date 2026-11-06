# 2026-10-26 Windows UUID v4 完整源范围交付

当前Studio工具页搜索“UUID”，打开“生成 UUID v4”，点击执行即可得到一个小写带连字符的随机UUID。无需输入参数，打开不自动生成，已有结果可选中并用系统快捷键复制，切换页面后仍保留。独立包0.1.0候选01已启用，来源工具1.0.2；原生主要生成入口也已改为显式处理随机源失败，但旧用户主EXE未替换，不宣称其部署已更新。

当前Windows Studio完整源范围：每次明确执行生成一个随机UUIDv4，无输入参数。共享纯Rust格式/安全随机核心，WASI random_get与当前Host默认安全RNG；不接受种子、数量或字节，失败不生成替代结果。

## 完整源范围审计

本工具原始完整源scope是“生成随机UUIDv4”，没有文件、批量、种子、其他UUID版本或系统设置范围。本批覆盖了该完整范围及当前源版本的失败处理，没有把别的复杂工具缩小后宣称完整。

| 要求 | 当前证据 |
| --- | --- |
| 每次明确执行生成一个UUID，无参数 | 32项实际Host生成、6次真实界面执行；打开自动执行0；7项额外参数/非对象输入拒绝 |
| 规范v4格式和版本/variant位 | 19个实际原生/Studio Worker/Python固定向量；128个独立位保留断言；38个真实输出经Python uuid解析 |
| 安全随机路径，无调用者种子或失败回退 | 生产模块random_get导入、当前Host固定Wasmtime-WASI36.0.12默认安全RNG源码；共享核心/适配器故障注入 |
| 当前Windows可发现、执行和选择结果 | 1000×700/640×600/480×640真实鼠标，6次执行、选择0..36、导航保留、无遮罩 |
| 安装/授权身份/禁用恢复/冻结字节 | 4项真实集成；8文件安装收据匹配；验收example不在包内 |
| 普通启动可用且保留原数据 | 17包持久启用、UUID0.1.0、9227关闭、两原笔记ID和26文件校验一致 |

因此 `fullSourceScopeAccepted=true`，目标明确为 **当前Windows Studio手动工具**。可选Pi注册未授权/调用；模型、其他平台和正式签名另记，不用它们阻挡本机完整源功能。整体全部工具目标仍未完成。

## 随机与确定性验证的区别

`zi-uuid-core`共享生成和格式函数：getrandom填充16字节，uuid::Builder只设置版本与variant。原生使用系统随机源；WASI使用Preview1 random_get，当前Host未重写默认安全RNG，其实际固定依赖源码按上下文从宿主随机源初始化。没有时间/计数器/固定种子替代，发生熵源错误返回错误而不是输出UUID。

规范依据：[RFC9562 §5.4](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.4)；默认RNG语义参见[Wasmtime官方API](https://docs.wasmtime.dev/api/wasmtime_wasi/struct.WasiCtxBuilder.html#method.secure_random)。官方在线API可能高于本机版本，本批另逐项核对了本机固定36.0.12源码、SHA和生产WASM导入，未假定最新版行为。

新随机UUID不应要求原生/WASI文本相同。为验证共享位处理，独立 `uuid_vectors` example用RFC、全0/全FF及每字节置FF的19固定向量，经真实安装Studio的 `--zicode-plugin-worker` 执行WASI，与原生验收适配器完整结果及独立Python UUID版本化构造一致。该固定输入模块不是生产生成器，也未打入8文件包。它证明格式算法，不能代替Host身份/安装或生产随机源验证，后者另有实际验收。

核心5项与适配器3项通过：包括全部128个输入位、失败不输出、严格信封/重复属性/大小限制、无效输入不请求熵源。生产模块的32次Host生成与6次界面输出为规范v4且本批无重复、未重放包内原生样例；只陈述本批观察，不宣称随机性认证或绝对零碰撞。没有人为关闭系统RNG；故障路径使用核心与适配器边界注入验证。

## 构建、验收及保留失败

新增两包严格Clippy、全仓fmt、原生fixture release和WASI构建通过，原生ToolState与主要界面代码编译及新增回归通过。全原生1148通过、33忽略，仍仅原 `artifact_hub::tests::library_symlinks_are_rejected` 因Windows权限1314失败；未跳过或弱化该安全测试。全仓严格Clippy85项既有错误仍在，新包严格通过；不以该基线问题阻挡本机UUID交付，不强制结束旧用户EXE。

真实Host39项=32生产Worker生成+7Host前置拒绝，另4集成通过。新生产WASM125296字节，8文件，原5秒/10M fuel/64MiB预算未改，请求48KiB/结果1024字节，无文件/网络/进程/持久化、模型或任务操作。真实界面无参数、不自动生成、连续6次、结果选择/导航保留及三种窗口尺寸均通过，运行异常0。Browser插件未提供，复用真实Windows WebView2 CDP，不宣称物理OS外框/手机/其他平台。

原生主EXE不重复替换；仅新适配器/验收example与插件构建，Studio前端与Rust无修改/无重建。`scripts/package_uuid_plugin.py --verify-only`只读核验冻结01；新构建使用新候选编号。`scripts/verify_uuid_vectors.py --worker-exe <用户实际Studio EXE> --output <收据>`只做独立格式对照，不依赖兄弟源码或数据。

## 统计更新

17包启用、94项能力、7个View定位。154源工具中：**当前Windows完整接受1（UUID）、部分映射50、无映射103**；总映射51。以前“部分映射”包含所有有映射条目是因为完整接受为0；现在分开统计，避免把完整接受工具仍称部分。其余包本轮只刷新目录并沿用历史证据，没有伪称全部重测。

提供方迁移表的acceptedCapabilities改为由完整源接受元数据推导，当前1，明确target=current_windows_studio_manual_tool；并列acceptedSourceToolIds，而非长期写死0。Studio新增完整154行当前Windows JSON矩阵，历史2026-10-09矩阵正文保留并明确标为历史。

普通启动PID488，单实例响应、9227关闭，UUID0.1.0和17包持久启用，原托盘4收藏+管理入口保留。两个工作区原笔记各1篇/ID吻合，26原文件SHA一致、登记/固定位置不变、SQLite integrity=ok；原笔记目录和备份保留。无凭据复制、模型请求、发布或定时任务。

证据：本会话outputs/devtools-uuid-*及 `D:\work\logs\zicode-local-setup\devtools-uuid-2026-10-26`，完整源审计为devtools-uuid-completion-audit.json。大编排文件tools.rs/app.rs只做少量接线，算法、适配器和新增测试独立。
