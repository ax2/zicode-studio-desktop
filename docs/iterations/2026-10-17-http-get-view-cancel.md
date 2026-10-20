# 插件 View HTTP GET 取消链路（2026-10-17）

## 发现与修改

现有可信父页面已经处理 `cancelRequest`，并可调用 Host 的 `http-get/cancel`；但沙箱 View 的 `services.http.get(input, { signal })` 虽接收 options，却仅为模型生成连接了 `AbortSignal` 和 View 等待超时。HTTP GET 的用户中止或 View 超时可能只结束前端等待，未向 Host 发取消信号。

现将 HTTP GET 纳入 bridge 的取消消息路径：主动中止发送一次 `cancelRequest` 并继续等待原 Host 终态；30 秒 View 等待超时先请求 Host 取消，再以 `plugin_view_timeout` 结束本地 Promise。预先中止的信号不发请求；请求发送与监听器安装之间发生的中止也会补发取消。没有扩大插件可访问的 Host 接口、网络权限或输出数据。

## 验证与边界

- View bridge 的 4 项定向用例通过：主动中止、超时、预先中止、发送过程竞态。
- 现有父页面集成用例增加 HTTP GET 取消转发，两个相关测试文件合计 20/20 通过；检查 owner 与 operationId 传给取消网关，并等原 commit 返回终态错误。
- `bun run check` 退出 0，仓库原有 lint/design advisory 保留。新测试文件独立 Biome 格式检查通过；两个原有大文件此前已有格式漂移，未对其余内容做全文件重排。
- 此次是前端 bridge 与模拟网关验证，没有重新构建 EXE、没有真实网络请求或新的跨平台运行证明。Host 取消路由此前已有独立测试；仍需真实 DevTools View 包、用户确认、原生窗口及 Windows/macOS/Linux 的完整链路验收，完整工具接受仍 0/154。
- 前后只读空间扫描 `target` 均为 29,407,426,464 B，task-scratch 均为 848,816,139 B，未知项均为 0；E 盘可用从 48,659,726,336 B 到 48,658,493,440 B。卷余量变化不归因于本阶段，没有清理文件或重试先前被审批拒绝的目录。

## 同日补充：确认弹窗在途取消

进一步核对发现：View 请求在等待可信父页面的 HTTP GET 授权弹窗时，Host 取消虽然撤销 grant，弹窗仍可能保持到超时。现把此请求的取消信号传给现有 `showNativeDialog` 的 `dismissSignal`；在等待确认期间收到 `cancelRequest`，先关闭该弹窗并按拒绝处理，再将原 Host 操作取消。确认、取消和提交仍沿用同一 operationId，且取消后不会提交授权。没有更改插件权限或 HTTP 请求范围。

定向测试最终 25/25 通过，覆盖 View bridge、父页面取消，以及授权弹窗等待期间取消；`bun run check` 退出 0。曾有一项旧断言因新增第三个取消参数失败，更新调用约定断言后重新执行全部定向测试通过。`bun run build:local` 成功，复用 `target/debug` 生成 Debug EXE，没有新安装包、ZIP 或版本号变化。启动该 EXE 的隔离 tools-only 窗口并检查实际截图，工具中心基础画面可见；此截图没有展示 HTTP 授权弹窗，因此不能视为弹窗关闭的真实 WebView 验收。独立 Debug 进程验证后已停止，已安装版本进程未动。DevTools 真实提供方包、真实 HTTP 确认/取消和跨平台完整链路仍待验收，DevTools 工具接受仍 0/154。

远端 `main` 合并 SHA 为 `9cf5fd0b108ce59b3661a7d90a829a182984df8a`，tree 为 `67703af125e44ee628909fa63a9d7979acabdef5`；此前 Pi 1.3.0 四平台组合 CI 所检出的 `caaff94fa91eab97f09d0e43b4cc5542da741cef` 具有相同 tree。此等价只覆盖远端合并树，不覆盖本地未提交的插件变更。

本轮构建后只读扫描退出 0：`target` 29,407,499,061 B，`.cache` 355,458,670 B，task-scratch 852,839,902 B，site 29,644,753 B，所有扫描树 UnknownEntries=0，E 盘可用 48,666,656,768 B。扫描值相较构建前有增量；卷可用量同时受其他进程影响，不能据差额推算构建净占用。本轮实际删除 0 文件、0 字节；之前 `blocked by policy` 的路径没有重试。`git diff --check` 退出 0（仅 Git 换行提示）。

## 同日继续：真实弹窗组件级验证

检查 `showNativeDialog` 源码时发现迟到的 `dismissSignal` 会重复执行 `finish`：若用户先确认并打开另一弹窗，旧信号可能卸载、清空新的容器。给单次弹窗加结束状态保护，避免同一对话框多次清理。使用实际 React 弹窗组件验证 HTTP 确认取消后界面隐藏；另验证第一弹窗确认后，迟到的取消不关闭随后打开的第二弹窗。重新生成 `public/native/react/` 固定输出，没有新建编译目标或发行副本。相关 4 个测试文件最终 33/33 通过，`bun run typecheck` 与 `bun run check` 均退出 0；首次测试将地址误判为标题内容，改为检查弹窗正文后重跑通过。此验证为 jsdom 中真实组件渲染，仍不是原生 WebView2 内的 HTTP 实例验收，亦不等同于 DevTools 全工具接入。

组件补验前后只读存储扫描均完整、退出 0：`target` 均为 29,407,499,061 B，`.cache` 均为 355,458,670 B，task-scratch 均为 852,839,902 B，site 均为 29,644,753 B，UnknownEntries 均为 0。E 盘可用从 48,656,470,016 B 变为 47,832,260,608 B；本项目树逻辑量未变，不能把卷余量变化归因于本次检查。未删除文件，也未重试审批拒绝路径。
