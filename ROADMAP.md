# ZiCode Studio Desktop 路线图

GitHub Project #4 管理实时范围、优先级和版本。本页记录 2026-11-26 评审后的产品方向、整改顺序和验收条件。正在交付的 v0.7.8、v0.7.9 会先收尾，随后分批推进整改。[GitHub Project #4](https://github.com/users/ax2/projects/4)

## 产品范围

- 浏览器、Pi 对话、笔记和博客都是一级内置应用。浏览器阅读和采集可接续到有来源的 Pi 总结、笔记、产物与任务。博客保留独立主入口，发布编辑、Astro/Hugo 适配和 GitHub 跨机同步形成可独立使用的流程。
- 邮箱和视觉资产中心继续作为内置工作台。邮箱以 Gmail 和阿里邮箱的真实收发和附件为主。视觉资产先验证一条真实生成到工程导出的闭环，再扩展供应商与大规模库。
- Finance、Habits、Web Watch、ID Photo 和 ZiDevTools 长尾工具按需外部化。先核对持久资料、已有入口、权限和替代包的功能等价性，再迁移内置入口。图像、OCR、剪贴板和其他共享能力按实际依赖判断归属。远程连接和机器人独立审查运行边界及使用场景。

## 评审事实与修正

- 主线 c60f92dd 的 Rust Host、桌面入口、插件注册表和笔记存储仍过大。仓库把 500 行作为新增逻辑前优先提取的审查线。根模块中的历史实现与内联测试都纳入清理。
- 当前树跟踪 50 个前端编译产物。夹具目录有 9,136 个文件、约 101.6 MB，最长相对路径 220 个字符。生成产物和冻结插件证据需要各自的处理方式。保留旧标签、冻结包及原始验收回执。
- 日常 Tests 和 Developer platform 目前手动触发。Windows 更新已检查安装包摘要并做原位升级验证。Authenticode 与 Tauri 更新签名各自需要可信签名材料和验收，Tauri 的默认 Windows 安装器可以是完整包。[Tauri 更新文档](https://v2.tauri.app/plugin/updater/)
- 复核时有 51 个未归档的开放事项，26 个待验证、8 个缺优先级、11 个缺模块、21 个缺阶段。v0.7.3、v0.7.4 已关闭。v0.6.7 的里程碑计数显示 3，实际查询没有开放 Issue。跨版本子项应与其实际交付版本一致，一级路线图的目标标明模块基本完成时间。

## 实施顺序与验收

| 范围 | 实施与验收 |
| --- | --- |
| 当前交付 | 保留现有验证证据，按顺序完成 v0.7.8、v0.7.9。合并本次 Windows 系统选包、文件选择和拖放的检查。安装、升级及回退都保留用户固定资料；日常资料和账号仍由用户保管。 |
| 持续集成 | 补充 PR 和主线的轻量 Windows 自动检查，按变更选择类型、lint、设计、测试与 Cargo 检查。必需状态应稳定出结果，按阶段退出默认 `[skip ci]`。正式打包仍由标签触发。先确认真实 PR 和主线回执，再启用必需检查。 |
| 可复现构建 | 统一前端入口和构建流程，先让开发、测试、安装和发布统一消费生成结果，再移除 Git 中的生成物。把词典按功能拆分，保持运行时切换与覆盖检查。Windows 在普通目录从干净 clone 完成一次构建，不依赖全局长路径配置。 |
| 夹具交付 | 区分最小回归夹具、冻结包和历史回执。大包按版本与摘要获取，支持已有缓存的离线回读。保持可复现命令、字节校验、明确报错与已有下载入口，避免重写既有公开历史。 |
| Rust 模块与性能 | 先迁移窗口状态与本地成本统计等低耦合边界。再分组 Host 路由、桌面命令、插件注册、笔记存储与同步、HTTP 插件和前端笔记组件。命令与权限保持单一可信声明或自动校验的映射。全局死代码豁免按模块清理。用同源 Windows 样本对照当前配置与 Thin LTO，核对冷暖构建时间、体积、启动及安装升级。以依赖和编译数据决定各内部 crate 的落点。 |
| 产品与真实验收 | 浏览器和 AI、邮箱与笔记同步、视觉资产按现有版本方向验收。每条人工事项注明设备、账号或服务条件，合并桌面检查。博客保持一级内置应用，独立验证导航、Astro/Hugo、双机同步与冲突反馈。外部工具迁移先证明版本、权限和数据兼容。 |
| 发布信任 | 明确 Windows 签名来源及审批，校验下载和执行前的文件签名、时间戳与摘要。迁移 Tauri 签名更新时验证签名损坏、未知密钥、升级回退和当前用户资料保护。签名私钥由受控签名环境保管。 |
| 项目与文档 | 每个开放 Issue 补齐阶段、模块、优先级和负责人，证据写在 Issue 中。P0 用于确凿的发布阻断。保留至少五个编号候选视图，压缩同时执行的范围。一般已发布版本的工作关闭或转到承接的编号版本。历史文档保留，当前入口统一到 [文档索引](docs/index.md)。 |

## 整改跟踪

| 工作 | 对应事项 |
| --- | --- |
| 一级内置博客 | [v0.8.5 版本视图](https://github.com/users/ax2/projects/4/views/39)；[写作到发布路线图 #775](https://github.com/ax2/zicode-studio-desktop/issues/775)、[Astro/Hugo 预览与发布 #776](https://github.com/ax2/zicode-studio-desktop/issues/776)、[GitHub 两机接续与冲突恢复 #779](https://github.com/ax2/zicode-studio-desktop/issues/779) |
| 开发与交付 | [轻量自动检查 #773](https://github.com/ax2/zicode-studio-desktop/issues/773)、[Windows 检出和历史夹具 #774](https://github.com/ax2/zicode-studio-desktop/issues/774)、[Windows 签名更新 #780](https://github.com/ax2/zicode-studio-desktop/issues/780) |
| Rust | [窗口状态与本地成本统计 #777](https://github.com/ax2/zicode-studio-desktop/issues/777)、[Host、桌面入口、插件和笔记分域 #778](https://github.com/ax2/zicode-studio-desktop/issues/778)、[编译性能对照 #549](https://github.com/ax2/zicode-studio-desktop/issues/549) |
| 前端 | [统一构建入口并停止跟踪可生成产物 #781](https://github.com/ax2/zicode-studio-desktop/issues/781)、[按功能组织词典和运行时加载 #782](https://github.com/ax2/zicode-studio-desktop/issues/782) |

## 参考

- [项目执行和验收规则](docs/agents/project-management.md)
- [构建耗时对照 #549](https://github.com/ax2/zicode-studio-desktop/issues/549)
- [博客既有交付 #276](https://github.com/ax2/zicode-studio-desktop/issues/276)
- [现有模块拆分计划](docs/MODULE_SPLIT_PLAN.md)
- [历史 Picot 路线图](https://github.com/ax2/zicode-studio-desktop/blob/c60f92ddb6ff32f78c57fb3564add4f72c57d20b/ROADMAP.md)
