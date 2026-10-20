# 签名包工具清单核对（2026-10-17）

## 目标与发现

先前签名包预览只给出声明工具总数。上百工具的提供方包难以在安装前逐项核对。Studio 预览已经完整验签、校验包内文件与 `plugin.json`；可以直接从已校验清单提取工具 ID 和标题，无需新协议或访问 DevTools 源码。

## 修改

后端 `SignedPluginPreview` 增加 `capabilities`，逐项返回清单里的 ID 与标题，总数由该列表计算。前端在签名包核对卡增加默认折叠的工具列表，展开后按 ID、原始标题和当前界面译名搜索，显示匹配数与总数；列表高度受限，安装和取消按钮保持可见。安装仍需要单独点击，Host 在安装时复核签名包身份。

## 验证

- Rust 签名包工具预览专项 1/1；前端签名卡与插件管理专项 12/12，其中使用 154 项合成清单验证完整展示及搜索末项。合成清单仅验证 UI 容量，不算 DevTools 实包验收。
- `bun run typecheck`、`bun run check`、`bun run check:rust:static`、`bun run build:react`、`bun run build:local` 通过。最终 `bun run check` 报 147 warnings / 10 infos；本轮三个相关前端文件单独 Biome 检查为零诊断。Rust 全库格式漂移仍为 advisory。
- 复用原有 Debug 运行目录生成 0.4.2 EXE，125,082,112 B，SHA-256 `8441671DE9B305071AD82D50401FB4F74DDAD1A1B15048D35B6D76C438A03FC5`。
- Windows 隔离 `--tools-only` 真实窗口只读选择已有签名测试包，展开后显示 5/5 项及各自 ID；搜索 `sha256` 显示 1/5，且权限、指纹和安装按钮仍可读。未安装测试包。调试进程 PID 43144 经身份核对后停止。

## 截图与空间

1442×931、浅色、Windows Debug 截图已目视检查，保存在技术博客 `screenshots/signed-plugin-tool-review-2026-10-17/`：`windows-debug-all-tools-1442x931.png`（97,224 B）及 `windows-debug-filtered-1442x931.png`（92,516 B）。此插件管理入口仅供桌面端使用，本轮没有移动端界面截图。

前后只读扫描未知项均 0：`target` 30,010,639,051 B / 75,444 文件 → 30,010,795,065 B / 75,457 文件；非 scratch `.cache` 保持 355,458,670 B；task scratch 1,137,924,666 → 1,137,934,545 B。E 盘可用 16,136,929,280 → 15,865,905,152 B，低于 20 GiB 提示线；卷空闲变化不能按逻辑大小归因。没有重复运行完整 Release 构建、改版本、生成 ZIP 或删除有用缓存。上一轮被策略拒绝清理的隔离 profile 未重试。

正式提供方签名包、完整 154 项工具、macOS/Linux 原生运行、真实安装与执行仍待验；完整接受维持 0/154。
