# JSON 文件格式化、压缩与校验

跟踪 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)。这是独立开发中的文件子范围，补齐已有 JSON 工具 8 KiB 内联文本之外的文件使用方式。旧的内联文本和 JSON 文件查询/对比插件继续沿用原合同。

| 操作 | Capability | 输出 |
| --- | --- | --- |
| JSON 文件格式化 | `devtools.json-file.format` | 两空格缩进的完整 JSON |
| JSON 文件压缩 | `devtools.json-file.minify` | 完整紧凑 JSON，支持所有根值类型 |
| JSON 文件校验 | `devtools.json-file.validate` | 严格策略范围内成功时返回独立 `{"valid":true}` JSON 报告 |

用户选择 UTF-8 文件、明确确认共享、再主动执行。输入最多 1 MiB、结果最多 8 MiB、容器嵌套最多64层。新文件插件复用 `zi-text-core` 严格解析器，独立版默认文本模式保持原行为。对象键顺序和数字词形可以规范化；数值的精确十进制值必须可以无损往返。重复键、安全整数范围外的数字、不能精确往返的小数和过深结构返回 `JSON_POLICY_REJECTED`，提示具体支持限制，不将其称作语法错误。真正的语法错误返回 `INVALID_JSON`；无效 UTF-8、输入/输出超限分别拒绝，不截断产物。

原文件只读。结果的完整 UTF-8、字节数及 SHA-256 由现有资源机制确认；需要磁盘文件时，必须另行审核并确认保存，新建 `.json`，不覆盖源文件或已有目标。取消确认不写入，重复确认返回同一收据。权限撤销后不能继续读取原资源。

## 独立合同

- 插件身份 `com.zicode.devtools.json-file`，仅上述三个单文件 capability。
- 执行 profile `resource.wasi.json-file-transform.v1@=1.0.0-preview.1`，与旧 `resource.wasi.json-file-compare.v1` 分开，不能互相冒用。
- 输入 `resource.wasi.input.draft2`，输出 `resource.wasi.output.draft1`。只接受 `application/json`、`text/plain`、`application/octet-stream`；内容必须严格满足 UTF-8 JSON 策略。
- 沿用 JSON 文件执行的原预算：64 MiB、40亿 fuel、10秒；输出用既有 `JsonCompare1` 内部 JSON 资源线格式，共享资源预算不变。通用插件不因此获得 MIME/限额升级。
- Host 独立拒绝重复键、超深、不可精确往返的源值/输出值；校验成功也必须重新解析实际源输入。格式化和压缩还比较源/结果结构，不能仅凭 Worker 报告把数据认定有效。
- 前端只为精确协商的 profile 显示 1 MiB 文件选择限额和最多 8 MiB 的完整惰性预览。

## 交付

提供方独立分支 `codex/json-file-format`，源码 `8476912755c0373660296aae358380df4f261689`。无签名候选 `json-file-0.1.0-candidate-02`，7文件，目录索引 SHA-256 `2bfa0a11291d4c291f50b2ecca042b42256817a5ff33b24861d5f4040107e2ad`；模块 SHA-256 `244ac722fce1b1fec7d1d34ad79e7c21d8936aa56480cc12e0d8c307742af312`。

候选01与原始失败均保留。实际已发布/冻结的 v0.6.4 源码、安装器及收据未改，日常资料库未迁移；新 profile 须由后续集成源码提供，不能将此候选描述成已包含在旧安装器。签名、其他系统及原生窗口操作不阻挡本机自动化范围；原生文件选择/保存体验随主会话统一验收。
