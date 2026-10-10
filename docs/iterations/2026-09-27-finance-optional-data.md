# 2026-09-27 金融工作台本地数据优先

状态：本轮实现与静态检查完成；真实工作流验收待办。

## 发现与决策

- 金融快照存储已接受任意来源名称，工具、搜索和执行 ID 是可选字段；研究卡、回测、筛选及模拟账本可在没有 QVeris Key 时使用。但默认场景提示、首页引导、快照文案和示例把 QVeris 写成必需来源。
- 保留 QVeris 的 Discover、Inspect、付费确认与 Usage 审计能力，改为明确可选。对用户提供的数据要求来源和数据时间，不暗示应用已经核验其真实性。
- 将示例股票与价格换成虚构 `DEMO` 和固定的演示日期、数值，避免把示例误认作当前真实行情。

## 工作记录

- Finance 场景提示改为优先使用有来源、有数据时间的用户数据；仅在选择可选 QVeris 外部来源时要求 Discover、Inspect、费用确认及 Usage 审计。OHLCV 归一化和快照工具说明接受明确来源的其他数据。
- 工作台首页先引导研究、回测、筛选及模拟账户，再提示可选的 QVeris 连接；缺少 Key 不再显示为整个工作台的必需条件。Usage 按钮仅在 Key 已配置时可用。
- 市场快照和模拟交易示例改用虚构 `DEMO` 标的、固定演示日期和演示来源；界面说明示例并非真实行情，不在未调用外部服务时伪填 QVeris 执行 ID。
- 中英文金融帮助、设计文档和平台计划同步；QVeris 连接、计费确认及已有场景隔离逻辑保留。

## 验证记录

- `bun run typecheck`：通过。
- `bun run check`：通过；现有 111 条 warning、7 条 info，以及生成终端包的内联高度提示。
- `bun scripts/check-i18n-coverage.mjs`：通过；2533 个键，缺失 0。
- `bun run build:react` 与 `bun run build:extensions`：通过；保留金融工作台生成包，恢复其他原本干净的 React 包。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets` 和 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；旧页面未列入导航的提示仍存在。
- 本轮未新增或运行测试，也未操作真实工作台、导入行情、执行回测或验证 macOS/Linux 界面。

## 遗留与发布

- 手工来源只记录用户提供的来源标签和数据时间，不验证价格、文件签名或许可。外部实时数据仍只集成 QVeris；其他提供商需要单独的适配与契约验证。
- 演示数据若由用户主动保存，会进入本地快照或模拟账本；界面已明确它是演示数值，真实数据工作流仍需验收。
- 本轮仅保存本地代码、生成包和文档；未提交、推送或发布。
