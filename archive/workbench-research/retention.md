# 历史材料取舍

对 46 项内容的决策如下。公开产品的源码、文档和标签继续作为发行依据。

## 补丁基线

每个补丁均已在临时索引中以公开历史 blob 为输入验证，得到所列目标 blob。各仓库相对路径按原样使用，标准补丁的上下文行保留空格。

| 补丁 | 原路径 | 公开输入 blob | 归档还原后的 blob |
| --- | --- | --- | --- |
| regressions/model-endpoint-identity.patch | src-tauri/src/model_tools/tests.rs | 2c24b3a0039aaa4ca797eecd5bdeab44d4704a18 | 72968dcb6f9e133c8a35f6dc93f2be71c5c2ad19 |
| regressions/visual-library-navigation.patch | public/native/plugins/tool-navigation.test.js | a45fae596d786d4834d46050962d0ad44904e8e7 | 6b78b0e9c5f9110f3f6c71c9ead79cc4025e252a |
| tool-tabs/open-tabs.patch | frontend/src/features/toolCenter/OpenToolTabs.tsx | 13af0f98654d0e2ebff84127172c573e805f7e61 | 83f28718ae2bf494c3fb4eae71e8e0106ce0c3a9 |

## 过时的类型、版本或发行器差异，正式源码提供发行实现（4）

- .github/workflows/release.yml
- frontend/src/features/notes/notesLogic.ts
- src-tauri/Cargo.toml
- scripts/export-windows-candidate.ps1

## 历史交接与版本状态，参考正式分支规则、版本记录与发行说明（6）

- AGENTS.md
- CONTEXT.md
- docs/releases/next-release.md
- docs/releases/v0.5.10-data-retention.md
- docs/releases/v0.5.11-verification.md
- docs/releases/v0.5.7-verification.md

## 归档为精确补丁或原始组件（4）

- public/native/plugins/tool-navigation.test.js
- src-tauri/src/model_tools/tests.rs
- frontend/src/features/toolCenter/OpenToolTabs.tsx
- frontend/src/features/toolCenter/ToolTabIcon.tsx

## 构建输出，可由对应源码重建（4）

- public/native/react/chat.js
- public/native/react/tool-center.js
- public/style.bundle.css
- public/native/react/visual-assets.js

## 将可复用的创作需求或验证方法摘入 README，排除过期阶段描述与原始运行记录（16）

- docs/adr/0008-visual-asset-studio.md
- docs/browser/requirements.md
- docs/desktop-persistent-data.md
- docs/iterations/2026-11-16-tool-launcher-native-directory.md
- docs/iterations/2026-11-16-tool-launcher-races.md
- docs/iterations/2026-11-16-tool-results-notes-artifacts.md
- docs/iterations/2026-11-16-translation-recent-native.md
- docs/visual-assets/browser-coexistence-gates.md
- docs/visual-assets/browser-coexistence.md
- docs/visual-assets/business-acceptance.md
- docs/visual-assets/creation-workflows.md
- docs/visual-assets/development.md
- docs/visual-assets/image-generation.md
- docs/visual-assets/outfit-generation.md
- docs/visual-assets/released-issues-review-2026-11-18.md
- docs/visual-assets/style-transfer.md

## 保留可配置门限模板，删除特定机器、样本、视口和时间值（1）

- docs/visual-assets/browser-coexistence-gates.json

## 保留通用验证器原文（2）

- docs/visual-assets/browser-coexistence-metrics.mjs
- docs/visual-assets/verify-browser-coexistence.mjs

## 与公开历史最近版本相比仅增加空行（7）

- public/native/browser/browser-app.js
- public/native/browser/browser-reopen.test.js
- public/native/workspace/window-chrome.css
- src-tauri/src/browser/download_commands.rs
- src-tauri/src/browser/engine.rs
- src-tauri/src/browser/native_favicon.rs
- src-tauri/src/browser/runtime.rs

## 通用账户费用辅助工具，非 Studio 功能或依赖（2）

- skills/openai-api-costs/SKILL.md
- skills/openai-api-costs/scripts/query_costs.py
