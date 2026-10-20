# Stage：资源输出接力目录取消过期搜索

日期：2026-10-17。目标是在跨工具结果接力中保持百项提供方目录可控，防止来源、分类、收藏/最近、分页或查询变化后旧搜索继续占用连接。

## 当前状态与修改

先核对当前源码：接力弹窗已有 MIME 过滤、来源/分类选择、收藏/最近及分页；旧阶段记录所述缺口已被后续工作补齐。剩余问题是它仅用请求序号忽略迟到响应，未取消在途请求。现沿用 Studio 通用 `PluginCapabilityGateway.searchTools(..., signal)`，每次新搜索中止前一请求；输入变化和弹窗关闭也中止在途搜索。请求序号仍阻止迟到结果写入。执行、授权确认、保存与接收工具的详情验证未改变。

## 验证边界

- `bun run vitest run public/native/plugins/plugin-resource-transfer.test.js public/native/plugins/plugin-capability-gateway.test.js`：2 文件、48 项通过；补充关闭弹窗时取消旧信号后，接力文件 20/20 通过。
- `bun run check` 退出 0；现有 147 warning、10 info 与 1 项生成文件设计提示仍在，设计检查及 Pi SDK 对齐通过。
- 本次没有修改弹窗结构、标签、样式或布局；重新目视检查了技术博客现有 `screenshots/host-resource-ocr-2026-10-16/text-receiver-empty-windows.jpg`，它仅是旧版界面参考，不能证明本次时序行为。没有运行新的原生接力流程或生成新截图。

在途请求取消由自动化测试证明；真实慢 Host 的连接回收、当前版本弹窗视觉、macOS/Linux 原生体验和正式提供方实包仍待验收。DevTools 完整接受 0/154，ZiFile 0/108。未改应用版本或构建新的 EXE、Release/ZIP。

## 磁盘

本轮检查前后只读扫描未知项均为 0：`target` 均为 30,010,795,065 B、非 scratch `.cache` 均为 355,458,670 B、task scratch 均为 1,136,649,588 B；E 可用 15,847,448,576 → 15,844,626,432 B，卷余量变化不能归因于本轮。扫描仅因既有容量建议退出 1，没有据此清理缓存。
