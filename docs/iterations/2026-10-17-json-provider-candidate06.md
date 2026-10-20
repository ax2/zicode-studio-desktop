# Stage：独立 JSON 对象插件的 Host/Worker/Pi 接收

日期：2026-10-17。仅修改 Studio；DevTools 在原会话构建候选。此阶段验证 [`result.json.v1`](../plugins/result-json-profile.md) 的真实独立提供方，不能把它计为 DevTools 全部 154 项完成。

## 接收与发现

提供方 `json-object-0.1.0-candidate-06` 为无签名目录。Studio 对外部收据逐项核对路径、大小和 SHA-256：37 个文件、328,768 逻辑字节，收据 SHA-256 `51599cd787f007e4fbd4b6eeed8d669fa6ef1fef7598a2c3713752db4695ffe7`。目录索引编码信息不足，验证器报告 `encoding-unverified`；逐文件校验通过，不等于签名验证。已将原样目录和外部收据冻结为 `tests/fixtures/devtools-json-object-candidate06/` 与同名 `.verification.json`，副本再次逐文件匹配。清单声明 `output.schema.v1@=1.0.0-rc.1`、`result.json.v1@=1.0.0-preview.1`，两个 WASI 能力是 `devtools.json.object.inspect` 和 `devtools.json.object.receive`；Pi 仅注册摘要能力。只读 profile 提示无缺项。

最初 candidate-05 诊断依次暴露三个真实集成缺口：Studio 输入 schema 拒绝 `maxProperties`；输出 schema 拒绝 `maxProperties` 和 schema 形式的 `additionalProperties`；确认转交后的第二个 JSON 结果仍被按文本捕获。Studio 在通用输入/输出 schema 中加入有界 `minProperties`/`maxProperties`，输出对额外属性按声明 schema 逐项校验，并使转交后的结果捕获复用目标能力的 `resultCaptureMimeType`。候选目录字节未修改。最早的 candidate-04 输出 schema 缺 Worker 的 `contractVersion`、`error` 字段，因此没有作为最终候选安装。

## 验证

- 冻结 candidate-06 的真实 Host HTTP + WASI Worker 定向测试 1/1 通过：源工具返回对象和 schema 2 `application/json` 引用；接收目标搜索提供 `value` 对象字段；准备预览保持 MIME；未确认提交为 HTTP 409；明确确认后接收 Worker 执行，`receivedValue` 与源 `data` 逐值相等，第二个结果再次得到 schema 2 引用；保存预览、明确确认及成果内容均为 JSON 对象。测试成功后只清理由本测试创建的 scratch。
- 嵌入 Pi 1.3.0 + 实际 broker + 当前 Debug Worker 定向测试 1/1 通过：未授予 `pi.tools.register` 时不注册提供方工具；授权后搜索目录、按需加载 `devtools_json_object_inspect`、动态调用并取得 JSON schema 2 结果引用；撤权后旧工具调用被拒。此为测试驱动的工具调用，不证明模型自主选用。
- 既有真实 Text→Text 跨包转交回归 1/1 通过，确认按目标能力 MIME 捕获的修正保留文本路径。
- 新增对象属性上下界与输出 map 约束单元测试各 1/1 通过。`bun run check:rust:static` 通过 Cargo check 和严格 Clippy；仓库级格式漂移仍为 advisory。`bun run build:local` 成功，复用同一 `target/debug`，该阶段 EXE SHA-256 `7E4AE615440D596AFF7837F75A98D77C25F62C729FDEAF20F14ECB0220CE6E0F`；后续本地构建见[通用表单阶段](2026-10-17-json-object-generic-form.md)。不改应用版本或生成 ZIP。
- 只读空间扫描前后：`target` 30,021,592,595 → 30,021,869,218 B；非 scratch `.cache` 保持 355,458,670 B；task-scratch 1,177,327,887 → 1,178,282,095 B；未知条目均为 0。E 卷可用 12,738,252,800 → 12,723,879,936 B；其他会话在同卷活动，卷级差值不能全部归于本阶段。容量提示仅是 advisory，没有删除构建缓存。

前两次 Host 诊断和之后两个断言失败共留下四个本阶段 scratch 目录，分别为 `json-provider-host-4d7f0784-20e3-475a-98ca-01fbdc05a811`、`json-provider-host-2d2afeaf-6b08-4392-9813-b0681e181390`（各 6 文件、73,873 B）及 `json-provider-host-8808a374-f668-410f-acc6-0a8a4b3e83b5`、`json-provider-host-8f5758c7-2981-4cda-b912-a261c7fbc88c`（各 45 文件、403,231 B）。已读 owner 并核对它们位于本项目 `.cache/task-scratch/`；精确清理命令在执行前再次被自动策略以 `blocked by policy` 拒绝，实际删除 0 B。不得换方式重试；这四项列为人工清理候选，成功测试的 scratch 已由测试自身清理。

## 边界

这份目录无签名。经用户即时同意，现已在新隔离验收配置中通过 Studio 原生界面安装：`--isolated-profile E:\zicode-studio-desktop\.cache\task-scratch\json-object-native-2026-10-17-fe0b9f15f6434619a93b8bd2d594cd7c\profile --tools-only`。界面先显示候选为 JSON Object 0.1.0、2 个工具、`pi.tools.register` 权限及默认禁用说明，点击“安装已核对插件”后提示 `已安装 com.zicode.devtools.json-object`，插件管理数目从 19/19 增至 20/20。原生截图已现场检查，尚未留存为独立图片文件。隔离 profile 中安装副本与冻结候选逐相对路径、字节数、SHA-256 比较：37/37 文件一致、328,768 B、差异 0。界面当前仍显示插件“已禁用”及 `pi.tools.register`“已拒绝”；已请求用户在界面中手动启用及授权，未替用户操作安全开关。

安装验证不等于工具执行验收。真实桌面对象结果、保存与转交、用户界面确认、macOS/Linux、模型自主调用、更多失败/取消/超限场景及正式签名仍待。DevTools 154 项正式完整接受仍 0/154，ZiFile 108 项仍 0/108。
后续 Studio 工具表单发现并修复对 Host 对象属性界限的漏识别；参见[JSON 对象通用表单阶段](2026-10-17-json-object-generic-form.md)。新 EXE 原生执行仍待，不改变本记录的 Host/Worker/Pi 证据范围或 0/154 完整接受数。
