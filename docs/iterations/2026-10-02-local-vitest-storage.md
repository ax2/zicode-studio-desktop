# 普通 Vitest 入口的 Node Web Storage 兼容（2026-10-02）

状态：本机 Node 26 验证通过；其他系统与旧版 Node 的真实执行待补。

## 发现与修改

Windows 本机 Node `v26.10.0`、Bun `1.3.14` 下，直接执行任务相关 Vitest 用例时，四个存储与派发文件的 26 个用例通过，而任务面板的 25 个用例全部在 `beforeEach` 的 `localStorage.clear()` 失败，尚未进入产品行为断言。设置进程级 `--no-experimental-webstorage` 后，面板的 25 个用例通过，确认问题来自 Node 原生 Storage 与 jsdom 环境初始化冲突。

跨系统统一检查入口已为 Node 25+ 设置这一参数，但普通 `bun run vitest`、`bun run test` 和 watch 入口没有共享它。现于 `vitest.config.js` 中为默认 forks worker 配置 `execArgv`：Node 主版本大于等于 25 时传入 `--no-experimental-webstorage`，较早版本传入空列表。这样直接运行和统一入口的默认 worker 都由 jsdom 提供 Storage；不修改测试断言、产品存储实现或浏览器环境。使用其他 Vitest pool 的调用仍需单独核对。

## 验证

未设置额外 `NODE_OPTIONS`，再次执行：

```powershell
bun run vitest run extensions/task-repository.test.ts public/super-agent/task-store.test.js public/super-agent/native-dispatch.test.js public/super-agent/task-state.test.js public/components/super-agent-runtime.test.js
```

五个文件、51 个用例全部通过，包含真实双进程同版本提交竞争。该结果证明本机默认 forks 入口和这些既有用例通过，不证明完整测试集、其他 Node 版本、三平台安装包或实际后台 worker 生命周期。

`bun run check` 退出 0，静态规则与设计检查通过；仓库仍有 124 条 warning、7 条 info 和一条生成终端代码的内联样式 advisory。此次未改 Rust，未产生 Cargo 编译目录。
