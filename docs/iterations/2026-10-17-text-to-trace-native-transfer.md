# Stage：独立 DevTools 文本与堆栈插件的原生接力

日期：2026-10-17。仅在 Studio 的既有隔离 Windows Debug 配置复验，不修改 ZiDevTools 提供方包、源码或权限。

## 目标与原始材料

此前跨包测试有 Studio 派生身份的接收包；另一轮原生验收验证过 Trace → Text。本轮选用已分别安装、启用的 DevTools Text 0.1.0 与 Trace 0.1.0，验证反向的 Text → Trace 原生“来源执行 → 目标搜索 → 预览 → 明确确认 → 接收执行 → 结果展示”。这不是签名包验收。

当前 `target/debug/zicode-studio-desktop.exe` SHA-256 为 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`，版本仍 0.4.2；运行参数为已有 `--isolated-profile .cache/task-scratch/trace-native-20261014/profile --open-file`，未新建第二份运行时。两包安装副本对外部包外收据重新核对：Text 13/13、Trace 346/346 个路径、大小、SHA-256 均匹配，且各自与原候选逐文件一致；两包仍为无签名开发候选。第一次只读核验脚本的 PowerShell 分割正则写错并产生错误输出，不能作为证据；改为路径段分割后的完整复跑退出 0、两包 `Bad=0`。

## 原生流程与结果

在 1442×931 浅色 Windows WebView2 窗口，先取消仅文件资源工具筛选；目录显示 24 项。按需打开 `com.zicode.devtools.text/devtools.text.base64.decode`，输入只含合成 Java 堆栈的 Base64 并执行；结果精确显示两行、71 UTF-8 字节的 `java.lang.RuntimeException: synthetic` 和 `at demo.Main.run(Main.java:9)`。

点击“发送到工具”后，当前目录列出 7 个兼容文本接收能力，其中 `Java 异常链 · com.zicode.devtools.trace · 字段 text` 属另一份独立插件。选择后预览标明接收工具 0.1.0、字段 `text`、71 字节及原文；预览没有执行。明确点击“确认发送并执行”后，可信父界面显示“正在执行接收工具”，随后展示 `Studio · 接收工具处理结果`：`exceptionCount=1`、`frameCount=1`、异常类 `java.lang.RuntimeException`、消息 `synthetic`、帧 `demo.Main.run` / `Main.java:9` / `sourceLine=2`。接收结果还有保存和继续发送入口，但本轮没有点击保存或再次发送。

原生完成状态截图保存于技术博客项目 `screenshots/cross-provider-text-trace-2026-10-17/native-trace-result.png`（1442×931，74,358 B，SHA-256 `DDD6A700FF16C5743F02545373C1091F2092ED51791D95832AA37BD1DEC8A5CE`），已目视检查来源输出、接收结果与入口。没有用户个人内容、项目文件共享、文件写入或模型调用。Host 仍会记录隔离配置内的调用状态；本轮未创建用户产物。

## 验收边界和存储

这证明当前 Windows Debug 下两份独立无签名开发候选的单次反向跨包文本接力；不证明签名安装/升级/回退、源工具完整业务范围、跨系统、长时取消、故障恢复或模型自主调用。DevTools 154 项完整接受数仍为 0/154。

未编译或发布，未改版本、未生成 ZIP。只读存储复核：`target` 为 29,997,194,081 B，非 scratch `.cache` 355,458,670 B、site 29,644,753 B，未知项 0；task-scratch 1,136,635,693 B，比上一阶段末尾的 1,136,605,670 B 多 30,023 B，为复用隔离配置期间的变化。E 盘可用 30,225,461,248 B；卷余量变化不能完全归因于本轮。没有按固定容量门槛删除缓存。
