# View 操作统一目录显式查询（2026-10-18）

## 目标与决定

Host 已能校验 `view.operation.directory.v1`，但旧手动工具界面把所有目录项当 capability 加载。增加显式 `includeViewOperations` 查询参数，在安全定位入口完成前维持默认关闭，避免把 View 操作送入执行表单。

## 修改

- 同一元数据分页目录可在显式查询时枚举 View 操作，按 ID、标题、别名、描述、来源检索，并计入全量分类及来源 facet。
- 使用独立 `view.operation:` 收藏/最近 ID 命名空间；目录行标记 `kind=view-operation`，提供 `operationId` 和 `viewId`，不提供 `capabilityId`。
- 资源文件、目录分享筛选始终排除 View 操作；`manual_tool_detail` 仍只接受真实 capability。
- 现有 Web UI 未传 `includeViewOperations`，因此不显示尚无法正确定位的 View 操作。此参数是 Host 试验性接收能力，不作为提供方发行承诺。

## 验证与遗留

隔离 Rust 专项覆盖别名搜索、目录记录、分类/来源、收藏/最近、资源筛选、默认关闭及错误详情边界；目录相关回归 **22/22**。`bun run check:rust:static` 退出 0，Cargo check 和严格 Clippy 通过，全仓 fmt 仍有既有格式漂移；`git diff --check` 退出 0。实际桌面 View 定位、SDK 回执、版本/场景/帧核验和结果展示仍待实现；无真实提供方包声明该 profile，DevTools 完整接受仍 **0/154**。本阶段无界面改动、无新截图；未更改应用版本或发布。

前后只读空间扫描均退出 0。收尾 `target` 为 22,552,100,580 逻辑字节，比前态增加 207,360 字节；task scratch 仍为 2,699,496,212 字节，E: 可用 56,610,590,720 字节。卷空闲变化不能归因于本次测试；没有因固定容量门槛删除缓存。
