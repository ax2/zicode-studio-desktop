# v0.7.9 · 时区工作台搜索与逐行复制

从仓库获取[冻结目录](../../tests/fixtures/devtools-windows-file-tools/time-zone-0.2.0-candidate-03)及[逐件收据](../../tests/fixtures/devtools-windows-file-tools/time-zone-0.2.0-candidate-03-verification.json)，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对。打开 Studio 的插件管理，选择「安装本地插件」并启用。若替换同一 ID 的旧本地包，请按界面确认新版本。此包无需额外权限。

在工具中心搜索「时区工作台」并选择「在应用中打开」。填写来源的本地时间，搜索并选中来源 IANA 时区，再按需要添加 1 至 8 个不同的目的地。搜索支持 IANA 名称和部分常用城市中文名。用方向键浏览结果，按 Enter 选中，按 Escape 取消未确认的搜索。结果保持添加顺序，点击任一行的「复制」可复制时区、本地日期时间、偏移和缩写。浏览器拒绝直接复制时，工具选中该行，提示按 `Ctrl+C`。原通用表单可通过「IANA 时间换算」打开。

若当地时间重复，界面显示较早和较晚的 UTC 候选，选择后再换算。若当地时间不存在，显示附近有效分钟并保留原输入。运行期间可取消，输入变化后忽略旧请求结果。专用界面从当前 Studio SDK 获取中英文及明暗主题，使用同一个 IANA 2025b 离线 Worker。独立版即时预检的流程仍由独立版提供。[交互需求 #744](https://github.com/ax2/zicode-studio-desktop/issues/744) · [工具迁移 #29](https://github.com/ax2/zicode-studio-desktop/issues/29)

## Windows 验收

- 提供方 [ZiDevTools #55](https://github.com/ax2/zi-devtools/pull/55) 合入 `f9c7a0f86375e9256a5f8cca2ccd7b5db5744277`。冻结源码 `de84fe7af82c687ac30596257a9975954625cf55`，同一个 v0.1.0 旧模块 SHA-256 `bc172f6ae3835dec7180882ab13f0ffa719541b5e47626a051526f35deab28e0`。现有 45 个真实 Worker 计算回执可按操作契约和模块字节复用。597 个选择项与同一 `chrono-tz` 原生导出逐项一致。
- 冻结包九件，目录索引 `245297f65752aee7558cb5ade23269e646ebcf9a22f1fca193155772d57cbdab`，外部逐件收据 `a98ae1625bb128469c12d1ca3c0cc86720dbefbf640ef83a05baa1364412b300`。每个时区输入仍限 64 UTF-8 字节，单次请求与结构化结果仍为 8 KiB 和 4 KiB。
- 在真实 Windows Studio 0.7.4 Debug（源码 `235431bc2c949148ed8ab731f03953385e1ef0ce`）的全新隔离资料首装英文，重启同一资料验证中文。两轮各六组，均调用实际 Host/Worker。测试搜索、顺序与移除、重复和第九项拒绝、跨日、两个重复时间候选、空缺提示、非法日期和取消后重试。实际可用宽度 1113 与 433 像素，无横向溢出。两个运行回执 SHA-256 `e14c54438663f3a3bdc8808c0b52479fe43b9463fad661dfaeadd0f4e8a5fca5`、`36cbb5ceaf14e5682c76f9e8540d31399964835dd8d7e18caf13d9601d6085b5`。
- 两次复制均触发真实 Chromium `copy` 事件，核对选区中完整的制表符文本和按键焦点。自动化拦截向 Windows 系统剪贴板的写入。候选 01 的沙箱表单失败和 02 的主题识别差异均保留为开发证据，候选 03 通过。
