# Stage：显式 JSON 对象结果接力候选

日期：2026-10-17。范围仅为 Studio；保留其他未提交工作，未修改 DevTools/ZiFile。

## 目标与发现

已有结果暂存、发送和保存只接受成功结果的 `data.text`，接收端仅搜索顶层 string 字段。将对象转成文本会丢失类型及接收方 schema 意义。当前真实 DevTools 包没有独立声明 JSON 结果捕获，故先提供版本化 Host 扩展，不改冻结候选。

## 修改与决策

- 新增精确协商 `result.json.v1 =1.0.0-preview.1`，能力级 `resultCaptureMimeType: application/json` 须同时有 `output.schema.v1`、`outputSchema` 和 WASI runtime。缺项、无效 MIME、非对象成功数据由 Host 拒绝捕获；旧能力继续按文本 v1。
- Host 对有效对象生成 schemaVersion 2 / application/json 引用，保留对象和有界序列化文本。可信父界面可预览 JSON，用户确认后保存为对象内容的 JSON 成果；只向 schema 接受对象字段的 WASI 目标列出转交映射，提交时再次校验及执行。工作区、来源证明、权限、版本、grant、超时、取消和只读回执逻辑沿用原路径。
- Pi `details.studioResult`、聊天卡片与工具中心接受成对的 v1/text 或 v2/json 引用；错误版本/MIME 组合不获得操作入口。插件 iframe 仍看不到引用、桌面令牌和其他工具目录。
- 提供方接口、数据预算和负面验收见[结构化结果协议](../plugins/result-json-profile.md)。Studio 只读预检可提示遗漏 profile；需求已送达原 DevTools 开发会话，提供方继续独立构建。

## 验证证据

- `bun run check:rust:static` 退出 0：Cargo check、Clippy 通过；cargo fmt 仅报告全仓格式漂移 advisory，未批量改写其他工作。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --bin zicode-studio-desktop json_`：8/8，通过捕获预算、对象字段映射、profile 拒绝及既有 JSON 专项。首个单独捕获测试也 1/1。
- `bun run vitest run public/native/plugins/plugin-result-actions.test.js public/native/plugins/chat-plugin-result-actions.test.js public/native/plugins/plugin-result-transfer.test.js frontend/src/features/chat/chat.test.tsx`：初轮 70/70，补充聊天 JSON 正反例后该文件 26/26，总计 71 项相关前端用例。Pi 引用与 manifest 快速提示额外 7/7。
- `bun run check`、`bun run typecheck`、相关 `git diff --check` 退出 0。全仓 Biome 仍有 147 warning/10 info，设计检查报告既有生成文件 inline style 提示。
- `bun run build:local` 退出 0，复用 `target/debug`，未生成 installer。EXE SHA-256 `75159894C5D3FA68F34CCCD45F78808945A7D7EE24FE66FD473755E3C148E8E0`，125,150,720 B；运行目录 `public/native/react/chat.js` 与源码生成文件 SHA-256 均为 `AD8836041242F8575AF4B39F4A759A0EE00E52D16BBA324211784FF9F95A3DF2`，`extensions/plugin-broker.mjs` 两处均为 `AAA3C5943BD85F9DCC999A11D2EE9E7AD57C863BABE5C16C6E51D602FE6BE444`。
- 没有新 DevTools JSON 提供方包，尚未执行 JSON 的真实 Host/Worker、Pi、原生 UI 及跨平台闭环。既有 802 px Studio 工具切换器截图已重新目视复核，归档路径见[已打开工具阶段](2026-10-17-opened-tool-picker.md)；它只证明旧布局可读，不证明本次 JSON UI。
- 当前 Debug EXE 又以 `--isolated-profile .cache/task-scratch/inspect-native-consent-20261017/profile --tools-only` 启动，原生 1442×931 浅色 WebView2 显示 24 个目录工具。依次只打开 Inspect 0.1.1 的 IPv4、颜色、JWT、Unicode 4 个工具（不输入或执行），第四项后实际窗口呈现单个选择器、工具目录、当前关闭按钮及表单，下拉列出 4/8 与全部四项名称/来源，未见横向滚动或遮挡。两张截图存于技术博客 `screenshots/json-result-transfer-2026-10-17/`：`four-tools-1442px.jpg` 91,755 B，SHA-256 `03225A51C8764E4A1B9744F5ACA7B448109E90F893A16824E8E6E903BA7B31FB`；`four-tools-dropdown-1442px.jpg` 18,051 B，SHA-256 `A42909F4E4907979B4135D5A523656354C5A223C52F6FC0FC566AE3E2C5C9072`。这些仅是当前构建的目录/切换布局证据，不能证明 JSON 结果。验收进程 PID 63360 已核对 EXE 和隔离参数后停止，未留子进程。
- 构建/测试前后只读空间扫描：`target` 30,015,172,507 → 30,018,773,917 B，非 scratch `.cache` 355,458,670 → 355,458,670 B，task-scratch 1,176,735,237 → 1,176,735,237 B；未知项均 0。E 卷可用 15,167,328,256 → 15,157,317,632 B，卷级变化含其他进程，不能全归本轮。预算脚本因提示门槛退出 1，未据此删除缓存。
- 原生窗口退出后的复扫：`target` 30,018,773,917 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,176,746,096 B、`site` 29,644,753 B，未知项 0；E 卷可用 15,049,957,376 B。卷级余量还受其他进程影响，未推断为 Studio 单独增长，未清理缓存。

## 遗留与交付

需等待 DevTools 提供带 profile 的独立版本包与对象输入接收能力，再逐项完成发现、加载、真实调用、目标搜索、预览、明确确认、Worker 执行、展示与 JSON 保存，并覆盖撤权、超限、失败隔离和取消。DevTools 154 项完整接受仍为 0/154；ZiFile 108 项仍为 0/108。现有本地应用版本 0.4.2 不变；本阶段仅更新现有 Debug EXE，未发布、生成 ZIP 或清理缓存。
