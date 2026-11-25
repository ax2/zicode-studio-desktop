# v0.7.9 · JDK 环境报告查看

在 ZiDevTools 独立版「JDK / 构建环境诊断」保存 JSON。Studio 插件管理审核并启用 0.1.0 后，到工具中心搜索「JDK 环境报告查看」，选择并确认一份本机报告。可查看报告中的一套或两套历史环境、版本、供应商、架构、`javac` 和构建入口快照。`JAVA_HOME` 按采集时记录显示一致、不一致或未判定。可预览并明确确认另存脱敏 TXT。

每次限一份 32 KiB UTF-8 JSON，使用现有 `resource.read`。工具核对独立版报告格式和原版版本字符串比较规则。输出省略原报告的绝对路径、备注和指纹。Studio 在此入口只读已确认的快照。执行 Java、发现系统入口及当前环境探测等原生范围继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `ff0956ec11201f4e2333c22e47a30d00fe6664ce` 随 [ZiDevTools #43](https://github.com/ax2/zi-devtools/pull/43) 合入。真实 Windows Worker 和原生适配器 23 项通过，包括单／双 JDK、三态、版本后缀、错误指纹、脱敏和精确 32 KiB。独立版定向报告导出测试 1 项通过，使用合成输入。Worker 回执 SHA-256 `303e2a69505e3f82b1ee66931b032885547b796e34659e60ef94bf4354d71f8d`。
- 冻结包 8 件、260,580 字节。目录索引 SHA-256 `7a3d762fd831e6d686262bcfe958c623fedfe0bdcfb6d1a77115060dcf2332eb`，WASM `7e93a0013d85ad05b0a602847cb65f0ab780d019a18cc551ac386e35cd8ddb53`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/jdk-report-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/jdk-report-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 通过真实工具中心、Host 和 Worker 核对两份报告。比较样本的 21.0.3+9 与 17.0.12 显示为不同，单环境显示未采集对照。确认授权、取消保存、撤权、错误报告拒绝及重启复算通过。已保存的 374 字节严格 UTF-8 报告经独立读回与预期一致，原报告摘要保持。系统原生选址和任意位置另存继续集中验收。
- 首装、重启及独立读回回执 SHA-256 为 `1cce5cdb86df22ef0e72f110e8fd557f13e452ee4174b24f8bec1862e433a530`、`48d1011ffe2addffea1a2db338d950ab1cceebaa3bc01f07f10eb1a4c097088f` 和 `7061d5d8c040a02de3094b95d7a1121e7dd66583cd117f4755aee738caa86a8a`。
