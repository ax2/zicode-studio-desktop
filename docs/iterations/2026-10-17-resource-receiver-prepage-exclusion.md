# Stage：接收工具目录分页前排除输出工具自身

日期：2026-10-17。目标是让跨工具资源接力的大目录页数与真实可选项一致。接力弹窗此前在收到 Host 的 40 项分页后才剔除输出工具自身；当它位于边界页时，页面可能少一项甚至显示空页，来源/分类计数也会包含不可选项。

## 修改与协议

Studio 本机 `GET /v2/plugin-tool-directory` 新增可选成对参数 `excludePluginId`、`excludeCapabilityId`，只允许在 `resourceOnly=true` 且提供有效 `resourceMimeType` 时使用；只给一项、空值或超长值均返回 `invalid_parameters`。Host 在构建来源/分类计数和分页前剔除这一精确能力。旧客户端不传参数时保持原目录行为。可信接力弹窗传入当前输出工具身份，并保留客户端防御性排除。此参数只影响元数据发现，不授权读取、共享或执行；Host 的资源授权和执行检查不变。

## 验证

- Rust `host_resource_receiver_is_only_offered_for_explicit_resource_sharing`：1/1，通过单个内置文本接收工具的排除和无效参数检查。
- Rust `receiver_exclusion_precedes_paging_and_facets`：1/1，用 41 项同 MIME 合成接收工具验证排除后首页 40 项、总数 40、无下一页、来源与分类计数均为 40。
- `bun run check:rust:static`：Cargo all-targets check 和严格 Clippy 通过；`cargo fmt --check` 为建议项，当前仓库已有大范围格式漂移，没有批量改写其他未提交文件。
- 前端网关与接力专项：2 文件 50/50；`bun run check` 退出 0，报告现有 147 warning、10 info 及 1 项生成文件设计提示。
- `git -c core.safecrlf=false diff --check` 对相关源码退出 0。

这是 Host/前端代码与合成规模用例的证据；没有构建新 Debug EXE 或实际打开当前版本的资源接力弹窗，因此**原生接力界面、真实提供方包和其他系统仍待验收**。本轮没有样式或布局修改，也未生成新的界面截图。DevTools 154 项完整接受仍 0/154，ZiFile 108 格仍 0/108；未改版本或发布。

## 磁盘

前后只读扫描未知项均 0：`target` 30,010,795,065 → 30,011,610,106 B（新增 815,041 逻辑字节），非 scratch `.cache` 均 355,458,670 B，task scratch 均 1,136,649,588 B；E 卷可用 15,817,379,840 → 15,795,736,576 B，卷余量变化不能全归因于本轮。扫描因既有容量建议退出 1；保留可复用构建缓存，没有根据门槛删除文件。

## 后续：当前 Debug 原生接力复验（2026-10-17）

随后构建的当前 Debug 已包含本阶段 Host 排除逻辑，EXE SHA-256 为 `20F312C9797EEA6A5E47E2B1EDE04771383E8366DBAA65283F0C9FBE91C5341D`。本次复用 `host-ocr-transfer-20261016` 隔离 profile、已安装且启用的 `com.zicode.devtools.image` 0.1.1，以及已有 900×240、6,165 字节合成 PNG。安装目录和仓库候选对包外收据逐文件复核，均为 7/7 文件、1,036,667 字节，索引 SHA-256 `9934cd3eb751fac04f064c141b696d70ffdbbc0dad503c397b0ba8c77d688ecb`；收据为 `encoding-unverified`，不能据此声称编码或签名验真。本次没有安装新包、改权限或使用个人文件。

真实 Windows Studio Debug 以 `--isolated-profile`、`--open-file` 启动。工具目录发现“缩放图片”，用户可见的一次性文件授权确认后，以 WebP、最大宽度 450、质量字段 82 运行；结果 `ok: true`，900×240 → 450×120，`image/webp`、11,298 字节，本机预览且未保存。点击该资源的“发送到工具”后，接收目录只有 `Extract text from shared image · OCR · 0.1.0` 与 `Inspect image resource · Resource Inspector · 0.1.0`；来源“缩放图片”不在列表、下一页禁用。选择 OCR，先检查共享范围，再分别确认共享与运行；识别出 20 字符并生成未保存的 `text/plain`、20 字节资源。该文本资源的接收目录只列 `Inspect text resource · Text Inspector · 0.1.0`；再次独立确认共享和运行后返回 `ok: true`、`charCount: 20`、`text: "ZiCode OCR test 2026"`、`truncated: false`，与合成 PNG 一致。两层转交弹窗已关闭，隔离 Debug 进程按路径和启动参数核对后停止。

原生截图已在会话内实际目视核对：目录两候选、OCR 单候选、共享确认及最终文本检查结果可读；本次未将屏幕截图文件归档，不能算作可复查的截图证据。上述证据确认当前 Windows Debug 的这个三工具链路可用，不能推广为 DevTools 154 项完整接受、ZiFile 108 格、签名发布包、百项真实目录或 macOS/Linux 实机通过；这些仍待验收。没有保存数据或发布版本。

本次只读空间扫描前后未知项均 0：`target` 均 30,011,794,438 B，非 scratch `.cache` 均 355,458,670 B，task scratch 1,137,982,896 → 1,178,880,512 B（期间增加 40,897,616 B，未逐文件归因）；E 卷可用 15,257,731,072 → 15,260,418,048 B，卷余量变化涉及同时期其他活动，不能按逻辑字节直接推算。本次未触发编译，也没有根据容量建议删除构建缓存；扫描退出 1 仅为既有容量建议。
