# JSON 工具原生表单与 HTTP 审计错误提示

## 原生观察

当前 Windows Debug 的隔离 Studio 主窗口可在具体工具目录中发现已安装的 ZiDevTools JSON Object 0.1.0 两项能力。打开“JSON 对象摘要”后，工具详情按需加载成功，显示 `value` 必填 JSON 对象输入框和 32 KiB 提示；此前误报“需要额外宿主支持”的提示已消失。窗口仍显示“插件已禁用”，执行按钮不可用。未更改启用或权限状态，也未执行该工具。此次截图仅在 Computer Use 会话中检查，未形成档案截图文件。

用户手动启用该隔离插件并允许 `pi.tools.register` 后，仍需继续真实桌面执行、结果展示、对象转交、确认保存及撤权复核；这次表单观察不能替代完整闭环。

## 错误提示修正

HTTP GET 插件服务审计不可用时，Host 会返回稳定的 `http_service_audit_unavailable`。父 View 的公开错误白名单此前遗漏此码，插件端只能看到笼统失败。本阶段加入该码和 `http_service_unavailable` 的固定、无路径提示；任意底层错误文本仍不越过隔离 View。改动只涉及前端错误映射，当前运行的 Debug EXE 尚未包含它。

## 验证与边界

`public/native/plugins/plugin-view-errors.test.js` 4/4 通过，覆盖私有路径不透出与固定恢复提示；`bun run check` 退出 0，仓库其他文件仍有 147 个 warning、10 个 info 及一处既有设计提示。前后只读空间扫描完整，未知项 0；`target` 都为 30,026,355,068 B，未清理缓存或生成新 Windows 发布目录。E 盘卷级可用空间变化不能归因于本阶段。正式 DevTools 154 项完整接受仍为 0，其他系统和已启用状态下的原生流程待验。
