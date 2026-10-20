# 大量 View 应用的目录分类与按需打开

## 发现与目标

Studio 当前侧栏仅固定少量核心入口，外部 View 应用通过工具中心打开，不会逐包增加图标。工具中心已有搜索、分类、收藏、最近和每页 40 项；但外部应用没有结构化类别声明，大量 ZiDevTools View 包会集中落入“其他应用”。Spring Actuator candidate-02 是当前真实例子：它只有 View，没有 capability 或活动级目录元数据。

## 修改

新增接收侧预览合同 [`application.directory.v1`](../plugins/application-directory-v1.md)。schemaVersion 2 插件可在首个 activity 的 `directory` 声明共用 12 类任务分类、至多 16 个别名和有界用途描述，并在 `requiredProfiles` 精确声明 `=1.0.0-preview.1`。Host 安装校验拒绝缺 profile、错误版本、未知类别/字段、超界或控制字符文本、规范化重复别名，以及非主 activity 的目录声明。前端只把已验证的 activity 元数据投影到既有应用目录；搜索别名、分类和展示用途，不加载 View 或执行能力。旧清单保留“其他应用”兼容展示。

只读 JS 清单预检同步检测 View-only activity 缺少 profile 的情形。分类名称沿用 `tool.directory.v1` 的统一中英文标题，不增侧栏图标。该扩展不会把 View 包变成“单项工具”；完整工具仍要求可调用 capability 和执行合同。

## 验证与遗留

Rust 有界元数据专项、前端注册表投影/目录分类/预检合成测试已加入。当前源树静态检查和定向测试证据见技术博客同阶段工作日志。另以真实 ToolCenterApp 组件和项目样式、四条合成应用数据渲染 826×1084 桌面预览，检查双列卡片、类别及用途说明的可读性；截图保存于技术博客本阶段 `screenshots/`，这不是原生 Studio 或提供方实包验收。Spring candidate-02 已冻结，不修改；已将下一独立版本的目录声明、版本提升、包外收据及功能范围差距要求发送至授权的 ZiDevTools 原会话。没有真实提供方新版包或原生分类界面截图，因此不能声称其已完成分类验收。154 项完整工具接受仍 0。

新增 Studio 自有合成 View 插件的真实 Host HTTP 专项：在隔离 Host 中安装开发插件，`summary=true` 列表在默认禁用时仍保留分类、别名、用途；禁用时 View 源请求返回 403，启用后可取得 HTML，再禁用恢复 403。定向测试 1/1 通过；Cargo check 和严格 Clippy 通过。该测试没有运行 ZiDevTools 代码，也没有原生窗口截图、真实插件工具执行或结果接力，因此不提高提供方接受数。

工具中心的完整应用目录现保留**已安装但禁用**的外部主视图应用，显示“已禁用”和“管理插件”，不提供“打开”；内置禁用项、客户端不可用项和无主视图包仍不进入此目录。这使用户能在同一目录搜索到已安装应用并理解为何不能打开，不改变插件启用或权限。`tool-navigation` 与 ToolCenterApp 定向测试 10/10、前端类型检查通过。以合成数据在 1280×720 浅色组件页实际截图，检查禁用状态、管理入口和正常应用卡片布局；技术博客保存 `disabled-application-directory.png`。临时预览页与本地服务已清理；原生 Studio、真实 ZiDevTools 包及其他主题/视口仍待验。
