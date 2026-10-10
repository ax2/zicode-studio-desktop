# 资源工具的详情故障恢复

2026-10-10，Studio 前端会话能力。沿用 resource.wasi.input.draft2，不增加正式资源协议，不修改提供方包。

## 生命周期

ResourceSessionOwner 属于 ManualToolSession，拥有目录资源工具的可信 DOM 与 createDirectoryResourceRunner 控制器。详情组件提供显示插槽，不拥有控制器的最终生命周期。

React 详情渲染异常后，错误边界将原有 DOM 移入故障卡片，保留同一控制器、文件授权、参数、取消按钮、输出预览及已有保存/接力控件。没有重新上传、自动执行、自动确认写入或创建第二个运行控制器。控件的目录版本、运行时/session 身份、权限与用户确认仍由原有 Host 路径校验。

资源计算 busy 状态由会话独立持有，因此详情卸载不清除关闭限制；故障后的 beforeunload 警告仍有效。正常详情卸载没有故障插槽，会延后一个微任务销毁控制器；新的控制器会使旧释放回调失效。工具实际关闭、scope 变化或会话销毁仍执行原 destroy、撤销临时输入和回收预览 URL。显式取消提供文件仍清除临时结果，不删除用户已批准的项目文件。

控制器移动时保留 directory-resource-tool 布局样式，避免窄屏输入恢复后越界。

## 验证记录

工作档案：C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/resource-session-recovery-2026-10-10/。

新增4项owner生命周期测试和1项实际React异常/模拟controller测试，工具中心/命令面板/共享vendor及资源runner定向回归115项。实际HTTP Host+生产Worker与截图最终结果另见档案；首轮已证明故障后真实输出，保存步骤因错误按钮定位停止，不能当完整接受。

## 未解决的边界

### 最终真实运行补充

最终 focused Browser/Host 专项通过（23.22s），复用测试Host `7d6f8ca0e4e4d93b518b2f55fe4e11979896244b3a3622dbb572eb866e5b7167` 和当前完整debug EXE `6c14d757c277b87040f7c98c592e4e8380368a0ef4536d4641f38a428844ba6b`，无Rust改动或重编译。生产ToolCenter发现→按需资源详情→明确共享PNG→调用实际WASI Worker时仅注入React详情异常→原DOM移至fallback且关闭busy受保护→真实copied输出与PNG按需预览→预览保存再取消不写盘→显式取消提供文件清除临时结果，完整通过。

focused 最终页面脚本错误0、仅1个预期被捕获的注入React错误，Blob URL 1/1回收。1280×900明亮与390×844 night截图已检查，控件与状态可读，无横向越界。生产界面和实际HTTP Host验证，不是原生完整WebView。

第三轮组合浏览器流程也完整通过（Blob10/10、5次预期HTTP拒绝及2个被捕获的注入异常），但完整Host测试收尾失败：组合回归耗时超过60秒后，旧调用记录自然退休，旧记录cancel断言未满足。保留失败证据；没有改变生产保留期、执行预算或Rust断言。最终专项只运行本轮新增故障链路，沿用同一Host测试入口及其全部原有HTTP/Worker收尾检查，23.22秒内完整通过。不能把第三轮包装成全Host通过。

- 资源 invoke 丢失响应后的终态查询/重启恢复，仍缺独立 Host 协议；DOM 保留不是结束证明。
- 保存、接力 commit 丢失响应后的写入结果核对，仍需交易记录和恢复设计。不能在不确定时自动重试写入。
- 故障卡片外的参数子 root、事件回调及 JS 控制器本身异常，不都由详情 React 错误边界覆盖。
- scope/session 失效时原资源身份检查会拒绝操作；跨项目/窗口迁移既有授权未实现。
- 真实 DevTools 算法、正式 resource.v1、原生完整 WebView 与其他 OS 仍需分别验收，完整154工具接受数量不变。
