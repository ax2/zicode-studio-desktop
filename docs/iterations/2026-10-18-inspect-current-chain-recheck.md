# Inspect 0.1.1 当前接收链复验（2026-10-18）

## 目标与范围

复核 Studio 当前 Host 源码对既有 ZiDevTools Inspect 0.1.1 候选的接收能力。只读取 `E:\zi-devtools\release\plugin-candidates\inspect-0.1.1-candidate-01` 及外部收据，不修改 DevTools。使用独立的临时 Test Host 配置和现存 `target/debug/zicode-studio-desktop.exe`、内嵌 Pi、Broker。用户选择暂不启用的 JSON 对象插件及其权限保持原状。

## 验证

- 候选和安装副本由测试再次校验：606 个文件、目录索引匹配，未签名开发候选；这不等于正式发布包接受。
- `current_inspect_candidate_runs_all_eight_operations_in_real_host_worker`：1/1 通过；8 个操作经真实 Host/生产 Worker 返回预期结果。无桌面令牌、非法 YAML `INVALID_INPUT`、停用后的拒绝也通过。成功运行的隔离 scratch 已由测试删除。
- `embedded_pi_inspect_011_eight_operations_and_permission_lifecycle`：1/1 通过；8 项 Pi/Broker 发现、加载、调用及 10 个授权和安装阶段。归档收据记载 40 次目录缓存拒绝、24 次旧授权拒绝、6 次独立控制调用。收据路径：技术博客 `iterations/inspect-current-chain-2026-10-18/evidence/pi-receipt.json`，SHA-256 `D6A49199465A406CB689651F5E1E3B36BF9481C255539E76BECF3B8EF95080F3`。成功运行的隔离 scratch 已由测试删除。
- 测试使用现存 Worker EXE（文件时间 2026-10-18 01:49），当前 Host 测试源码经 Cargo 编译；此次没有重新构建 Studio EXE。因此证据只覆盖当前测试 Host 源码与保留的 Worker 二进制组合。
- 前后只读磁盘扫描完整，未知项 0：`target` 30,032,032,503 → 30,032,081,655 逻辑字节，`task-scratch` 均为 1,258,318,024 字节；E 盘空闲 8,420,634,624 → 8,408,047,616 字节。扫描退出码 1 是容量建议，不作为删除有用缓存的依据。

## 待验收

没有运行原生窗口，也没有启用 JSON 对象插件。模型自主选择、真实桌面结果接力和保存、正式签名安装/升级/回退、全部 154 个 DevTools 工具、ZiFile 108 项及其他操作系统仍待验。`mechanismPassed=true` 与 `fullCandidateAccepted=false` 是收据的明确边界；DevTools 完整接受保持 0/154，ZiFile 保持 0/108。未改应用版本，未生成新发布目录或 ZIP。
