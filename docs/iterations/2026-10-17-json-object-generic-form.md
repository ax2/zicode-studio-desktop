# Stage：JSON 对象插件通用表单约束对齐

日期：2026-10-17。范围：仅 Studio 工具中心通用表单；不修改 DevTools 候选、插件协议、应用版本或其他未提交工作。

## 发现

经用户授权安装的冻结 `com.zicode.devtools.json-object` candidate-06 在隔离 Windows Debug 界面中可搜索到两个工具。插件保持默认“已禁用”、`pi.tools.register`“已拒绝”。打开“JSON 对象摘要”后，详情同时显示“插件已禁用”和“需要应用界面或额外的宿主支持，当前通用表单无法执行”。候选输入 `value` 为带 `maxProperties: 128` 的对象；Host 已支持 `minProperties`/`maxProperties`，但前端 `editableJsonSchema` 白名单遗漏这两个关键字，导致表单不可呈现。这是 Studio 的接入缺口，不是提供方缺少 View 或 Host 不支持该对象。

## 修改与验证

- 通用 JSON 编辑器识别 Host 已实现的对象属性上下界，并拒绝负数、非整数及上下界倒置；顶层工具输入声明也允许这两个约束。
- 禁用插件时详情直接提示到插件管理中启用；不再同时展示缺应用 UI/宿主支持的误导说明。执行按钮仍禁用，未代用户更改插件或 `pi.tools.register` 权限。
- 三个相关前端文件定向测试共 15/15 通过，覆盖 candidate-06 的嵌套对象 schema、顶层对象属性限制和禁用卡片文案；`bun run check`、`bun run typecheck`、`bun run build:react` 通过。项目级 lint 仍有 147 条既有 warning、10 条 info，检查退出码为 0。
- 为真实界面复核，`bun run build:local` 复用原有 `target/debug` 成功；Pi 1.3.0、Portable Git、WebView2 和 Bun 资源命中现有缓存，未重新下载。新 EXE SHA-256 为 `517D297ED990735A0EEE5D1B75D00D238657B1B76B63DB271FBAD2E669D9FCA2`，本地版本仍 0.4.2。用原隔离 profile 重新启动了 `--tools-only` 实例，安装副本未更改。
- 打包后的 `target/debug/public/native/react/tool-center.js` 与项目构建输出 SHA-256 同为 `E70882C3A77582F3772B393F1CFC104CE67AA56155407BE64149E4B6F18E31B1`；运行目录 `public/i18n.js` 与源码输出同为 `FE6A876E84C21D3CF77EDA04489323475791321C74DD1E9B4653A21333C69C0B`。证明新资产已复制到当前 Debug 运行目录，不证明 UI 已被目视验收。
- 旧 EXE 原生截图已现场观察到“两个工具可发现、插件已禁用、通用表单不可执行”的错误表现；新 EXE 启动后，用户按实体 Esc 中止 Computer Use，本阶段没有继续控制或获取新界面截图。因此**新表单的原生截图、实际输入、执行和对象结果转交尚未验收**。

构建前后只读空间扫描均完整、未知项 0：`target` 30,019,516,056 → 30,023,343,878 B；非 scratch `.cache` 355,458,670 B 不变；task-scratch 1,258,257,547 → 1,256,983,275 B；`site` 29,644,753 B 不变；E 卷可用 8,855,937,024 → 9,325,461,504 B。同卷其他活动与隔离 WebView 缓存并存，卷级差值不能归于本构建。没有删除可复用构建缓存或产生 ZIP。

## 遗留

待用户恢复原生界面验收并手动启用插件及授权后，需检查对象字段在工具页显示、显式输入、执行、结果展示、跨工具预览/确认/接收与失败隔离。macOS/Linux、签名发布和 DevTools 全 154 项仍未验收；完整接受数保持 0/154。
