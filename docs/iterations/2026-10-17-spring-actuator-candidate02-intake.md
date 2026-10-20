# Spring Actuator candidate-02 冻结与 Host 接入核验

## 范围与来源

Studio 从 ZiDevTools 的 `release/plugin-candidates/spring-actuator-0.1.1-candidate-02` 只读取得一份无签名评审目录，冻结到 `tests/fixtures/devtools-spring-actuator-candidate02`，包外收据保存在同级 `*.verification.json`。只修改 Studio；提供方原目录未改动。候选清单 schemaVersion 2，插件 ID 为 `com.zicode.devtools.spring-actuator`，版本 0.1.1；只含 View，要求 `service.http.get.v1 = 1.0.0-preview.1`，可选权限为 `service.http.read`，没有 WASI 或 Pi 工具声明。只覆盖固定的 health、info、metrics GET 子集，不代表独立 DevTools Spring 工具全部能力。

Studio 的目录核验脚本在源目录与冻结副本均得到 42/42 文件、130,016 字节、索引 SHA-256 `A09C732DD4C1518DF1EBBC080FCA33AD793FA9C0592F304DEC1F8D5C7A6B72C1`。目录索引仍为 `encoding-unverified`，签名未验证，`runtimeAccepted=false`；它不是可发布的 `.zicode-plugin`。

## 本轮修改与验证

新增真实 Host 定向测试，使用冻结候选原样安装到测试专属注册表，不写用户隔离配置。测试验证：禁用时 View 路由返回 403；启用后可加载真实 `views/main.html`，其中使用 SDK HTTP GET，CSP 禁止 View 自行连接；未授予 `service.http.read` 时准备请求返回 403；测试注册表授权后，准备阶段无网络连接；显式确认后 Host 发出固定 `GET /actuator/health`，不带 Cookie/Authorization，接收本地服务 HTTP 503 JSON 并保留 `DOWN` 为诊断结果；再次停用时 View 路由回到 403。测试运行 1/1 通过，成功后清理自己创建的 `.cache/task-scratch` 目录。

这是候选清单发现、View 源加载和 Host 服务路由的真实代码路径，确认与原生界面交互仍由测试请求模拟。它不证明用户在 View 点击确认卡、结果展示/接力、Pi 自主工具调用，也不证明签名安装或其他系统运行。用户明确选择暂不启用另一份 JSON Object 隔离插件；本轮没有更改其状态或权限。

## 遗留

提供方需交付经授权签名的独立包和稳定包外收据，补齐真实 View 操作、错误/取消、输出传递、完整独立工具范围和跨平台证据。具体接口缺口：独立版有后台任务中心状态、报告工作台详情和用户主动导出含工具版本及便携环境指纹的 JSON；当前 manifest 的 `capabilities`、`commands`、`piTools` 均为空，且任务与结果资源 proposal 未列入 `requiredProfiles`，所以 Studio 工具目录无法将它作为可搜索、可按需执行的 Spring 工具，任务及导出也不能声称已接入。提供方后续应声明稳定的工具能力 ID、输入/输出 schema、发现分类、权限及错误/取消语义，并在 Studio 发布相应任务和报告 profile 后交付适配包。Studio 需完成原生界面的实际截图与用户确认链路，核对 profile 合同、真实服务环境和失败隔离。全部 154 项完整接受仍为 0；本阶段只新增 Spring 候选的局部 Host 证据。
