# 项目贯穿各应用 —— 设计（2026-08-08）

## 1. 背景与目标

当前各应用（会话、笔记、产物、任务、自动化）以不同维度隔离数据，用户
感知不到"项目"这个统一容器。目标：**项目（workspace）成为所有应用的顶层
容器**，例如笔记的层级变为"项目 → 笔记本 → 笔记"，其余应用同样展示当前
项目上下文，并可互相跳转。

## 2. 现状模型（代码证据）

| 内容 | 当前归属维度 | 证据 |
| --- | --- | --- |
| 会话 | workspace（projectPath 分组） | `sessionSidebarLogic.groupByProject`，侧栏按项目分组 |
| 笔记/产物 | scene（场景插件根目录/vaults） | `notes_vault.rs` `root.join("vaults")`；网关 `/v2/notes?sceneId=` |
| 任务/自动化 | workspace | 配置网关 prompt 携带 `target.workspaceId` |
| 项目聚合 | 仅"项目工作台"视图 | `projects/store.ts` 聚合当前场景笔记 + 当前 workspace 会话/文件 |

结论：**会话与任务已经按项目（workspace）隔离，笔记与产物按场景隔离**。
场景（scene）是"配置 + 运行实例"的隔离键，不是内容层级；一个项目可以有
多个场景的会话与内容。

## 3. 目标模型

```
项目 Project (workspace / projectPath)
├── 会话 Sessions            (已按 project 分组)
├── 笔记 Notes
│   └── 笔记本 Notebooks
│       └── 笔记 Notes        ← 新：项目为顶层
├── 产物 Artifacts
├── 任务 Tasks
└── 自动化 Automations

场景 Scene = 项目内"配置/实例"维度（正交）：一个项目的内容可按场景组织，
默认展示"当前会话所属场景"，项目级聚合视图可合并多场景。
```

## 4. 交互设计

1. **笔记导航**：顶部为项目头部（当前 workspace 名称/路径，点击可切换
   项目），其下依次为 笔记本 → 笔记（沿用现有树）；切换项目时加载该
   项目的笔记。
2. **各应用项目上下文**：应用头部/侧栏显示面包屑"项目名 > 应用名"；
   底部/侧栏提供"回到项目工作台"入口。
3. **项目工作台**（现有 projects 视图升级）：成为各应用的聚合首页——
   统计卡片（已有）+ 可点击跳转（笔记/产物/任务/自动化），统一搜索。
4. **侧栏项目分组**：每组头部保留"新建对话"，新增"笔记/产物/任务"快捷
   入口，切换时带项目上下文打开对应应用。

## 5. 数据层设计（分三步）

### 5.1 短期（无后端 schema 变更）
数据仍按现状存取；前端增加**项目映射层**：`projectId = workspaceId`，
"当前项目的笔记" = 当前会话所属场景的笔记。项目切换 = 切换 workspace，
场景跟随会话（现有 `target.sceneId` 语义不变）。

### 5.2 中期（后端增强）
- `notes_vault` / artifacts 数据增加 `workspaceId` 归属（或 vault 根按
  workspace 建，scene 作为子目录），`/v2/notes` 等接口支持
  `workspaceId` 查询；
- 提供一次性迁移：把既有场景 vault 关联到 workspace；
- 前端网关 `notesGateway.list(workspaceId, sceneId?)` 兼容双键。

### 5.3 长期（统一内容索引）
项目 → 全场景内容索引（合并多场景笔记/产物），支撑项目级搜索与
"最近内容"；任务/自动化保持 workspace 语义不变。

## 6. 分阶段实施计划

| 阶段 | 内容 | 风险 |
| --- | --- | --- |
| P1（UI 层） | 笔记导航项目层 + 项目切换；各应用面包屑；侧栏项目快捷入口 | 低：纯前端，不动数据 |
| P2（数据模型） | notes/artifacts 增加 workspaceId；迁移；网关适配 | 中：vault 迁移、双键兼容 |
| P3（联动） | 项目工作台可操作化；统一搜索；移动端适配 | 中：多场景合并语义 |

## 7. 关键决策点（需确认）

- **D1**：项目下多场景内容如何展示——合并为一个笔记树，还是按场景
  分组？建议：默认合并（内容按场景打标），可切换"仅当前场景"。
