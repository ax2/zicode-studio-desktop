# ZiDevTools 活动目录对账（2026-10-18）

目标：确保 Studio 的“全部工具插件接入”范围不因提供方同名目录持续变化而漏项。只读读取 `E:\zi-devtools\docs\tools.json`、迁移表及 Studio 冻结 dev.105 快照，未修改提供方仓库，也未复制其活动目录。

结果：当前仍 154 ID，无新增/消失；76 项版本/状态、70 项 scope、18 项 discovery 变化；`--fail-on-drift` 退出 1。当前目录 SHA-256 `38f56d6b99ab8a201d236b95d5f6785d16111c3c8347087255813909623d480f`，迁移表 SHA-256 `715a82103cf024b0f448411c354ab979db35739405d64840ce6d96697beba0dd`，仍声明 `0.82.0-dev.105`；两文件未提交。状态分布与 16 项提升见[接口需求](../plugins/devtools-catalog-release-request-2026-10-18.md)。

另按 ID 集合独立核对迁移表：双方各 154 条，重复 0、互相缺失/多出 0；迁移表声明的 `acceptedCapabilities` 仍为 0。

`E:\zi-devtools\release` 未发现正式 `.zicode-plugin`，当前完整接受仍 0/154；ZiFile 0/108。Studio 不用活动文件覆盖冻结矩阵，等待提供方版本化快照、收据及独立包。用户暂不启用的 JSON 对象插件及其权限没有更改。

磁盘：本轮只读检查期间 E 卷空闲先降到 523,386,880 B，随后回升到约 5.26 GB；Studio 前轮 `target` 保持 30,040,567,930 B，不能把卷波动归因于本轮。没有构建、删除、安装或生成新运行目录，未重试被自动审批拒绝的清理。
