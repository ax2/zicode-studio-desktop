# v0.7.9 · ICS 重复截止预览

在插件管理审核并启用 ZiDevTools 的 `com.zicode.devtools.ics-count` 0.1.0。进入工具中心打开 ICS 重复截止预览，选一份本机 UTF-8 `.ics` 文件，确认共享后点击执行。单文件限 16 KiB、512 个物理行，只处理一条日程。

结果显示包含首次的次数、重复频率、首次和最后一次开始，以及适用的包含式 `UNTIL` 值。要改写原规则，用该值替换 `COUNT`，保留其余重复条件。`COUNT=1` 可改为单次日程，结果省略截止日期。以下示例从 2024 年 2 月 29 日开始，按年重复且含首次共两次，末次是 2028 年 2 月 29 日，使用 `UNTIL=20280229`。

支持 1901–2099 年的全天日程和无时区的整分钟日程，支持与独立日程工具相同的受限日、周、月、年规则。带 UTC 或命名时区、例外日期、多条日程、复杂规则和日期越界会给出提示。工具离线只读，文件保持原样。已有的[日程正文预览](2026-11-25-ics-preview.md)可用于查看原始时区、例外和规则。

## Windows 验收

- 冻结候选共 8 件、334,925 字节。目录索引 SHA-256 `56d4d023a389dc414df165dd6c9106e3a8c549b4d302a01c43bfcd2ac738fb7a`，WASM SHA-256 `2eb6a1b6a380feb6c3c192e67b6039a12b1e7843ee43c4648f3f233e7444e8ab`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/ics-count-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/ics-count-0.1.0-candidate-01-verification.json)
- 提供方源码 `2918ef8c269f9b5e5b3b4d6a445b27ebf9de3399`。Windows 生产 Worker 和本机结果对照 50 项通过，覆盖 16 KiB 边界及整个日期范围内的月末规则。独立版日程 110 项通过，其中全天和浮动 `COUNT`、`UNTIL` 对照覆盖 2099 年末。Worker 回执 SHA-256 `3f3b8e0b03f83e59c6eeda2f516c58f7549de4ecf9ca8fc8c38d08144ffb1578`。 [ZiDevTools PR #26](https://github.com/ax2/zi-devtools/pull/26)

- 使用 Windows Studio 0.7.4 的真实工具中心、Host 和生产 Worker。安装停用后审核并启用。逐次确认共享前无法执行，撤权清空结果，原件摘要不变。首次实际通过六个场景，包括以 `text/calendar` 选择恰好 16 KiB 的月末规则并得到 `UNTIL=20991231`，浮动截止、仅一次，以及超出一字节、UTC、COUNT 与 UNTIL 并存的拒绝。重启后同包仍启用，再次确认共享的结果摘要一致。首次自动化因收集变量遗漏失败，修正自动化后通过，冻结包未变化。安装和重启回执 SHA-256 `d2a1057475573d5da1a0eff692350d630d22f2567200e2317e5deff2dcd32e21` 和 `f613bae33256f86b272b6c3ab038fe5a57b518b8160bbe7ec76a0e7f4d61c299`。

本次覆盖 `planner-interop` 的一项只读能力。Windows 系统选包窗口和正式安装版留待集中验收。农历生日、复杂时区与例外、系统通知和退出应用后的提醒继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
