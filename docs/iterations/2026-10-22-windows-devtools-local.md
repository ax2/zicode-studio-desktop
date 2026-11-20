# ZiDevTools 插件在 Windows Studio 中的本地交付

日期：2026-10-22。

已恢复并导入当前 `D:\work` 本地编译的 Studio，5 个插件已启用，共 51 项操作。正常启动脚本重启后仍能发现全部插件，窗口正常响应。

| 插件 | 版本 | 已验证操作 | 自动化用例 |
| --- | --- | ---: | ---: |
| 文本工具 Text | 0.4.1 | 7 | 20 |
| 格式检查 Inspect | 0.1.2 | 8 | 102 |
| 文本转换 Transforms | 0.1.1 | 23 | 155 |
| Java/Python 堆栈分析 Trace | 0.1.1 | 2 | 40 |
| 诊断报告 Diagnostics | 0.1.4 | 11 | 11 |
| 合计 | | **51** | **328** |

另有 25 项检查通过：工具中心逐包发现、未携带桌面令牌调用被拒绝、禁用后拒绝、重新启用后恢复执行、声明的 View 源可加载。成功用例实际经过正在运行的 Studio Host、生产 EXE Worker 和候选 WASI 模块，不使用模拟计算结果。文本结果与候选预期精确比较；诊断报告样例验证成功及输出为可解析 JSON，未宣称全面验证诊断算法。

候选来源为 Studio 仓库冻结的 ba45d264 目录对应包，逐文件大小、SHA-256 和目录索引均已核验。恢复副本在 `D:\work\zi-devtools\release`；实际安装在 `D:\work\local-state\zicode-studio-desktop\data\plugins\developer`。仅操作这份本地 Studio 的隔离配置和 programming 场景。

在 Studio 工具中心搜索 Base64、JSON、YAML、URL、SHA-256、Java 等即可使用。五包的 `pi.tools.register` 权限已授权；本轮未执行模型请求，也未额外声称完成 Pi 自主选工具验证。当前隔离配置仍不使用原有模型凭据。

通过既有开发目录安装接口导入未签名候选，没有关闭正式签名包校验。按用户要求，本次本地可用验收不以人工原生界面操作、正式签名或其他平台验证为门槛。JSON Object、资源型插件及服务型插件未纳入本次导入。51 是操作数，关联 31 个源工具 ID 的候选范围，不表示全部 154 个工具均已完整迁移。

已确认普通启动脚本 `D:\work\start-zicode-studio.cmd` 启动后 5 包仍启用；验证临时使用的本机调试接口已关闭。

测试驱动的首次尝试未支持生成式边界输入，第二次把未知操作在 Host 层的提前拒绝误计为失败；原始证据保留在本会话 work 目录。修正驱动后仅复核文本包，未修改候选字节、生产实现或预期计算结果。

证据：`devtools-windows-verification.json`、`devtools-installed-receipt.json`、`devtools-normal-startup.json`。
