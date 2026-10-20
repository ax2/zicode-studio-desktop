# Pi 插件业务失败标记（2026-10-18）

## 目标与发现

Studio 的手动工具中心已把提供方 `ok:false` 视为业务失败，不写入最近成功；Pi Broker 的同类响应却只返回 JSON `content/details`，未设置 Pi 1.3.0 `AgentToolResult.isError`。模型与程序化调用方可能把该次调用视为成功。失败响应若异常夹带 `resultRef`，旧逻辑还可能在 `details` 添加接力入口。

## 修改

Pi Broker 的通用结果适配在顶层 `ok === false` 时设置 `isError:true`。原始业务 JSON 仍保留在 `content/details`，不输出插件原始错误为 Host 传输错误；失败结果不附带 `studioResult` 引用。成功路径的文本/JSON 引用、Host 捕获与确认接力协议不变。用户暂不启用的 JSON Object 插件及 `pi.tools.register` 未改。

## 验证与边界

- 新增失败响应附带异常引用的回归，确认 Pi `isError:true`、原始内容不变、详情无接力引用；结果适配及 Broker 定向 5/5 通过。
- `bun run typecheck:extensions-source` 和 `bun run check` 退出 0。全仓 lint 仍有其他文件的 147 条 warning、10 条 info；设计检查有一条既有 inline-style warning。
- `bun run build:extensions` 通过；冻结的 `plugin-broker.mjs` 为 22,567 字节、SHA-256 `3ABD05B5583E30637A620CE4FE71BC0069B264FFA4AC6FC4CF1290360DD6783A`。内嵌 Pi 1.3.0 Windows EXE SHA-256 `EB2205E842D1B02A1A539E98618B20D6B055A008FA0B678EBBBEB004239F1365`。隔离 RPC 加载此 Broker 后，探针命令调用已注册工具：业务失败 `isError:true`、原始 `content/details` 保留、无引用；成功 `isError:false`、引用保留；两次合成请求均绑定预期路径和运行身份。驱动退出 0，Pi 进程无残留。证据在技术博客 `iterations/pi-business-error-2026-10-18/evidence/`；`evidence.json` 为 524 字节、SHA-256 `5730B2834022D0CDE2E573291D02F65961141B5CF4B98599ADC4080A5BBA3FD8`。
- 这证明真实 Pi 注册和直接工具返回语义，不代表模型自主选工具、真实 Studio Host/Worker、正式签名 DevTools 包或其他 OS 已运行。DevTools 完整接受仍 0/154，ZiFile 0/108。

## 存储与发布

本轮无 Rust 构建、插件安装、自动缓存删除、应用版本号变更或发布产物。用户先前说会手动清理旧增量目录；本轮观察到目录消失且 Debug/Release EXE 仍在，另见[清理复核](2026-10-18-manual-incremental-cleanup-observation.md)。稳定清理后与扩展打包/探针后的只读扫描中，`target` 均为 27,251,694,764 逻辑字节、task-scratch 均为 1,411,021,038 字节、未知项均为 0；E: 可用 11,711,250,432 → 11,606,360,064 字节。卷差额不可全归于本轮探针；两次因低于 20 GiB 建议储备退出 1。
