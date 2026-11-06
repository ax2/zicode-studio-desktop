# 2026-10-27 进制、颜色与IPv4完整原功能域验收

当前Windows Studio可搜索“2/8/10/16进制输入”、“HEX / RGB / HSL”和“IPv4 CIDR”直接执行。三项原源工具完整功能域经独立预期、原生/生产WASI、真实Host和实际表单核对后接受。不是增加重复算法或把原功能缩小后计完成。

## 实际修复

颜色目录原描述声称可输入HEX/RGB/HSL，实际共享核心及已有独立版只接受HEX，专用View也已有此限制说明。Inspect0.1.3候选01纠正目录为“输入HEX（#RGB/#RRGGBB）→输出RGB/HSL”，源color版本1.0.3仅明确输入/输出方向。没有删除任何已有RGB/HSL输入功能。旧0.1.2冻结616文件校验一致，新包仍616文件；运行WASM与View逐字相同，目录快照/包版本/来源与迁移说明更新。继承的旧证明只说明未变运行时/View，不冒充新目录或安装验收。生成器同步同一准确说明，公开契约快照保留。

## 三个完整功能域

| 源ID | 本批完整原域 | 独立原生/WASI样例 |
| --- | --- | --- |
| number | 二/八/十/十六输入，输出四种表示；signed128全部上下界、符号、匹配前缀、下划线及首尾空白 | 134 |
| color | 3/6位HEX输入，规范HEX、RGB、整数精度HSL输出，拒绝无效颜色 | 68 |
| cidr | IPv4前缀0–32、掩码/网络/地址上界/总数/可用范围；/31两端、/32主机 | 114 |

`src/tools.rs` Number/Color和tools_extra CIDR包装函数均使用同仓共享核心；原生CLI和冻结WASI使用同样实现。Python使用任意精度整数格式/显式signed128域、colorsys.rgb_to_hls、ipaddress独立给出完整文本预期。316项全部原生与当前Studio生产Worker逐字相同，正确输入与独立预期一致；覆盖正负极值、JS安全整数之外、各种前缀/分隔符、颜色六分支/灰度/短HEX、每个IPv4前缀的零地址/最大地址/实际主机地址、无效输入和8KiB字节边界。未穷举2^128个整数或每一种颜色/IPv4地址；结合共享实现与分支范围审查验证完整原功能域。

文本传输显式限8192UTF-8字节/请求48KiB/结果48KiB，原5秒/10M fuel/64MiB不变。最大规范128位数、所有3/6位颜色和全部IPv4 CIDR均可完整表示，结果远低于输出预算。没有宣称无限冗余空白/分隔符、任意精度整数、IPv6、反向RGB/HSL解析或联网扫描。验证包含刚好8KiB有效冗余输入和多字节越界拒绝，未以截断代替失败。

## 当前Windows实际证据

真实Host340项=313次Worker+27次schema前置拒绝，6项集成通过：新旧收据、8项目录/正确信息、身份门、两包禁用恢复、其他6个Inspect操作冒烟、安装字节一致。YAML两方向/JWT/Unicode检查与两种规范化在0.1.3仍可用，但不因此把另外3源完整标志改为真。提供方外部验证CLI只用于算法对照，不是生产EXE委托；没有兄弟源码/共享数据库或旁路HTTP执行。

真实表单14次执行、6检查：四进制入口、128位/超JS精度输入、无效数字保留和恢复、准确HEX说明/拒绝RGB输入/HEX恢复、完整结果选择、/0/31/32、导航保留，1000×700/640×600/480×640可鼠标聚焦执行，运行异常0；打开自动执行0。Browser插件未提供，复用实际WebView CDP，不宣称物理OS外框/其他平台。没有模型、文件或生产网络操作。保存与复制遵循既有显式操作，本批不写剪贴板或创建定时任务。

启动观察首次15秒未发现workspace，未重启；核对同一响应进程/调试标志/9227实际可用后继续同一实例，保留观察失败。原生适配器复用项目release target和工具链，只构建现有两个小适配器，不替换旧用户独立主EXE。没有Rust算法改动、Studio产品源改动、无关原生/React重建或形式签名/其他OS门槛。此前原生symlink权限1314与全仓严格Clippy基线保留，不重复无变化的全仓检查冒充新增结果。

## 统计与资料

仍18包96能力+7View，总映射52；154源工具现为**5完整（UUID、random、number、color、cidr）+47部分+102无映射**。接受目标为current_windows_studio_manual_tool；正式签名/其他OS/可选Pi另记，整体持续优化和全工具集成未完成。三份逐源审计有原scope、源码版本、限制和证据，迁移计数由明确当前本机完整标志派生，不把历史JSON候选scopeComplete计入。

普通启动PID56532、单实例响应、9227关闭、18包启用和Inspect0.1.3持久保留。两个原noteID经真实snapshot.notes存在，各1篇；26原文件SHA一致，固定资料位置与工作区登记不变，SQLite integrity=ok。原笔记/备份/缓存保留，无凭据复制、发布、外部消息或定时任务。

证据：outputs/finite-tools-*、work/finite-tools-*；紧凑归档D:/work/logs/zicode-local-setup/devtools-finite-tools-2026-10-27及SHA索引。只读复验使用scripts/package_inspect_description_plugin.py --verify-only；算法对照使用scripts/verify_finite_tools.py --worker-exe <当前StudioEXE> --output <收据>，不依赖Host源码或用户配置。
