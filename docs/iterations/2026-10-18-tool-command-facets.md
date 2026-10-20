# Stage：命令面板工具来源与分类筛选

日期：2026-10-18。目标：大量插件工具进入 Studio 后，在快速命令入口按来源和分类缩小范围，仍通过 Host 目录按需获取摘要与详情。只修改 Studio，JSON 对象插件继续按用户决定保持禁用，未更改权限。

## 修改

`ToolCommandPicker` 读取现有 `tool.directory.v1` 分页响应的全目录 `sources`、`categories`，加入来源和分类选择。选择变化回到第一页，向 Host 传 `pluginId`、`categoryId`；关键词、收藏、最近使用、目录修订、键盘打开和延迟详情加载保持原路径。没有在客户端预载所有 schema 或新增侧栏图标。两项选择在窄宽度下改为单列，列表仍单独滚动。

## 验证

- `bun run check` 退出 0；现有 147 项 lint warning、10 项 info，以及生成 JS 的 1 项设计检查 warning 未因本改动增加。`bun run typecheck` 退出 0；`bun run build:react` 在原目录原位完成，没有重编 Rust、发布新版本或复制运行目录。
- 沿用当前 Windows Debug EXE 与已有隔离 profile，在 1442×931 浅色 `--tools-only` 真实窗口中查看：16 项内置目录打开命令面板；分类“图片与媒体”得到 3 项；再选来源“图片工具”得到 2 项，即 `Concat images` 与 `Process image`。下拉内容、筛选结果和布局均在实际截图中检查，证据归档于技术博客同名 Stage 的 `screenshots/`。
- 这次没有执行工具，也没有加载/启用 ZiDevTools JSON 对象插件；真实百项提供方目录、筛选后的翻页竞态、窄屏、深色主题和其他系统仍待验收。既有组件专项与本次 16 项实测的覆盖范围不能外推为 DevTools 154 项完整接受。

## 遗留与发布

DevTools 完整接受仍为 0/154，ZiFile 0/108。隔离测试进程结束；上轮精确清理被策略拒绝的 C 盘临时配置目录继续保留，没有改用其他方法删除。本 Stage 没有新发布或 ZIP。

前后只读空间扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,478,887 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 179,830,784 → 180,019,200 B。扫描因低于建议保留量退出 1，不代表构建失败；未清理有用缓存。
