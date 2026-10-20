# Stage：插件清单缺失 profile 的一次性诊断

日期：2026-10-17。目标是让 Studio 在接收包含上百项能力的独立插件时，一次报告通用 `requiredProfiles` 缺项，避免提供方根据首次安装错误逐轮猜测。只改 Studio Host 校验与阶段记录；不修改 Zi DevTools 源码或冻结候选。

## 修改

`plugin_registry::validate_manifest` 先验证引擎与 profile，再验证文件/资源输入声明。`profile_compatibility::validate` 在既有声明版本校验后，遍历能力的 `directory`、`fileInput`、`resourceInputMimeTypes`、`outputSchema`、`maxResultBytes`，把缺少的 profile 名称去重并按固定顺序合并为一条有界错误。能力字段与 profile 的原有严格校验继续执行；缺项并没有被自动补齐、忽略或降级。

冻结 URL 文本资源 candidate-02 的原始 `plugin.json` 现在直接得到：`Missing requiredProfiles declarations: output.schema.v1, tool.directory.v1`。提供方仍需签发新候选及新收据；本次不更改其 92 个文件。修正两项声明的 Studio 自有合成清单可以通过通用 Host 清单校验，不能把它计为提供方候选已被接纳。

## 验证

- Studio 只读收据核对：冻结目录 92/92 文件、603,424 逻辑字节与外置收据匹配；目录索引编码字段为 `encoding-unverified`，这不是签名证明。
- 定向 `profile_compatibility` 10/10，含原样候选清单两项缺失与合成清单补齐后的对照；`plugin_registry::` 61/61。
- `bun run check:rust:static` 退出 0，Cargo check 与严格 Clippy 通过；仓库整体 `cargo fmt --check` 仍有既有漂移 advisory。此文件单独 rustfmt 检查的差异位于原有 Host profile 与服务权限段；新增区域未出现在格式差异中。`git diff --check` 通过。
- 检查前只读空间扫描完整：`target` 30,000,457,531 B，非 scratch `.cache` 355,458,670 B，task-scratch 1,137,895,284 B，`site` 29,644,753 B，E 盘可用 30,150,361,088 B。复用单一 Cargo target；未生成 Release 或 ZIP。
- 检查后扫描退出 0、未知项 0：`target` 30,000,513,069 B（增加 55,538 逻辑字节），其他三棵树逻辑大小不变；E 盘可用 29,730,934,784 B。卷余量下降不能全部归因于本轮 Cargo 检查。保留的 Debug EXE SHA-256 仍为 `4CBEE626DB6ACCAFC91F7DADFD7BFA72D30679127B45B73C68CEFBF4963CFA09`，尚不含本次源码改动；没有按容量提示清理有用缓存。

## 边界

本轮是当前源码的清单预检，不是当前 Debug EXE 的原生界面安装验收。冻结 candidate-02 仍不能安装，Worker 未因此执行；它也未变为签名包。profile 版本不兼容、字段形状错误和运行权限仍由现有门槛逐项拒绝。收到提供方新包后，仍须按独立收据重新核对并完整验证发现→加载→执行→展示、显式资源转交、失败隔离、取消和其他系统。DevTools 全部 154 项完整接受数维持 0。

## 同日续验：最新 Debug 与已安装 Inspect

用户在隔离配置中手动打开 Inspect 主开关后，`registry.json` 已显示 `enabled: true`、`pi.tools.register: true`。复用同一 `target/debug` 执行 `bun run build:local`，Pi 1.3.0、PortableGit、WebView2、Bun 资源均命中现有缓存；没有发布新版本、生成 Release 或 ZIP。最新 Debug EXE SHA-256 为 `4D478579147B5BCF47BDBBC056CD63D1D53D8494EA2ACDAB7EA00B75FA996920`。

在 `--isolated-profile`、`--tools-only` 的原生 Windows 窗口中，目录显示 24 项工具，其中 Inspect 0.1.1 的 8 项可见。搜索 `NFKC` 缩小为 1 项；打开后才加载输入表单；输入 `ＡＢＣ１２３` 并执行，界面显示“工具执行成功”和结果 `ABC123`，保存与发送按钮可见但本轮没有点击。结果视口截图已直接检查：浅色 1442×931，文字、结果框和操作按钮清晰，无覆盖。此为最新 Debug 的单项真实界面复验；此前同隔离包 8/8 原生记录仍有效，但没有在最新 EXE 上重跑全部 8 项。

该复验使用已安装的 Inspect 0.1.1，不涉及 URL 文本资源 candidate-02；后者仍缺两项 profile，尚未在最新 EXE 上做原生安装错误展示，也未运行其 Worker。不能把 Inspect 的成功计为 candidate-02 或 154 项全量通过。

结束后停止本次自行启动的隔离进程。后置只读扫描退出 0、未知项 0：`target` 30,001,662,554 B（相对本次构建前 +1,149,485 B）；非 scratch `.cache` 355,458,670 B、task-scratch 1,136,594,052 B（-1,301,232 B）、`site` 29,644,753 B；E 盘可用 30,106,034,176 B。卷余量变化不等同于本项目实际回收量；没有按容量门槛删除缓存。
