# SHA256SUMS 清单核对：当前 Windows 部分交付

当前23包启用、102能力+7 View；154源=6完整、51部分、97无映射。`com.zicode.devtools.checksum-manifest` 0.1.0 候选01已安装启用。清单文本最多64项/32KiB，可手工提供文件名/SHA-256，也可在文件摘要工具确认1–4个、合计32MiB以内的快照并执行后，直接点击“用这些文件核对清单”。新调用仅在点击时发送明确展示的文件名、摘要和清单，不发送路径或文件内容；重新核对源授权，拒绝过时结果。

结果区分匹配、不匹配、未提供，不把未选择的条目推断为磁盘缺失。父界面把返回行与实际清单名称、预期摘要、来源文件SHA-256逐项核对。使用既有一次性调用、取消和状态恢复；超时保持不确定状态及恢复入口。这个范围不等同独立版同目录1–64文件的生成/验证：清单文件读取已由后续本机增量交付；目录授权、缺失和读取错误、身份复核、生成/安全另存仍待。

## 验证

- 共享Rust核心5项、独立版真实临时文件2项、WASI适配器2项及新增包严格clippy/WASI构建通过。
- 冻结包15固定样例采用独立语义期望；真实Host/Worker14项与原生结果一致（包括64项、32KiB及非法清单），超长清单由Host在Worker前拒绝。最初脚本将此拒绝误当应进入Worker，保留 `outputs/manifest-review-host-first-20261030.json` 和原失败，不改写为运行成功；继续执行剩余样例后完整记录 `outputs/manifest-review-host-20261030.json`。
- Studio相关29项前端测试、前端检查及3658键语言覆盖通过；既有告警保留。脚本CSS已重新生成。
- 独立Windows和当前Windows资料库：选择两个合成文件、明确提供、真实摘要计算、粘贴三行清单、点击核对，得到匹配/不匹配/未提供。360px宽无横向溢出、语言切换保持文件名、取消共享清空结果。独立实例在核对后复核前真实撤销源授权，停止显示结果；另直接检查发送的文件名与实际摘要绑定。
- Browser插件不可用，沿用本机WebView2 CDP自动化；测试的是客户区视口，不宣称OS窗框/其他平台。页面标题与非空内容正常，无框架错误遮罩或Runtime异常；已人工检查截图。
- 当前用户程序只正常关闭本会话启动的实例并恢复普通启动；没有关闭其他实例。23包持久启用、调试端口关闭，三篇笔记可读，32原文件、最新编辑、固定路径、备份及SQLite完整性保持；没有创建定时任务。

证据位于本会话工作目录 `C:/Users/ax2/Documents/Codex/2026-10-22/clone-git-github-com-ax2-zicode`：`outputs/manifest-review-current-install-20261030.json`、`outputs/manifest-files-ui-20261030.json`、`outputs/manifest-files-revoke-ui-20261030.json`、`outputs/manifest-files-current-20261030.json`、`outputs/manifest-files-current-20261030.png`、`outputs/manifest-review-delivery-normal-20261030.json`、`outputs/manifest-review-delivery-final-20261030.json`。冻结提供方目录及外置收据位于 `D:/work/zi-devtools/release/plugin-candidates/checksum-manifest-0.1.0-candidate-01`，未签名，不发布。


## 清单文件导入增量（当前 Windows 已交付）

结果面板新增清单文件选择器。选择只展示名称，点击“用所选文件替换清单”才读取，随后仍需点击核对；保留UTF-8原文和CRLF/BOM语义，不自动执行插件。失败、超限或取消选择保留原清单，迟到读取在来源/编辑修订变化后丢弃。开始核对或手动编辑后清除过时的“尚未执行”提示。

真实32KiB文件含大量空行时，首次测试观察到JSON转义后触发既有传输限制，未把该失败算作通过；保留 `outputs/manifest-file-import-current-first-20261030.json` 和原脚本/工具错误输出。修复仅在发送副本中省略原生解析器已忽略的空行，使用与Rust一致的Unicode空白语义（保留BOM的非空白意义），编辑框原文不变、传输/执行限额不变；同一32KiB文件随后实际导入与真实Worker核对通过。

31项相关JS测试、前端检查以及3665键语言覆盖通过；无新增Rust改动或重复原生构建。当前Windows实际文件测试验证：选择不读取、明确替换、无自动执行、无效UTF-8保留文本、32769字节不读取、清除选择保留文本、恰好32KiB导入及核对、匹配/不匹配/未提供、360px无横向溢出和中英文切换。截图检查发现并修复旧导入提示与完成提示并存的问题，最终实际复测通过。Browser插件不可用，使用本机WebView2 CDP；未声明系统文件对话框或其他OS验收。

证据位于会话工作目录：`outputs/manifest-file-import-current-20261030.json`、`outputs/manifest-file-import-final-ui-20261030.json`、`outputs/manifest-file-import-final-ui-20261030.png`、`outputs/manifest-file-import-data-final.json`、`outputs/manifest-file-import-normal-final.json`；检查日志为 `work/manifest-file-import-check-final.log`。测试只正常关闭本会话启动并核对身份的实例。普通启动恢复，23包启用、调试端口关闭，三篇原笔记可读、32原文件/最新编辑/备份不变，SQLite完整性正常。源工具仍部分映射，数量不增加；没有创建定时任务。