- **D2**：笔记存储是否升级为"项目 + 场景"双键？建议 P2 再定；P1 用
  映射层先行。
- **D3**：P1 范围确认——先做"笔记导航项目层 + 各应用面包屑 + 侧栏
  快捷入口"，还是只先做笔记导航项目层？
- **D4**：跨项目切换时场景是否跟随？建议跟随会话（现状语义），项目
  工作台里可选择场景查看。

## 8. 风险与兼容

- vault 目录迁移需保留旧路径回退，避免破坏既有笔记；
- 移动端导航高度受限：项目层可折叠，避免层级过深；
- 与现有"场景隔离"产品语义（场景间数据隔离）冲突时，项目聚合视图
  只读合并，写操作仍落在当前场景，保证隔离不被破坏。

## 9. 实施记录（2026-08-08，第 233 轮）

已确认决策：**D1=项目下多场景内容默认合并**（P1 映射层先取当前会话
所属场景，聚合语义留 P3）；**D4=切换项目时场景跟随会话**；D2 数据层
P2 再做；D3 按"笔记导航项目层 + 侧栏快捷入口"先行，各应用面包屑并入
后续轮次。

P1 交付内容：

1. 笔记：`notesStore` 增加 `ProjectInfo`/`project`/`setProject`，侧栏
   顶部项目头部（📂 + 项目名），切换 workspace 后头部跟随；
2. 插件壳：侧栏项目行 + `getProject` 注入 + `refreshSidebar`；
3. 会话侧栏：当前项目分组头部"笔记/产物/任务"快捷入口；
4. app.js：`currentProjectInfo` 维护（workspaceInfo 解析路径/名称，
   仅工作区变化或缺失时刷新）。

验证：typecheck / Biome / 703 测试全绿；安装目录同步重启后 CDP 实测
快捷按钮、项目头部、项目行均渲染且无重叠无溢出。P2（workspaceId 数据
归属 + 迁移）与 P3（项目工作台联动、统一搜索、移动端适配）未启动。

## 10. 实施记录（2026-08-08，第 234 轮）：P2 数据模型

按 5.2 中期方案落地（vault 根按 workspace 建，scene 保持正交授权维度）：

1. notes_vault：`vaults/<workspaceId>/<notebook>` 目录归属；
   `NotesVault::scoped(workspaceId)` 工作区视图 +
   `migrate_legacy` 一次性迁移（首个访问的工作区认领遗留目录，标记
   幂等）；变化日志按工作区隔离；`NotebookDescriptor.workspaceId`；
2. artifact_store：`items/<workspaceId>/` 目录归属 + 描述符
   `workspaceId`（迁移回写）；`scoped`/`migrate_legacy` 同构；
3. 网关双键：/v2/notes*、/v2/artifacts* 必填 workspaceId；插件能力
   CapabilityInvocation 携带 workspaceId，notes.search/get/create
   全部工作区收敛；
4. 前端 gateway/store 双键传参（notes/artifacts/projects/finance）。

验证：Rust 163 + 前端 703 测试全绿；debug 实测迁移与跨工作区隔离；
release 重建（EXE 41,734,656 B，SHA-256 `F7160211…`）静默重装后生产版
笔记加载正常。P3（项目工作台联动、统一搜索、移动端适配）未启动。

## 11. 实施记录（2026-08-08，第 235 轮）：P3 联动

1. 项目工作台可操作化：概览新增任务/自动化统计卡（配置网关计数 + 点击
   直达），搜索结果行按钮化并按类型深链（笔记/产物/会话/文件）；
2. 深链接线：`zicode:open-note` / `zicode:open-artifact` /
   `zicode:open-session` 事件 + notes/artifacts handle
   `openNote`/`openArtifact`（按 id 取数选中）；
3. 统一搜索：项目搜索（对话/笔记/文件/产物）结果全部可跳转；
4. 移动端适配：760px 以下单列堆叠，390px 视口无横向溢出。

验证：前端 706 测试全绿；生产版 CDP 实测统计卡、搜索跳转、笔记深链
选中、移动视口布局。至此 P1–P3 全部落地，项目统一容器改造完成；后续
增强（跨项目数据迁移工具、项目级统一内容索引）可并入常规迭代。
