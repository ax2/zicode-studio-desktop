# 收藏分页与快捷入口

2026-10-27，北京时间。上一轮原文翻译边界已交付，本轮继续原首页/主界面/托盘快捷工具需求。广泛目标保持进行中。

## 问题与修复

快捷工具原来只读收藏目录第一页（40项），过滤停用工具后取8项。收藏较多且前面的插件停用时，后页可用收藏会消失；点击已有快捷入口也只在第一页核对。完整工具目录自己的分页已经带accessRevision，本轮检查后保留，未错误修改。

新增 `public/native/features/quick-tool-favorites.js`，按需跨页查找，投影满8项可用且不重复的工具即停止；点击入口则按同一ID查找，不能因它移到第8项以后而误判不存在。沿用Host最多512收藏的边界，最多13个真实40项页面，不提高限制。后页携带首个目录revision和收藏accessRevision，拒绝混合版本、不前进/超限游标，工作区变化或销毁后停止；失败复用已有清空菜单/重试流程。

`quick-tools.js` 仅接入该读取模块；收藏变化会取消尚未完成的旧打开请求。打开只导航，不执行工具、读取文件或创建授权。无Rust/React组件/样式/存储格式改动，无EXE或React包重复构建，重新加载实际前端后两文件SHA与源码匹配。

## 证据范围

- 红阶段10项中9失败1通过。最终6文件95项相关测试全部通过，包括512末项/13页、8项停止、重复ID、点击后排名变后、后页停用、收藏中途变化、范围变化、版本变化及原目录/快捷菜单回归。
- 当前Windows WebView2使用已有CDP（Browser plugin not available）。仅拦截收藏目录响应，构造40项停用条目在前、原始4项真实收藏在后；不改Host收藏/启用状态。旧前端只请求offset0，网页快捷项0、真实HMENU只有管理。修复后请求offset40并带正确revision/accessRevision，网页和真实托盘均恢复4原工具；实际通过托盘HMENU命令直接打开Base64编码，0次自动执行。见 `outputs/quick-pages-before.json`、`quick-pages-after.json` 和实际托盘receipt。
- 上述“40项停用在前”是响应级模拟，不声称已在用户数据库建立40个停用收藏。真实Host另单独验证：携带正确两个revision的offset40 GET返回200（现有4收藏所以为空）；缺失/过期accessRevision均409 catalog_changed。未放宽Host保护。
- 取消响应模拟后，4项收藏ID和accessRevision144完全一致；原生菜单再次恢复。640×600与1000×700客户区首页/顶部入口一致、无遮罩，截图已目视查看，不代表物理OS外框缩放或其他平台验收。
- 实际交互运行时异常0。特意发送的两个无效分页GET产生409，不能当无HTTP错误宣称。check/design/Pi对齐通过；本轮3源文件聚焦lint无告警。全仓现有159warnings/10infos与终端style advisory保留。JS模块改动未重复TS/Rust/原生构建。

保留观察问题：before托盘输出使用Windows PowerShell默认编码，JSON的中文文字乱码，但菜单数和受检查条件正确；自己的helper改显式UTF8，after/普通启动原生文字正确，未改旧失败证据。Biome JSON reporter在Windows输出未转义反斜杠导致解析失败；保留原始报告，不修改工具结果，全仓check退出0、聚焦lint无告警为验收依据。源码权限尚未取得时的一次git只读调用不能确认工作树，权限取得后实际读取成功，无reset/clean/覆盖改动。

更正上一轮翻译边界记录：其最终 `work/content-i18n-check-delivery.log` 已是159warnings/10infos，早期check153不等于最终数量；本轮未新增这6项，3个本轮源文件单独lint为0。上一归档原件不改，以原始日志和当前修正文档为准。

## 运行与数据

最终普通Studio PID66316单实例响应、9227关闭，19 DevTools包启用，真实托盘4项收藏+管理。EXE版本0.5.3、SHA仍CAFCDA17A4448CE7945B51B551F10BC36F7E03D40990E74BD14FDF22E2AC3995；入口D:\work\start-zicode-studio.cmd。调试实例65552通过WM_QUIT正常退出，未强杀用户进程。

固定资料库D:\work\local-state\zicode-studio-desktop不变。原26文件SHA、工作区登记、固定位置选择前/界面后/最终均相同，SQLite integrity ok，两篇原noteID真实snapshot.notes可读。没有迁移/编辑/恢复/删除原笔记、修改收藏、创建定时任务、模型调用、生产访问、发布或发消息。预算前后只读扫描保留，无缓存删除。

完整证据 `work/quick-pages-*`、`outputs/quick-pages-*`，归档D:\work\logs\zicode-local-setup\studio-quick-tools-pages-2026-10-27及SHA索引。后续不因本轮结束宣称全部154源工具接入完成，也不无新原因重复旧验收。
