# 大目录发现与按需加载复核（2026-10-17）

## 目标

复核 Studio 在工具达到上百个时的搜索、分类、来源、收藏、最近使用、分页和按需加载。此轮只验证 Studio 现有实现，不修改 ZiDevTools，也不把合成夹具计为提供方工具接受。

## 当前实现与证据

`ManualToolDirectory` 提供来源/分类筛选、搜索、工作区/场景范围内的收藏与最近使用、40 项分页；浏览只请求元数据，选择工具后才加载输入详情。命令面板也使用分页目录，不把上百个工具转成侧边栏图标。Host 的 `manual_catalog` 返回目录字段与稳定 revision，翻页时检查版本；权限/启用状态变更会令旧 revision 失效。

2026-10-17 重新运行：

- 前端 `ManualToolDirectory.test.tsx`、`ToolCenterApp.test.tsx`、`ToolCommandPicker.test.tsx`：3 文件，35/35 通过。覆盖筛选组合、收藏与最近使用分页、按需加载、命令面板操作；前端使用模拟 API。
- 真实 Host HTTP 定向测试 `real_http_manual_directory_pages_and_loads_without_worker_or_pi`：1/1 通过。隔离安装 Studio 自有 205 能力夹具；首屏 40 项、第二页 40 项，按中文/英文别名、分类和来源查询。收藏与最近使用跨两工作区隔离，详情仅对选中的第 205 项加载，旧目录 revision 被拒绝；浏览不启动 Worker/Pi，也不在列表中返回输入 schema。
- 构建/测试前只读空间扫描：`target` 29,401,968,502 B / 74,558 文件；`task-scratch` 839,558,866 B / 31,060 文件。后：`target` 29,399,231,464 B / 74,559 文件；`task-scratch` 数值不变；未知项均 0。逻辑大小变动不能直接等同磁盘回收，本轮未清理缓存或重试已拒绝删除。

## 验收边界

这组证据表明 Studio 的通用目录在 205 项合成能力下可检索和分页，且详情按需加载；没有对真实 154 项 DevTools 签名插件包进行原生 GUI 大目录验收。当前 `url-text-resource-0.1.0-candidate-02` 仍因缺 `tool.directory.v1` 必需声明而在 Host 安装阶段失败，新候选尚未出现。完整 DevTools 接受保持 0/154；真实包到位后须重做发现→加载→执行→展示，并检查失败隔离、授权接力、确认保存和 macOS/Linux 运行。

## 当前工作树复核（2026-10-17）

再次按当前脏工作树运行同一范围：`ManualToolDirectory`、`ToolCenterApp`、`ToolCommandPicker` 前端 3 文件共 38/38 通过；真实 Host HTTP 的 205 能力目录分页/搜索/按需详情专项 1/1 通过。没有改动界面或生成新运行目录，故本轮没有新增截图。前后只读空间扫描完整且未知项 0：`target` 均为 29,419,072,127 B，task-scratch 均为 852,978,182 B；E 盘可用从 46,113,214,464 B 到 45,965,107,200 B。没有清理，不能把卷余量变化归因于这两组测试。正式提供方包、原生界面和跨平台验收边界不变。
