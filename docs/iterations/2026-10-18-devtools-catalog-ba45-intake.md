# ZiDevTools ba45 目录修订接收（2026-10-18）

## 目标与来源

Studio 只读接收 ZiDevTools 原会话交付的 `devtools-catalog-2026-10-18-ba45d264d48bf094`，核对全部 154 个源工具的新版候选映射。Studio 不修改提供方源码，也不把候选映射当作完整工具接受。

## 冻结与验证

提供方原目录及 Studio 冻结副本均通过 `verify-devtools-catalog-revision.mjs`：15 文件、2,344,893 逻辑字节、目录索引 SHA-256 `663068653cac38ed6593a678c66fc09317f317f46965e8fd6f8a706969a87422`，修订 SHA-256 `ba45d264d48bf09436b0e08dfa8f7bbb59eff96090a0c01d17061b2cf75391f7`。冻结在 `tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/`，包外收据单独保存。提供方原目录的十包审计通过：身份、逐文件收据、目录索引、清单 profile、映射与实际声明均匹配，无未解析操作。

接收方未重复复制旧九包运行目录：其中七份的包外收据与上一冻结修订完全相同，复用既有不可变包字节；新增 Agent Assist 0.1.3、Spring Actuator 0.1.3 与 Image Resize 0.2.0 分别冻结并验证。`verify-devtools-ba45-bundle.mjs` 在 Studio 本地对十份包逐文件重验，退出 0；开发平台检查已将其作为 Rust 全量用例之前的非建议级门槛。`developer-platform-checks.test.js` 9/9，`bun run check` 退出 0；项目检查仍报告其他未提交文件的建议级 lint 和设计警告。

| 本修订指标 | 结果 |
| --- | ---: |
| 源工具 ID | 154 |
| 已有候选包操作映射的源 ID | 34 |
| 尚无候选包操作映射的源 ID | 120 |
| 无签名候选包 | 10 |
| capability 操作 | 55 |
| View 定位操作 | 6 |
| 完整工具正式接受 | 0/154 |

相对上一 `9c17...` 修订，候选包增加 Image Resize 0.2.0，`image-workflow` 对应一项缩放 capability；它只覆盖该源工具的局部功能，不能据此判定完整 Image Workflow 已接入。其余新增的两份 0.1.3 包把 Agent Assist 和 Spring Actuator 的六项 View 定位入口提升到包内精确 profile 声明。完整[154 项逐项缺口](../plugins/devtools-catalog-revision-gaps-devtools-catalog-2026-10-18-ba45d264d48bf094.md)从冻结字节生成，记录各项未覆盖范围、责任方和重开条件。

## Image Resize 0.2.0 真实 Host/WASI 续验

Studio 现有隔离真实 HTTP 用例增加可选候选目录，保留旧 0.1.1 默认路径。新 0.2.0 清单将 `maxWidth`、`quality` 从字符串改为整数；用例按各自清单提交输入。初次测试因此在调用前得到 `409 invalid_parameters`。随后 4×2 PNG 经新候选缩为 2×1 PNG，尺寸、资源字节读回和 SHA-256 均匹配。第一次接力因 Studio 自建接收夹具缺 `resource.input.types.v1` 与 `image/png` 声明而得到 `409 resource_input_type_unsupported`；补齐明确类型后，未确认接力被拒、确认后独立 WASI 接收插件成功读取，内建图片检查器也确认 PNG 与尺寸。损坏图片返回 `INVALID_IMAGE` 且不生成资源，之后相邻接收工具仍成功。新 0.2.0 与默认旧 0.1.1 分别单项 1/1 通过。三个诊断阶段均未更改提供方冻结包。

开发平台检查加入 `devtools-image-020-host-worker` 非建议级门槛，要求当前 Debug Worker 和冻结 0.2.0 包运行该隔离用例。该结果证明本机当前源码 Host/Worker 的图片缩放、派生资源和确认接力机制；不证明完整 `image-workflow`、原生新包界面、正式签名或其他平台已通过。

三轮失败诊断留下本轮自有的四个 `.cache/task-scratch/host-image-resize-*` 目录，各约 1.17 MB、合计 4,661,960 逻辑字节。已核对四个目录的 owner、创建时间、路径和总量，并记录全部失败原因；对这四个精确目录的清理被自动审批策略以 `blocked by policy` 拒绝，**未删除，也不改用其他手段重试**。手工候选仅为下列完整路径，历史同名前缀目录、Cargo 缓存、Debug EXE 和冻结包不得连带清理：

- `E:\zicode-studio-desktop\.cache\task-scratch\host-image-resize-2445a38d-5a71-4ab7-bd19-b17fa0141c2f`
- `E:\zicode-studio-desktop\.cache\task-scratch\host-image-resize-26a600ae-81b6-4dba-a8a9-5a68158845a5`
- `E:\zicode-studio-desktop\.cache\task-scratch\host-image-resize-8fcef762-b698-44ac-8b0f-e8895d1aa505`
- `E:\zicode-studio-desktop\.cache\task-scratch\host-image-resize-ed2dcd2d-773d-4b01-9d3e-a64195bb606e`

本轮前后只读空间扫描：`target` 22,554,873,857 → 22,554,936,833 逻辑字节；task scratch 2,699,571,720 → 2,704,233,680（增加量恰为上述四目录的 4,661,960 字节）；E: 空闲 63,108,325,376 → 63,098,515,456。卷空闲差额不全部归因于此测试。`bun run check:rust:static` 的 Cargo check 与 Clippy 通过，fmt 仍提示建议级格式漂移；`git diff --check` 退出 0。未清理旧缓存、未生成 ZIP、未改变本地版本号。

## 边界与后续

十包仍未签名；目录与包的收据匹配、清单准入和隔离 Host 目录发现均不证明真实原生定位、网络/模型执行、所有源工具功能或跨平台完整流程。JSON Object 插件依用户决定保持禁用。Studio 原生安装与启用等待单独确认；此前只完成隔离 Host HTTP 的 2/4 项 View 发现，未改用户配置。DevTools 全量目标及接受数维持 **0/154**，版本号仍为本地开发版 0.4.2；未发布新版本或生成 ZIP。
