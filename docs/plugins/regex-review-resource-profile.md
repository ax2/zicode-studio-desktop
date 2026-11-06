# 正则匹配与替换：资源复核契约 1.0.0-preview.1

Host profile：`resource.wasi.regex.review.v1@=1.0.0-preview.1`。这是新契约；旧 `resource.wasi.regex.replace.v1` 与冻结插件不变。还需精确协商 resource.input.types.v1、resource.output.types.v1、tool.directory.v1 的 preview.1 及 output.schema.v1 rc.1。schemaVersion2、resource.read、WASI input.draft2/output.draft1；不得与旧正则 profile 同时声明。

在工具目录搜索“正则匹配与替换”（旧别名“正则替换预览”保留）。粘贴原文与替换模板后点击“确认提供文本”，或明确选择并确认两个UTF-8文本文件。固定顺序0=原文（最多2MiB）、1=模板（最多64KiB），均可为空；变更输入或顺序需再次确认。打开、编辑、确认提供都不自动执行，也不修改原文件。草稿只在当前挂载的工具内保留，不承诺关闭或重启持久化。

显式选择操作“Match details”（匹配明细）或“Replacement preview”（替换结果预览），填写最多4096 UTF-8字节正则。查看匹配编号从1开始，1..1000；捕获组0表示整条匹配，0..2048。省略编号默认1/0，显式非法值、null、重复键、未知字段拒绝。

匹配明细给出全部最多1000条匹配的UTF-8字节位置（从0开始，半开区间），以及所选匹配全部捕获组编号、名称、位置与是否参与。完整所选匹配和捕获组作为0/1两个text/plain派生资源，每项最多2MiB，总共最多4MiB；元数据 resourceLabels 分别为 Matched text、Captured text。未参与的已知组有空资源并明确状态；不存在的组不替换成其他组。不存在的匹配不输出资源，明确提示调整编号。超出1000匹配整体拒绝，不截断或返回部分列表。

复核后需另行切换操作并显式执行替换，输出一个最多2MiB的text/plain资源，标签Replacement result。支持$0、$1、${name}与$$，未知或未参与组展开为空字符串；空模板删除匹配。Rust regex语义，不支持环视与回溯引用。大小限制以UTF-8字节为准。示例：(?P<name>\p{L}+)-(\d+)、原文“甲-7🙂乙-42”、模板“${name}:$2”，替换结果“甲:7🙂乙:42”。

计算预算保持1,000,000,000 fuel、10秒，guest ceiling256MiB、生产模块64MiB、2MiB栈。与旧正则/图片重型资源池共享全局2、单插件1及512MiB保留额度；普通计算仍10M fuel/5秒。复杂正则仍可能达到预算并显式失败，不缩小模式/原文范围、不自动重试、不提高冻结预算。元数据JSON上限256KiB，摘要上限224KiB；失败只能公开INVALID_INPUT/INPUT_TOO_LARGE与固定消息，不发布部分资源。

父界面分别命名完整资源，只读预览可全选2MiB文本。文字不会作为HTML执行。保存、发送到其他工具需另行确认，当前保存/接力接口的容量限制独立，不代表完整预览被截断。资源授权被撤销或失效会清除复制到预览的内容。

两仓库独立：纯Rust核心与本仓原生适配器/WASI共享，生产包只含WASI，无兄弟源码依赖、共享数据库、EXE代办或HTTP绕过。unsigned本机候选不是签名或其他平台通过。完整验收范围与未完成项由交付证据另行记录。
