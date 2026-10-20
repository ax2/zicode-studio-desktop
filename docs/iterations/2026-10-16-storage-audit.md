# 本机存储审计（2026-10-16）

## 范围与方法

只读检查 E:\zicode-studio-desktop 当前目录体量、scripts/storage-budget.ps1 输出、target/debug 与 target/release 一级分布，以及 task-scratch 的目录归属标记。未运行构建或测试、未删除任何内容；此前被策略拒绝的删除没有换工具重试。统计为逻辑字节，不等同于卷实际释放量。

## 当前占用

| 范围 | 逻辑大小 | 文件数 | 说明 |
| --- | ---: | ---: | --- |
| target | 29,379,422,547 B（27.35 GiB） | 74,295 | 占用主体 |
| target/debug | 24,675,285,033 B（22.98 GiB） | — | 当前开发运行时和 Cargo 缓存 |
| target/release | 4,704,136,231 B（4.38 GiB） | — | Release 运行时和编译产物 |
| .cache | 1,114,382,150 B（1.04 GiB） | 30,223 | 含 task-scratch |
| .cache/task-scratch | 758,923,480 B（724 MiB） | 30,067 | 25 个目录没有 owner.json |
| src-tauri | 834,237,224 B（796 MiB） | 10,158 | 包含当前 Pi 资源及项目源文件 |
| node_modules | 430,600,087 B（411 MiB） | 23,019 | 当前开发依赖 |
| release | 123,790,336 B（118 MiB） | 1 | 当前仅有验收夹具 |
| E 盘可用 | 59,295,096,832 B（55.2 GiB） | — | 当前读数 |

Debug 内部最大的部分是 deps 17,335,383,251 B（16.14 GiB）、build 3,159,241,950 B（2.94 GiB）和 incremental 2,790,120,589 B（2.60 GiB）。Release 内 deps 2,662,432,648 B（2.48 GiB）、build 767,297,784 B（0.71 GiB）。这些是不同构建配置的依赖、链接和编译缓存；仅凭时间或目录名不能证明其不再可复用。

## 人工候选与保留项

项目现行规则要求 Debug 与 Release 各保留一个最新完整运行目录，并继续共用仓库 target。两个目录分别包含完整运行资源，因此出现部分运行资源重复是当前交付保留要求的一部分。当前没有证据支持整体清空 target，也不应因超过 12 GiB 的参考值而删缓存。

以下六个隔离临时目录此前有独立的删除记录/用户可复核记录；本轮确认路径仍存在，且按目录名未发现关联运行进程。删除会丢失对应隔离验收 profile 或临时诊断副本；日志和索引在项目或技术博客档案中的可恢复范围各异。它们曾被自动审批策略拒绝，本轮不重试、不换工具。用户如要手工操作，先逐项阅读关联工作日志并接受 profile 丢失风险，勿删除 .cache/task-scratch 根目录。

| 项目内绝对路径 | 当前逻辑字节 | 历史用途 |
| --- | ---: | --- |
| E:\zicode-studio-desktop\.cache\task-scratch\public-release-cold-inbox | 39,048,378 | 7 个冷加载诊断副本；历史日志和清单保留 |
| E:\zicode-studio-desktop\.cache\task-scratch\native-acceptance-20261014 | 37,967,447 | 原生插件验收隔离 profile；工作日志引用 |
| E:\zicode-studio-desktop\.cache\task-scratch\current-native-acceptance-20261014 | 37,516,661 | tools-only 原生验收 profile；清理被拒后留档 |
| E:\zicode-studio-desktop\.cache\task-scratch\single-instance-stage-20261014-profile | 36,787,733 | 单实例阶段隔离 profile |
| E:\zicode-studio-desktop\.cache\task-scratch\single-instance-stage-20261014-other-profile | 13,040,313 | 单实例阶段的第二隔离 profile |
| E:\zicode-studio-desktop\.cache\task-scratch\single-instance-stage-20261014-fixture | 10 | 阶段夹具 |

当前合计 164,360,542 B（约 156.7 MiB）；这是候选逻辑字节，不是已释放空间。其他没有 owner.json 的 scratch 目录合计 364,552,631 B，但“缺少标记”不能证明无引用或可删除，未列为可直接清理项。较大的 trace/native、model-result、tool-center profile 有 owner 标记且对应验收工作，保留。

旧 release/devtools-* 等运行副本在 2026-10-15 复核时已缺失，不能再列为当前候选。原归档清单因历史基线缺失而不能证明这些目录可恢复；本轮不恢复、不推断它们如何消失。

## 规则判断与后续

当前磁盘占用主要来自 Rust/Tauri 的开发缓存：Debug 约 23 GiB，Release 约 4.4 GiB；依赖缓存和本地链接产物显著大于应用源代码。这样的规模在依赖较多、包含 WASI 与本地桌面组件的 Cargo 项目中可能出现，但本项目应继续复用单一 target、稳定 profile、只保留当前 Debug/Release 运行版本，避免每轮导出副本。仓库已有 incremental=false 配置，但既有目录不会因此自动消失，且不能把配置变更当作已经回收空间。

按项目规则，当前保留缓存可避免重复下载和编译。审批策略只能由策略所有者调整；本次没有尝试改用其他删除工具。实际删除量为 0 文件、0 字节。后续若由用户手工清理上述目录，应再次运行存储审计，并将实际目录差异与卷空间变化分开记录。
