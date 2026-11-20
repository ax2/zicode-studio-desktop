# 翻译输入、旧回复和结果交换保护

2026-11-04。已构建并正常更新当前Windows Studio；本轮不控制窗口，不发送模型请求，不创建定时任务。

## 问题与修复

请求开始后，用户仍可修改原文、选择语言或交换内容。原实现完成时只比较sceneId，未检查输入是否变化、workspaceId是否一致，也直接引用调用方可能修改的目标对象。旧回复或旧错误因此可能进入新的输入/范围。

另一个独立问题是setText清空可见result，却留下editedText；swap无条件优先使用这个旧字符串，可能把新输入替换成上次译文。

修复在现有translationStore中完成：

- 请求保存输入修订号及完整范围快照；成功与失败都先核对范围和修订号。过期完成只释放busy状态，不写译文、不发完成通知，不自动重发请求。
- 新原文清理已失效的结果引用；交换语言只使用确实对应当前输入、语言和范围的完成结果。没有匹配结果时保留正在输入的文字。
- 选择另一种语言仍保留用户已经编辑的上一份译文，供复制/导出；不会为了防旧回复而直接抹掉它。新一次明确翻译才进入新的结果流程。
- 过期请求提示“翻译内容或选项已变化，请在准备好后重新翻译”。清空内容后不产生多余提示；其他范围的旧错误不显示。

最小反馈循环是在实际Store动作入口延迟Gateway返回，同时改变单一输入/范围。修复前12条新增回归全部失败；结果保留复核另发现两条需要保留的编辑路径，已补充并修正。既有交换正例改为通过真实run动作获得完成结果，仍检查相同的交换行为，不再绕过实际状态流程直接写私有结果。

## 验证

证据根：`C:\Users\ax2\Documents\Codex\2026-10-22\clone-git-github-com-ax2-zicode`。

- `work/translation-races-before.log`：修复前12项失败，明确复现新文字被旧译文替换、过期回复被采用和跨范围错误泄漏。
- `work/translation-result-preservation-before.log`：两项编辑结果保留回归的失败证据。
- `work/translation-races-http.log`：4文件25项通过，包括14项新增状态回归、2项真实本机HTTP延迟/错误测试及9项既有翻译行为/组件测试。
- HTTP测试使用真实TranslationHttpGateway序列化、发送和解析JSON，只监听本机随机端口，返回固定测试文本；确认修改输入后不自动重试，新的明确请求仍可成功。服务均在finally关闭。此为真实HTTP客户端验证，不宣称是付费模型或完整Host模型服务验收。
- `work/translation-races-check.log`、`translation-races-typecheck.log`、`translation-races-i18n.log`：前端、类型及3751翻译键检查通过，零缺失；既有171个警告/13个信息保留。没有Rust逻辑修改，未重复原生硬件8项测试。
- `work/translation-races-build.log`：复用target/debug完成本地完整构建，不改应用版本、不生成安装包或新的完整运行目录。

## 当前Windows交付

- 安装：`D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe`
- SHA256：`59425CCF8043785B2AE141956CDB554AE0BE90C6CBA33584127490B9C65F3080`
- 固定资料库：`D:\work\local-state\zicode-studio-desktop`
- 本轮启动证明：`outputs/translation-races-current-launch.json`，PID82300，2026-11-04T03:57:54.3854720Z。后续操作必须当下重新核对路径和精确启动时间，不能仅凭PID。
- 只正常退出了本会话启动且有精确身份的73456实例，再沿用同一资料库普通启动；没有模拟鼠标/键盘，没有给当前资料库开放调试。
- `outputs/translation-races-runtime-check.json`：直接从当前运行程序获取translate.js及i18n.js，字节哈希与构建产物一致，包含新输入保护代码；23个DevTools包和翻译仍启用。
- `outputs/translation-races-data-before.json`与`translation-races-data-after.json`：六篇现有笔记及笔记本元数据逐项一致。
- `outputs/translation-races-normal-state.json`：进程身份、安装SHA、数据保留及9227无监听通过。

## 边界与后续

用户按Esc停止Computer Use后，本轮没有恢复界面控制。本轮没有对用户窗口做交互验收，验证范围为实际Store/组件回归、真实本机HTTP客户端以及当前运行程序的实际资产和数据校验。

上一轮[硬件图表与温度交付](2026-11-04-system-information.md)继续保留；原生托盘右键鼠标交互仍待，不把导航事件或文本格式化测试冒充该项完成。软件更新发布清单此前404、云同步/Windows小组件仍为方案、Pi换DSH仅评估等范围不变。

可复现的动作级测试和每次请求的身份/输入快照可防止这类问题再次静默出现；不需要新增通用运行时框架。持续优化及全工具导入目标保持进行中。
