# Pi 与 DSH：当前 Studio 的替换判断

2026-11-04，用户再次询问必要性与实际收益。本轮只评估，没有更换底层、创建 DSH 进程、安装依赖或调用模型。当前 Studio 锁定 Pi 1.3.0，依据 `scripts/pi-version.json`。

判断：当前优先完善笔记、工具、托盘、硬件和同步，没有必须整体替换的已证实原因。DSH 值得作为 AI 执行层的候选，其净收益要通过同条件对照证明。

- DSH 将模型适配、工具、会话日志及 AgentLoop 组织为可替换插件，可望减少后续复杂 AI 工作流的专门代码；这是潜在工程收益，不是本项目已测出的优势，也不表示 Pi 没有扩展能力。[官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- 提供 stdio JSON-RPC 的 SDK profile，可以继续保留 Tauri、Rust Host 和当前界面。审批、问题交互等需要嵌入方处理，官方 SDK 也列明无图形客户端等边界。[SDK profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/sdk-app/README.md)
- 不能据此保证输出更好、速度更快、内存/费用更低。当前没有 Studio 内同模型、同提示、同工具与权限下的 A/B 数据。
- 当前官方仍为开发者预览，并明确提示不兼容变更，长期适配成本必须考虑。[当前项目状态](https://github.com/deepseek-ai/deepseek-harness#developer-preview)
- Studio 的笔记、固定资料库及通用 Host/Worker 工具并不归 Pi 所有；工具专用会话的 `bridge/process` 均可为空。DSH 插件与 Studio 工具插件不是可直接互换的包标准。
- 更换需要适配会话、流式事件、取消、中断恢复、工具授权、模型配置、Pi SDK 扩展与旧聊天记录；笔记库保持独立。现有资料中 DeepSeek 已是 Pi 支持的模型提供方，使用 DeepSeek 模型本身不需要先替换 Harness。

若将来明确授权试点，保留 Pi 默认与回退，只增加 DSH 的 AI 执行层适配；固定版本、独立状态，不迁移/改写当前资料。先验收基础聊天、流式、取消、工具确认和恢复，再用同模型与同工具集比较任务完成率、耗时、token/费用和故障恢复。官方 SDK 默认还带插件管理、问题交互和定时能力，试点需按 Studio 已授权范围明确裁剪，不能恢复用户已禁用的定时任务或绕过现有资源确认。

这个建议不是用户已授权开始迁移的记录；继续当前笔记同步工作，不能把询问意见当成替换 Pi 的指令。
