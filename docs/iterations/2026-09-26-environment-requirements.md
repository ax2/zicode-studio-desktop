# 2026-09-26 开发环境版本要求匹配

状态：实现与定向验证完成，视觉及非 Windows 实机验证待补。整体平台目标继续推进。
上一轮完成运行器 Windows 路径修复和专项验证，本轮推进项目启动前的环境判断。

## 目标与设计

- 对 package.json engines 与 packageManager 声明进行 npm 语义版本匹配。
- 区分满足、不满足、工具缺失、探测失败、未知工具、无效/截断声明；未知不得显示通过。
- 检查仍为只读版本命令，不运行项目脚本，不安装工具或依赖。Corepack 禁止网络和自动下载。
- Bun 使用与项目任务相同的可执行文件选择；npm/pnpm/yarn 补充版本探测。
- 复用进程树管理，避免版本命令超时留下子进程。
- Python/Rust/Go 清单目前只识别存在，不借 JavaScript 比较规则宣称满足其他语言要求。

## 实现与决策

- 新增独立 `environment-requirements.ts` 纯比较模块和 `EnvironmentRequirement.tsx` 展示组件，
  环境页按清单逐项显示结果与修复提示。使用标准 `semver@7.8.5`，类型包 `@types/semver@7.8.0`，
  通过 Bun 精确锁定，安装时禁用生命周期脚本；只按所需函数导入。
- 支持 npm 区间、逻辑或、`^`/`~`、通配符和预发布规则；packageManager 要求完整精确版本。
  build/integrity metadata 不参与 semver 优先级，界面明确不验证哈希完整性。
- 只接受完整版本字符串；警告文本中的数字、未知格式和达到报告截断上限的输出不会强制转换成版本。
- Host 清单报告新增 `truncated` 字段，错误 JSON 类型标记 invalid；旧 Host 的 200 字符边界也保守跳过。
- 增加 npm/pnpm/Yarn 固定 `--version` 探测；Bun 与任务执行共用工具来源。
  使用相同的 Windows Job Object / Unix 进程组，维持三秒超时与单路 16 KiB 上限。
- 探测在临时目录运行，禁用 Corepack 网络、项目版本选择与下载提示，保留原有 Node/Python 注入环境清理。
- 中英文帮助、平台推进计划与实现状态已同步；任务执行入口仍允许用户选择运行，不把诊断结果当强制门禁。

## 检查证据

- JavaScript 比较单测 17 项覆盖区间、预发布、精确包管理器、完整性元数据、缺失/失败及截断；
  环境组件增加不匹配/缺失/截断的显示验证。项目与网关定向测试合计 69 项通过。
- Rust 清单增加截断和错误类型用例；真实 Host 环境报告验证九类工具，Windows `.cmd` 用例覆盖版本命令。
  `bun run check:rust` 通过：306 项测试通过 / 3 忽略，cargo check 与 Clippy 通过；全库 fmt 仍有既存 advisory。
- 类型检查、React/CSS 产物构建、Windows 子进程规则、中英文覆盖检查通过：2160 个键、0 缺失。
  `bun run check` 无错误，111 条既存警告 / 7 条信息，新模块定向 Biome 检查通过。
- 尚未完成浏览器/WebView 视觉检查；最近 CUA Edge 接口连接仍失败。macOS/Linux 没有本轮实机证据。
- 无项目构建/依赖安装保证；Python/Rust/Go 要求、虚拟环境及交互终端继续列为后续能力。
  未发布、推送或生成安装包/ZIP。
