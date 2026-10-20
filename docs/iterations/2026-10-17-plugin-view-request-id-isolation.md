# 插件 View 在途请求 ID 隔离（2026-10-17）

## 目标与发现

Studio 沙箱 View 用 `requestId` 关联父页面的执行结果与取消句柄。正常 bridge 产生递增 ID，但同一 iframe 可自行发送重复 ID。旧父页面会把第二次调用当成新的执行，并覆盖第一次调用的取消映射；这样一个 ID 可对应多个工具副作用，取消也可能只作用于后一次调用。

## 修改

在每个 View 实例内记录在途 `requestId`。收到同一实例的重复在途 ID 时，不启动第二次操作，也不向该 ID 发送额外错误响应，以免旧 Promise 被重复响应抢先结束。终态处理时移除 ID；不同 View 的 ID 空间仍相互隔离。现有 32 个普通请求和 2 个取消请求的并发上限不变。

## 验证与范围

- 新增重复在途命令请求用例，验证只执行一次且仅有一次结果响应；`plugin-view-host.test.js` 18/18 通过。
- `bun run check` 退出 0，仍有仓库既有 advisory。前后只读空间扫描均退出 0：`target` 29,407,499,061 B，`.cache` 355,458,670 B，task-scratch 852,839,902 B，site 29,644,753 B，UnknownEntries 全为 0。E 盘可用从 48,652,005,376 B 到 48,657,440,768 B；卷余量变化不归因于此补丁。实际删除 0 文件、0 字节。
- 只读检查 `E:\zi-devtools\release\plugin-candidates` 与 `D:\Work\zi-devtools\release\plugin-candidates` 的 `.zicode-plugin` 文件，未发现签名容器。提供方目录原样保留，Studio 没有修改 DevTools。已有冻结候选只能证明其限定能力及收据；没有最新可安装签名包，故本轮未做真实 DevTools 实包的发现、加载、执行、展示验收，完整接受仍为 0/154。
- 此补丁只处理同一 View 实例的重复在途 ID。原生 WebView2、真实提供方包、跨平台和异常请求洪泛仍需独立验收。
