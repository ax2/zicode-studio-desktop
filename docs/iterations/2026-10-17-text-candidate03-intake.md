# Stage：DevTools Text 0.3.0 候选接收（2026-10-17）

## 目标与来源

Studio 只读发现提供方 `text-plugin-0.3.0-candidate-03`，包外收据声明
`unsigned candidate; not Host-accepted`，来源修订为
`65f9aa63c831a4540bdd5731aa4da3de76dbd4b8` 且 dirty。该候选在原
五项文本能力外增加 JSON 校验和 SQL 格式化。提供方当前 `docs/tools.json`
（SHA-256 `c9b821d52f7888a406afe49f5b97804a4e493ecb217b97ffd967732be7277214`）
将 JSON 标为 1.2.0、SQL 格式化标为 in-progress 0.3.1；冻结 dev.105
矩阵仍是历史基线，不能用当前工作树覆盖。

## Studio 修改与验证

- 将候选冻结于 `tests/fixtures/devtools-text-candidate03/`，包外收据独立保存。
  Studio 只读核验原目录和冻结副本均为 15 文件、757,289 字节；收据
  SHA-256 为 `2b7aaa34489a0413d63bb0a21ab25eeaacee53857dd3432a89aedd2b76ccf857`。
  收据的目录索引编码未被核验器识别为已验证格式，因此只主张逐文件路径、
  大小和 SHA-256 一致，不主张目录索引或签名可信。
- 当前 Windows Debug EXE 的真实 Worker 对 JSON 校验有效样例和 SQL
  通用格式样例返回预期文本；无效 JSON 返回 `INVALID_INPUT` 业务错误。
- 新增隔离 Host HTTP 专项：开发候选安装并启用后发现 7 项能力；无桌面
  令牌调用被拒，带令牌调用经生产 Worker 执行新增两项基本样例，业务
  错误可区分，停用插件后再次调用被拒。专项 1/1 通过，临时目录成功
  回收。`bun run check:rust:static` 通过；整仓 rustfmt 仍有既有漂移，
  新测试文件单独 rustfmt 检查和 `git diff --check` 通过。

## 遗留与接受边界

此为未签名开发候选。本节是初次接收时的边界；后续 Pi 动态调用与
Host 文本转交补验见下文。尚未验证真实 Studio 原生工具中心发现、按需加载、
View 展示、确认保存、签名安装/更新回滚或
macOS/Linux。SQL 候选仅有通用方言默认格式选项，不覆盖独立程序的
PostgreSQL/MySQL/SQLite/T-SQL 选择、缩进和关键字大小写设置。
DevTools 154 项完整工具接受数仍为 0；ZiFile 108 格仍为 0。

前后只读存储扫描 `target` 为 29,909,581,893 → 29,909,624,507 逻辑字节
（+42,614），task-scratch 同为 939,353,231 字节，未知项均为 0。
E 盘可用量 30,546,714,624 → 30,516,936,704 字节；卷变化含其他进程，
不能归因于本次编译。复用单一 Cargo target，未生成完整运行副本或 ZIP，
未重试此前被审批拒绝的清理。

## 后续：目录搜索、按需加载与动态调用

同一冻结 candidate-03 的隔离 Host 专项进一步注册内存运行会话并授权
`pi.tools.register`，通过真实 `/v2/plugin-tools/catalog/search` 搜到 SQL
格式化，按返回的目录修订和工具 ID 从 `/load` 取得输入 schema，再经
`/v2/plugin-tools/invoke` 调用生产 Worker 得到预期 SQL 文本。无桌面令牌、
原始能力调用、无效 JSON 业务错误和停用拒绝仍在同一专项中通过。
这是 Host Broker 路由使用合成运行会话和测试令牌的证据，不是实际 Pi
进程或模型自主选工具。专项 1/1、Rust 静态检查、单文件 rustfmt 与
`git diff --check` 均通过。被观察到的已安装 Studio 窗口属于日常用户
工作区，未在其中安装候选或操作权限，也没有把该窗口截图归档为候选证据。
新候选的原生隔离界面仍待验收。

本补验前后只读扫描：`target` 29,909,624,507 → 29,909,703,867 B
（+79,360 逻辑字节），task-scratch 均为 939,353,231 B，未知项均为 0。
E 盘可用量 30,567,350,272 → 30,233,186,304 B，卷变化不能归因于
本次测试。测试自有临时目录回收后残留 0 项；复用单一 Cargo target。

## 后续：真实嵌入 Pi 发现与执行

