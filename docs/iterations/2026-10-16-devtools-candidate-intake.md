# DevTools 候选接入复核（2026-10-16）

## 当前证据

Studio 对 DevTools release/plugin-candidates 只读检查，未复制、安装、运行或修改提供方文件：

- 候选目录下当前没有任何 .zicode-plugin 容器。
- image-resize-0.1.1-candidate-02 的收据标记 unsigned-provider-candidate、studioReceiptVerified=false、nativeStudioEndToEnd=pending、signature.signed=false，packageSha256=null。清单来源为 image-workflow 0.11.0 的单图缩放子集，需要与 Studio 已实现的 resource.wasi.image.resize.v1 预览profile继续验收。
- spring-actuator-0.1.1-candidate-02 是 unsigned provider review directory，taskProfileDeclared=false，只声明 service.http.get.v1；生命周期接口的提案和 schemas 不等于 Studio 已实现或清单可声明。
- diagnostics-0.1.3-candidate-01 明确标记 diagnostics.compute.wasi.v1.proposal 尚未被 Host 接受。
- Studio 的全量清单仍为 154 项、accepted=0；候选目录、提供方验证报告和 Studio 对其自身 WASM/Host 的既有局部验证，不能相互替代。

## 已反馈事项

根据本次收据核对，已向用户授权的 DevTools 原会话发送具体后续要求：先完成其正在进行的 Release/截图工作；之后对使用现有 Studio profile 的图片缩放能力交付由授权发布者签署的 .zicode-plugin、逐文件及容器摘要、源版本/修订和可复现验证收据；不得向 Studio 发送私钥或签名凭据。Actuator 任务生命周期在 Studio 发布对应 Host profile 前不得声明为可用；若签名或收据缺失，应明确列出缺项及责任方。Studio 不会修改或复制 DevTools 文件。

截至复核时，原会话的 cargo build --release 已退出码 0 完成（369,580 ms）；其后通过 DevTools 自有维护脚本清理了 target/debug/examples 生成文件，保留源码与 release 产物。当前候选根仍有 6 个目录、6 份旧收据、0 个 .zicode-plugin；最新收据仍为 11:28 的 spring-actuator candidate-01。收到后续状态：原会话已结束版本历史搜索任务并启动独立的插件互通复核，最新进度明确表示正在对照 image-resize 候选与 Studio 接受合同。复核时 release 下仍无 .zicode-plugin，最近的文件/收据时间仍为 11:28；目前属于提供方审查中的进展，尚非交付或协议接受。Studio 不修改候选内容，待其完成后重新逐文件核验。

## 插件数量增长的导航现状

只读查看 Studio 源码：左侧活动栏由固定的 PRIMARY_ACTIVITY_IDS 列表控制，当前包含 Chat、Projects、Tasks、Notes、Tools、Automation 六个入口；插件枚举通过 applicationDirectory 聚合到 Tools，按元数据分类并提供搜索入口，枚举不加载 View 或执行 capability。此证据说明插件不会按数量逐个增加左侧图标。它是源码检查，未在本轮重新截取实际窗口；搜索/收藏/最近/动态调用的既有工作台实现仍需单独做完整原生验收。

## 验证和未完成项

- 检查候选收据字段、插件清单及候选目录文件；候选根中 .zicode-plugin 数量为 0。
- 未运行候选代码、Studio 构建或测试；没有把这次接收审查计入矩阵。
- 未改动 Studio 的既有未提交工作。
- 下一关：取得可安装候选；由 Studio 独立验证包收据与文件集合，再完成实际 Studio / Pi / Host / Worker / View 流程及每个目标 OS 的验收。总范围继续是 DevTools 全部 154 项。

## 2026-10-17 协议交付跟进

重新只读搜索 `E:\zi-devtools\release\plugin-candidates`，仍无 `.zicode-plugin` 文件。原 DevTools 会话目前在推进其独立程序的结构化表格接力和目录差异复制；这些功能进展不构成 Studio 插件包交付。已按用户此前授权向该原会话再次发送具体接口需求：在保持独立程序的同时提供签名 `.zicode-plugin`、逐文件 SHA 收据、源版本和平台信息；按各能力实际字段声明所需 profile，尤其修正 **URL 文本资源 candidate-02** 缺少 `tool.directory.v1` 与 `output.schema.v1` 的问题；无法迁移项按工具 ID、原因和重开条件入矩阵。请求其完成后在原会话报送包路径与证据，Studio 再独立做安装到执行的真实验收。本轮没有修改、复制或运行 DevTools 文件；正式接受仍 0/154。

后续跟进：Studio 图片缩放 profile 已按能力声明而非固定 DevTools ID 准入，只读 manifest 预检现会提示 `executionProfile` 与其图片输出依赖缺项。已把这两项变化及 URL candidate-02 的准确缺失字段发送原 DevTools 会话，并再次要求签名包、包外收据、冻结154项映射和平台矩阵。发送后对 `release/plugin-candidates` 只读搜索仍为0个 `.zicode-plugin`；这只是交付请求，非提供方接受或工具验收。


