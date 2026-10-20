# 工具直达绑定目录修订（2026-10-18）

## 发现与修改

Studio 工具中心向外部插件主 View 直达具体能力时，原有检查绑定工作区/运行会话和插件版本。若目录在异步应用切换期间刷新，而目标插件仍报告同一版本，旧目录选择可以继续向新 View 发送 `openTool`。同版本的开发插件重新加载、权限或其他目录变化都可能造成这类旧选择。

本轮在工具中心渲染时捕获 Studio 的 `catalogRevision`；发送定位前后均与当前修订比较。修订变化时提示用户重新加载工具详情，不发送 `openTool`，也不执行能力或写入最近使用。沿用既有错误文案，无界面结构或新权限变更。

## 验证

`plugin-shell.test.js` 38/38 通过。新增专项在点击“打开应用”与异步切换完成之间触发同版本目录更新，确认目标版本保持 `0.1.0`、旧定位未发送、能力未执行，并出现既有的重新加载提示。该测试与上一轮回执后记录最近使用的外壳集成测试共同覆盖目录选择时序。

回归后来收紧为在 `zicode:active-plugin-changed` 事件中更新目录，即应用激活已发生、异步 `activateFromNavigation` 尚未返回时触发，从而明确覆盖发送前的第二次修订核对；最终仍为 38/38。

`bun run check` 退出 0，仓库仍有 147 个既有 lint warning、10 个 info 和 1 个设计提示。定向 `git diff --check` 退出 0，仅有 Windows 换行提示。没有 Rust 修改、本地 EXE 构建或新截图；本轮只验证前端逻辑，不将其记为原生窗口、真实提供方同版本更新或 macOS/Linux 验收。

## 接入与磁盘边界

只读搜索 `E:\zi-devtools\release` 的正式 `.zicode-plugin` 数量仍为 0。ZiDevTools 154 项与 ZiFile 108 格完整验收仍为 0。用户暂不启用的 JSON 对象插件和 `pi.tools.register` 未改变。

本轮前置预算扫描完整，Studio `target` 30,040,567,930 B、task scratch 1,412,244,590 B，`UnknownEntries=0`；E 卷空闲 1,258,536,960 B，预算因低空间退出 1。此前被审批拒绝的缓存目录没有重试。未运行 Rust 构建或复制 Debug/Release 运行目录。

后置预算两项 Studio 目录逻辑量不变、`UnknownEntries=0`，E 卷空闲 1,080,373,248 B，仍因低空间退出 1。卷空间变化不能据此归因于 Studio。