新增独立忽略专项，使用现有 Debug 目录中的 `pi/pi.exe`、Studio 的
`plugin-broker.mjs`、当前生产 Worker EXE 及冻结 candidate-03。Pi 在
隔离临时目录中通过 `studio_plugin_search` 发现该包 7 项工具，按需
`studio_plugin_load` 注册 JSON 校验与 SQL 格式化，并由动态工具分别
执行成功样例；无效 JSON 返回 `INVALID_INPUT`。撤销
`pi.tools.register` 后，旧 SQL 工具调用被目录修订变化拒绝。
真实 Pi 专项 1/1 通过，Host 关闭后该任务临时目录和匹配进程均为 0。
此调用由测试命令明确指定工具，不证明模型自主选工具；没有原生 Studio
View、签名包或其他 OS 验收。

首次 Rust 静态检查因新测试持有 EXE 父目录借用时移动 PathBuf 而失败；
改为克隆路径后复跑通过。新增文件单独 rustfmt 与 `git diff --check`
通过；整仓格式检查仍有既有漂移。前后只读扫描 `target` 为
29,909,703,867 → 29,909,789,013 B（+85,146），task-scratch 均为
939,353,231 B，未知项均为 0。E 盘可用量 30,276,055,040 →
30,557,560,832 B，卷变化不归因于本次测试。无发布副本或 ZIP。

## 后续：真实候选输出经确认转交

在同一隔离 Host/Worker 专项中，SQL 格式化能力以 `captureResult:true`
生成 Host 来源绑定的 `resultRef`。Studio 用该结果准备转交至同一候选的
Base64 编码能力，并返回 SQL 原文、来源与目标的预览；`confirmed:false`
提交返回冲突，`confirmed:true` 才触发真实 Worker 执行，编码结果与预期
Base64 精确一致，并生成可继续使用的新 `resultRef`。这证明当前未签名候选
在 Host 文本转交协议中的一个同包跨能力链路；测试直接提交确认字段，
不证明原生界面上发生了用户点击，也不证明跨独立插件或持久保存。

专项 1/1 通过，`bun run check:rust:static` 通过，整仓 rustfmt 仍提示既有
漂移；本文件仅有一处 rustfmt 排版提示，已修正。成功测试自有
`text-candidate03-http-*` 临时目录剩余 0 项。前后只读扫描完整、未知项 0：
`target` 29,909,789,013 → 29,909,830,485 B（+41,472 逻辑字节），
task-scratch 均为 939,353,231 B；E 盘可用 30,508,019,712 →
30,556,454,912 B，卷变化不能归因于本专项。未清理旧缓存或重试被审批
拒绝的路径；无新完整运行目录或 ZIP。DevTools 完整接受仍 0/154。
最终静态检查后的只读复扫同为 `target` 29,909,830,485 B、
task-scratch 939,353,231 B，未知项 0；E 盘可用 30,540,271,616 B。

## 后续：真实 Pi 输出引用与桌面确认转交

Pi Broker 的目录/动态/通用调用现在可向 Host 发送可选 `captureResult:true`。
Host 保持原 `result` 不变，对成功文本结果另行返回 Host 来源的 `resultRef`；
捕获失败单独报告，不让 Pi 将失败结果当成可转交内容。Pi 仅把合法引用写进
`details.studioResult`，Broker token 本身不能准备或提交桌面转交。

使用当前 `extensions/dist/plugin-broker.mjs`、嵌入 Pi、真实 Host HTTP 与
生产 Worker 的隔离专项再次通过 1/1：发现 7 项候选，加载 JSON 和 SQL，
动态执行；Pi SQL 结果提供 Host 引用，无效 JSON 不提供引用；Broker
token 准备转交被拒，桌面 token 能预览 SQL→Base64，未确认提交被拒，
测试给出 `confirmed:true` 后实际 Worker 返回预期编码。撤销 Pi 权限后
旧 SQL 工具被拒。Vitest 定向 18/18、扩展源码类型检查、扩展构建、
Rust 静态检查、新测试单文件 rustfmt 与差异空白检查通过。测试并未模拟
用户真实点击；当前 Debug EXE 也未按这些最新 Host 源码重建，因此不能
将这条证据描述为新协议的原生 Studio 窗口验收。

前后只读存储扫描 `target` 29,909,830,485 → 29,909,881,426 B
（+50,941 逻辑字节），task-scratch 同为 939,353,231 B，未知项 0。
E 盘可用量 30,552,182,784 → 30,552,178,688 B，卷变化不能完全
归因于本专项。自有 `text-candidate03-pi-*` 临时目录剩余 0 项。