## 生成与原生安全另存（当前 Windows 已交付）

冻结提供方 `checksum-manifest-0.2.0-candidate-01`，保留0.1.0原包不变；新增 `devtools.checksum-manifest.generate`，使用独立版同一 `zi-files-core::manifest::format`。纯计算协议接受最多64项文件名/SHA-256，生成标准排序、两空格分隔、结尾换行、最多32KiB的SHA256SUMS；没有文件权限或自动保存。24项独立语义样例中21项真实Host/Worker与原生结果一致，另3项明确由Host输入检查拒绝，不算Worker执行成功。

当前父页面从1–4项已确认文件的真实摘要结果传入文件名与SHA-256，生成前后复核源授权，完整核对标准输出与Host捕获结果长度/SHA-256/版本；不信任插件自报名称、摘要或保存路径。生成后填入清单编辑框，可再核对；保存单独经过系统选址、目的地/字节数预览、明确确认。取消不写、已有文件不覆盖、未知执行或写入不自动重放；只读恢复核对完整已保存文件。两个按钮复用有间距、可换行的工具条，360px窗口验证无横向溢出。

新增Host通用原生文本结果导出 `result.export.text.draft1`，细节见[协议和边界](../plugins/result-text-export-draft1.md)。前端只提交scope/resultId，原文来自Host版本绑定的快照；写入复用既有随机临时文件、刷盘、全量摘要、防重解析与无覆盖发布。插件停用/重新启用、取消、窗口路由或工作区改变、重复提交等均在真实Windows原生命令验证。后续用户修改会使核对失败，保留修改且不回写。

首次自动化未找到系统对话框的取消按钮，保留 `work/manifest-generation-independent-live-first.log` 与 `outputs/manifest-generation-independent-first-20261030.json`；调整测试脚本：UIA树缺少标准控件时，从已核对进程/窗口的实际Win32控件定位，再通过UIA操作；未绕过产品确认，也没有伪造对话框结果。

随后真实保存发现既有共用原子另存问题：当UTF-16路径缓冲区长度恰好对齐时，未明确预留NUL。保留 `work/manifest-generation-independent-live-second.log` 与 `outputs/manifest-generation-independent-second-20261030.json`；独立新文件探针复现了错误后缀，确认显式终止可精确保存，探针只删除已核对UUID及内容的自建文件。修复共用写入器，FileNameLength不含终止符、分配明确包含终止符；只将真正的已有文件错误归为冲突，其他写入错误不再误报存在。新增8种长度及中文/非BMP文件名真实回归，断言精确文件名、完整字节、无额外尾缀、无临时残留及拒绝覆盖；不增加限额或盲目重试。定义参考Microsoft FILE_RENAME_INFO文档（协议页附来源）。

验证：55项相关前端测试、前端/设计检查、3671键语言覆盖、Rust静态检查通过；原生共用文件测试6项（含8个名称长度案例）和文本结果授权测试3项通过。修正版在独立与当前Windows资料库均实际验证摘要→生成→回核→系统另存/取消/冲突；独立额外7组原生命令边界通过。Browser插件不可用，使用本机WebView2 CDP和真实Windows标准控件；页面标题、非空内容、无错误遮罩、无相关console警告/Runtime错误，截图已检查；不声明其他OS或系统窗框尺寸验收。

当前安装EXE SHA-256 `494BA803C6B4F7F0B90A582C3243A657FE7411824E100B4CA74D087B633D8C5A`，本会话仅正常关闭自己启动并核对PID/路径/启动时间的实例，保留旧EXE恢复副本。普通启动恢复，调试端口关闭，23包持久启用。3篇原笔记可读，32原文件/最新保存编辑/固定位置/旧备份与工作区保持，SQLite完整性正常。没有创建定时任务、复制凭据或替换独立版运行中的程序。

本批当前统计为23包103能力+7View；154源仍6完整、51部分、97无映射。校验清单保持部分范围：同目录64项读取、真实缺失/读取错误、物理文件身份复核、批量进度仍待。不能将64项纯计算样例当作64项真实文件工具完整验收。后续优先补全目录授权/实际逐项定位，再继续97项无映射源工具。

证据（会话工作目录）：`outputs/manifest-generation-host-20261030.json`、`outputs/manifest-generation-independent-20261030.json`、`outputs/manifest-generation-boundaries-20261030.json`、`outputs/manifest-generation-current-install-20261030.json`、`outputs/manifest-generation-current-20261030.json/png`、`outputs/manifest-generation-normal-final.json`、`outputs/manifest-generation-data-final.json`；原生测试分别在 `outputs/manifest-export-termination-native-tests/result.json` 与 `outputs/manifest-export-result-fixed-native-tests/result.json`。日志 `work/manifest-export-termination-static.log`、`work/manifest-generation-tests-final.log`、`work/manifest-generation-ui-check-final.log`、`work/manifest-generation-build-fixed.log`。主入口超过500行的例外仅涉及模块导入和必要命令注册，逻辑独立拆分。
