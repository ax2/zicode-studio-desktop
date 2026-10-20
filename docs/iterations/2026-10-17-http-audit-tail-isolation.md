# HTTP 服务审计残缺尾行隔离

日期：2026-10-17。范围：Studio 通用 `service.http.get.v1` Host，不修改提供方程序、冻结插件或应用版本。

## 发现与修改

审计追加现在要求文件同步，但异常退出、磁盘故障或外部更改仍可能留下不完整 JSONL 行。原实现重启后直接在旧文件尾继续追加，会使新旧记录连成无效行。

Host 创建审计 Writer 时现在以 1 MiB 上限读取当前文件，检查它是普通文件、每一行是完整 JSON 对象且以换行结束。发现残缺或无效行时，把原始字节整体移为唯一轮转备份，再从新的审计文件开始；旧备份依照既有单备份保留策略被替换。若文件不是普通文件、超出上限或移动失败，Writer 初始化报错，绝不把残缺内容当作请求成功。后续[Host 隔离修正](2026-10-17-http-audit-host-isolation.md)将这类错误限制在 HTTP 服务内，主 Host 继续启动。此过程不重放网络调用、不补写未知的成功终态，也不恢复原有授权。

## 验证与边界

`cargo test --manifest-path src-tauri/Cargo.toml host_server::plugin_services::http_get::tests` 12/12 通过，包括残缺尾行隔离、已有备份替换、恢复后的再次启动、备份路径阻塞时保留当前文件，以及真实 Host 正常/取消/审计故障路径。修改文件单独 rustfmt 检查通过；`bun run check:rust:static` 通过 Cargo check 和严格 Clippy，仓库级 fmt 既有漂移为 advisory。前置扫描完整、未知项 0：`target` 30,019,368,104 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,178,292,459 B、`site` 29,644,753 B；E 盘可用 9,449,816,064 B。后置扫描同样完整、未知项 0：对应为 30,019,426,472、355,458,670、1,257,213,382、29,644,753 B，E 盘可用 9,353,637,888 B。扫描期间也启动了新的隔离桌面验收配置；容量为共享时点数据，卷级差值不能归于此代码修改。未删除构建缓存。

需继续验证轮转中断、备份替换失败后的重试和断电后的目录元数据；本轮只保证常规重启时不在残缺尾行之后继续追加。DevTools Spring Actuator 实包、Pi/View 全链及其他系统仍待验收，完整工具接受不变。

续查：原校验会跳过日志中的空白行，已改为把每个非终止空行判为无效并增加对应单元用例。改动后 `bun run check:rust:static` 通过。普通 `cargo test` 曾因当前隔离 Debug 进程占用 `target/debug/zicode-studio-desktop.exe` 在编译阶段失败；改用同一 Cargo target 中只构建本程序测试目标的 `cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop host_server::plugin_services::http_get::tests -- --nocapture`，**13/13 通过**，包括新增空白行用例和真实 Host 路径，没有关闭用户待操作的隔离窗口。第二次后置只读空间扫描完整、未知项 0：`target` 30,019,516,056 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,257,224,053 B、`site` 29,644,753 B；E 盘可用 8,882,769,920 B。未因容量提示删除缓存。
定向测试后复扫：只读扫描完整、未知项 0，`target` 30,019,516,056 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,257,251,791 B、`site` 29,644,753 B，E 盘可用 8,883,666,944 B；卷级变化含其他活动，不归因于此测试。
格式微调后再次运行 `bun run check:rust:static` 通过，修改文件单独 `rustfmt --edition 2021 --check` 通过。最终只读空间扫描完整、未知项 0：`target` 30,019,516,056 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,257,251,791 B、`site` 29,644,753 B；E 盘可用 8,884,285,440 B。
