# 独立桌面验收目录（候选）

普通启动继续使用当前用户的 Studio 配置与数据。实际原生验收可显式传入：

```powershell
& '.\ZiCode Studio Desktop.exe' --isolated-profile 'E:\studio-acceptance\profile'
```

此参数尚未包含在 `release/devtools-results-2026-10-08-02bd955-dirty` 中；不要将上述命令用于该旧 EXE。本阶段开发程序的实际启动与检查记录位于技术博客档案 `iterations/desktop-isolated-profile-2026-10-08`。

## 目录与行为

- 参数必须是绝对、非根目录；重复、缺值和不支持的等号格式明确报错，不回退普通启动。
- 首次目录必须为空，随后仅允许重用带 Studio 所有权标记的目录。拒绝路径中的链接或 Windows junction；持有独占锁，防止两个实例共享该目录。
- 配置、metadata、场景、默认工作区放在 `system/`；插件、实例、日志、WebView、后台控制资料放在 `data/`。Pi 子进程使用专属 `home/` 环境。
- 不迁入日常 metadata、场景配置、旧 Pi agent 或账号凭据。系统凭据库读写禁用；模型工具返回未配置，凭据状态显示未配置。
- Pi 清除继承环境，仅保留操作系统启动变量，并关闭扩展、技能、提示模板和主题自动发现；Studio 显式提供的内置扩展仍加载。场景运行环境及目录授权由原机制提供。
- 不修复系统登录自启动，不自动恢复后台任务；该模式不能启动后台工作进程或设置登录自启动。

## 长期命名测试环境的模型配置

默认 `--isolated-profile` 仍禁用系统凭据。需要长期保留独立模型配置时，启动时同时显式选择测试名称：

```powershell
& '.\ZiCode Studio Desktop.exe' --isolated-profile 'E:\studio-test\models' --test-profile 'models-acceptance'
```

名称须以小写字母或数字开头，仅含小写 ASCII 字母、数字、`_`、`-`，长度 1–48。
必须同时提供独立目录，缺值、重复或等号格式会报错。建议每个测试名称使用自己的固定目录；
以后使用相同目录和名称启动，可在现有模型设置中选择模型并保存、重读及删除自己的凭据。
测试与日常配置相互独立，不自动复制任何模型配置、密钥或资料。

此选择仅启用该目录和名称专属的模型凭据域。密钥仍保存在系统凭据库中，索引只有引用，
存于 `system/credentials/test-profiles/<name>/index.json`；不读取日常或其他测试名称的模型凭据，
不生成明文 `auth.json`。Pi 仍清除继承的密钥环境并关闭自动发现。
使用普通隔离参数重新启动同一目录，凭据立即恢复禁用。更换名称或目录不会隐式回退到旧凭据。
保存配置不会调用模型；联网、素材外发及可能计费的生成仍通过原应用入口明确执行。
不同名称的二次启动不会接入已有实例。此参数不修改账号级日常资料选择或自动启动设置。

### 一次安全录入到两个固定资料目录

首选在 Studio 的模型设置中录入。新版尚未安装时，可在完全退出两份 Studio 后，
用 PowerShell 7 运行 `scripts/configure-model-credentials.ps1`，指定 `-PersonalProfile`、
`-TestProfile` 和 `-TestName`；默认场景为 `programming`，默认提供方为 `openai-studio`，
也可通过 `-Scene`、`-Provider` 指定已经登记的模型提供方。
脚本只隐藏提示输入一次，直接写入两份独立的 Windows 凭据与原子引用索引，
保留其他提供方的条目，输出仅含是否配置成功。密钥不放入参数、文件、日志或子进程。
日常资料必须已经显式允许系统凭据，测试环境仍需以前述命名参数启动。
脚本拒绝活动资料锁、链接和非 ASCII 路径；其他路径请使用 Studio 设置。
若某一步失败会报错，已完成的资料可能已更新，可重新运行；不要在日志中粘贴密钥。
`-Synthetic` 仅用于带专门合成验收所有权记录的自有测试目录，不用于日常资料。

## 边界

这是 Studio 数据和配置的独立运行方式，不是操作系统沙箱。用户明确打开外部项目、运行程序或访问网络仍受对应功能的授权规则约束。目录所有权标记不是签名，不能把不可信目录当作安全沙箱；验收使用新建受控目录。

四项边界测试已验证解析、目录所有权/锁、旧资料保留及独立进程中的路径/凭据/Pi发现策略；Rust 静态检查与严格 Clippy 通过。Windows 实际原生启动正在验收，其他系统未做实际启动验证。不能把这些门槛作为全部153个DevTools工具的接入验收。

2026-10-08 Windows 原生开发程序文本插件流程已验证：实际安装/启用、View/WASI 执行、搜索接收工具、JSON→Base64编码→解码、预览取消不写入和确认后单次保存；报告 passed=true / errors=[]，已读实际保存预览截图。原生文件选择器、未保存弹窗、其他系统及153全工具未验收。完整前端1540项通过，本阶段完整Rust与新冻结EXE仍待完成。详情见技术博客对应阶段日志；既有旧EXE不包含本轮隔离参数和修复。

2026-10-09补充：独立Windows Tauri源码开发实例已完成资源输入专项（实际管理授权、确认前零上传、隔离View精确读取28字节、撤销拒绝），并正常退出。使用自动化设置WebView文件控件，OS对话框/实际DevTools资源包/WASI图片/新冻结交付仍待完成。完整Rust401通过/14ignored、前端1585通过，证据见技术博客iterations/native-resource-input-2026-10-09；154工具完整验收仍0。

## Windows 原生确认框的验收（2026-10-09）

`public/bootstrap-entry.js` 将 `window.confirm` 路由到 Tauri `plugin:dialog|message`。
它是 Windows 原生窗口，不能用 Playwright 的 `page.on("dialog")`、网页 `role=dialog`
或仅 WebView 截图来证明已经出现、取消或确认。导航等待超时时，应先检查原生窗口，
不能据此认定插件挂起，也不能用覆盖 `window.confirm` 为 `true` 代替真实确认验收。

Inspect candidate01 本轮使用既有不可变 Windows EXE、独立合成 profile 和原始插件包，
实际检查“取消切换保留错误输入及旧结果 → 再次切换 → 原生确认离开 → 独立 Base64 执行”。
7 操作精确样例、搜索及业务错误保留通过，9 个所属采样进程正常退出后剩余 0。
首轮未处理原生确认的超时记录保留；没有产品源码修复或重新构建。
证据：技术博客 `iterations/native-inspect-candidate01-2026-10-09/native-acceptance.json`、
`native-discard-confirm.png`、`native-recovery-result.json` 和 `closure.json`。

这只补齐候选包的 Windows 开发目录发现/启用/View 证据，不代表签发安装、Pi、其他系统、
原始字节输入向量或 154 个完整工具已验收；新 Host 多输入功能也未包含在该旧 EXE 中。
