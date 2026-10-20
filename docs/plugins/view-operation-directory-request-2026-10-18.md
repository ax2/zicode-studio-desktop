# View 内操作的目录与定位接口需求（2026-10-18）

Studio 已实现[版本化清单接收与轻量列表预览](view-operation-directory-v1.md)；单项搜索、收藏/最近、点击定位、View SDK 回执及提供方新包仍待。下文保留最初接口需求，不能将 Host 阶段预览误认为六项操作可用。

## 当前缺口

Studio 冻结目录修订 `9c17b7b91e84f1c7` 将 Agent Assist 的 2 项、Spring Actuator 的 4 项标为 `executionSurface=view`。对应两包的 manifest 只有应用 activity 和主 View，没有单项操作目录。当前 `tool.open.v1` 只允许定位真实 `contributes.capabilities[].id`，`application.directory.v1` 只索引整包应用。因此 Studio 目前能打开整包应用，不能安全地把这 6 项作为独立的搜索结果、收藏或最近操作，也不能给 Pi 注册为可调用工具。

冻结目录的操作映射只用于接收审计；运行时不得从 Studio 自有映射表、View HTML、脚本内容或邻接 DevTools 工作树猜测操作 ID。不能添加假 capability 来换取工具目录展示，因为那会错误表示其具备动态执行、输入/输出和权限合同。

## 已有合同可先用

提供方下一独立候选可按 [application.directory.v1](application-directory-v1.md) 为两包主 activity 声明类别、别名与用途，更新包版本及包外收据。Studio 可将它们作为可搜索的应用各列一项，无需增加六个侧栏图标。该步骤只改善应用发现，不计六项操作的独立定位或动态调用验收。

## 单项 View 操作合同草案

Studio 接收侧需要一个新的、精确版本协商的 `view.operation.directory.v1` 合同，待 Host 与前端实现并完成通用一致性验证后才能让提供方声明支持。每项由包内 manifest 显式给出以下有界字段：

| 字段 | 约束 |
| --- | --- |
| `id` | 包内唯一、稳定的操作 ID；不与 capability ID 混用 |
| `title`、`directory` | 有界标题、类别、别名、用途；遵守现有目录的长度、NFKC 与重复检查 |
| `viewId` | 必须引用同包已声明且可用的主 View |
| `sourceToolId` | 可选、仅作来源对账；不授权运行或展示用户路径 |

Host 安装时校验 profile 版本、字段大小、唯一性、View 引用与目录上限；搜索结果标明 `view-operation`，不可出现“执行”表单或 Pi 动态工具注册。选择单项后 Studio 再核对当前插件版本、场景、工作区、启用状态和 View 实例，向同包主 View 发送不含输入数据的操作定位意图，并等待绑定请求 ID 的 `opened`、`not_found` 或 `unsupported` 回执。超时、切换、停用、卸载和升级必须取消待定位状态；失败只影响当前入口。定位成功也不代表 HTTP/模型请求已执行或权限已获批准。

提供方需要给出 6 项操作 ID 对应的标题、类别、别名、用途、主 View ID，以及已定位/未知 ID/慢回调/停用/版本变化的可复现向量。Agent Assist 的模型生成仍要独立逐次确认，Spring 的 HTTP GET 仍走现有 Host 确认门禁。若希望 Pi 自动调用某项，提供方须另行交付真实 capability 与输入、输出、权限和执行合同；View 定位本身不满足该条件。

## 验收边界

Studio 的九包注册表准入用例验证了九份冻结候选可安装到**隔离测试注册表**并保持默认禁用、权限未授权。它不把未声明的六项 View 操作转为单项工具，也没有在用户配置中安装或启用插件。需依次验收新 Host profile、前端目录/定位、提供方新版包及收据、真实原生界面和跨平台，再更新逐项接受状态。当前完整 DevTools 接受仍 **0/154**；JSON Object 按用户决定保持禁用。
