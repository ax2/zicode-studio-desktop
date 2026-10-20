# 外部插件 View 同步渲染失败隔离（2026-10-18）

## 目标与发现

普通应用导航在设置 `activePluginId` 后渲染外部插件侧栏和主 View。View Host 已处理异步页面加载失败，但同步 `renderNavigation`/`renderContent` 抛错会中断切换，可能留下半渲染的插件界面。此前工具目录入口虽捕获异步错误，不能恢复普通导航。失败标题样式还引用了未定义的 `--danger`，实际像素呈灰色。

## 修改

- Studio 外壳分别捕获外部插件侧栏和主 View 的同步渲染异常，清除半渲染内容并显示现有错误面板，不展示异常原文。
- 主 View 失败时撤销该插件 View Host 的活动实例，标记本次渲染失败。工具目录直达在应用切换后读取该标记，不再向失败 View 发送工具定位。聊天和其他工具入口保持可用；下一次导航会重新尝试渲染。
- `plugin-view-host.css` 的错误标题改用已定义的 `--error`，生成的 `style.bundle.css` 同步更新。未改插件权限、运行时或提供方代码。

## 验证

`plugin-shell.test.js` 36/36 通过。新增同步侧栏/主 View 双故障注入确认：固定失败提示、工具定位 0、能力执行 0、异常原文不进入提示、聊天与工具中心继续可切换。`bun run check` 退出 0；仓库现有 147 lint warning、10 info、一个设计提示。`git diff --check` 退出 0，只有 Windows 换行提示。

使用原 `target/debug` 两次 `bun run build:local`，第二次把颜色修正同步进 Debug 完整运行目录与 EXE；没有新版本号、安装包、ZIP 或第二份运行目录。源 `public/style.bundle.css` 与 `target/debug/public/style.bundle.css` SHA-256 均为 `B3D8B19E841BF8B1D1E4D12F2F692FEAA26F06E440F7A9AD6817856BC180F0EB`。

Windows 隔离 Debug 1442×931 真窗口截图核对工具中心正常布局，见技术博客 `screenshots/Stage-2026-10-18-view-failure-isolation/desktop-native-tool-center.png`。另外用当前 CSS 和同样的错误面板标记制作隔离浏览器可视夹具，桌面默认视口与 700×850 窄视口截图均检查标题变为醒目的错误色、主面板未溢出，见同目录 `desktop-synthetic-error.png` 与 `narrow-synthetic-error.png`。窄视口夹具模拟侧栏收起；这两张是样式夹具截图，不是原生插件抛错实录。真实原生插件同步崩溃、macOS/Linux 仍待验收。

## 磁盘与遗留

本轮启动的本地 HTTP 可视服务已停止、临时浏览器标签已关闭。自动审批以 `blocked by policy` 拒绝删除项目内临时夹具 `E:\zicode-studio-desktop\.cache\task-scratch\view-failure-visual-20261018`；未换方法重试。夹具约 446 KB，仅有 `owner.json` 与 `index.html`，可由用户核对后手工清理。先前已被拒绝的其他清理目标未触碰。

构建/测试前后只读预算均 `UnknownEntries=0`。`target` 逻辑量 `30,036,693,723 → 30,040,567,930 B`（+3,874,207 B），`.cache/task-scratch` `1,411,769,084 → 1,412,244,590 B`（+475,506 B，包含保留的可视夹具）。E 卷空闲 `8,195,149,824 → 4,669,382,656 B`（-3,525,767,168 B），与已扫描项目树增量不相符，不能把卷变化归因于本轮构建，也不能据此删除有用缓存。预算脚本因既有容量及空闲门槛退出 1。后续应先查明卷级差额来源，再考虑任何额外大构建。

预算后 E 卷空闲又降至 `2,485,379,072 B`（2026-10-17 21:32:30 UTC）。只读进程检查见另一个 `E:\zi-devtools` 仓库的两个 `cargo test` 正在运行，其 `target/debug/deps` 和 EXE/PDB 在同一时段更新；这支持“其他工作也在写 E 卷”，但没有前后目录体量，不能把全部卷差额定量归于它。本会话没有修改、终止或清理 DevTools。因可用空间继续下降，本轮不再启动额外大构建。

Inspect 0.1.2 隔离安装确认未收到，旧文件夹选择已取消，没有安装候选。用户暂不启用的 JSON 对象插件和权限保持原状。提供方仍无正式签名 `.zicode-plugin`；ZiDevTools 完整范围 0/154、ZiFile 0/108，跨平台实机与全链验收仍待。
