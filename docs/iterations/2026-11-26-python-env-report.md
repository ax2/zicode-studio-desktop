# v0.7.9 · Python / Django 环境报告查看

在 ZiDevTools 独立版「Python / Django 环境」保存 JSON。Studio 插件管理审核并启用 0.1.0 后，在工具中心搜索「Python / Django 环境报告查看」，选择并确认一份本机报告。可查看一套或两套历史解释器、虚拟环境、Django 分发版本、模块来源的记录状态以及采集时的 django-admin 入口对照。可预览并明确确认保存脱敏 TXT。

插件读取一份最多 32 KiB 的 UTF-8 原生报告，使用现有 `resource.read`。分发版本与模块记录分别呈现，「未记录差异」沿用原报告语义。结果省略解释器、环境、模块及脚本路径、原备注和指纹。当前环境探测、运行 Python 或 Django、读取项目配置仍按原生范围由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `6e46359a57a8246e4fab0128332c1952aab3f476` 随 [ZiDevTools #44](https://github.com/ax2/zi-devtools/pull/44) 合入。真实 Windows Worker 和原生适配器 25 项通过，覆盖单／双环境、Django 分发与模块的独立状态、入口三态、格式与指纹错误、脱敏和 32 KiB。实际原生报告序列化定向 1 项通过。最终 Worker 回执 SHA-256 `1b30028dcdc8fc6899602aad2641d529beda94f7e2e52a25ef84c446bfcd46dc`。
- 冻结包 8 件、265,084 字节。目录索引 SHA-256 `6c497daf761458fde94aab9dd1d3d855e74e4a5a6b1cfc9d224ae7641f9c0a28`，WASM `c51d4de6e787fc2c2cee6f51f3951102201135d4fdddc0f782844ad6ab8ad158`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/python-env-report-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/python-env-report-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 使用实际工具中心、Host 和 Worker。验证单／双环境、确认分享、无效报告和取消。确认保存后独立读回 449 字节严格 UTF-8 TXT，核对 Python 3.12.8、3.13.2 与 Django 5.1.7，输出没有原件路径、备注或指纹。撤权清除结果，重启重新确认后复算，源报告摘要保持。系统原生文件选择和自选保存位置继续集中验收。
- 首装、重启及独立读回回执 SHA-256 为 `ae4b9a868d130d02e8a3f1499071edc85ace71b15b609e9a0c20bad604d5ea86`、`14ff5e1e82fef29c8313e8eecc1951f476c0a8efd5af94a5db4cebf2b0fce1da` 和 `0cea021e7c383a7e2cb7781352a8e2a9a44ea939eb58107e0a876c1c49fec51f`。
