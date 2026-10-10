# 公开仓库与首次加载发布门槛

## 来源说明

README 纠正为最初参考 Picot 的 Pi 桌面封装架构，没有直接 fork Picot、未持续跟进。
当前 GitHub 仓库为公开独立仓库。保留的 Tau 历史提交与旧标签不删除，MIT 版权继续保留。
Picot 原公开地址返回 404，历史 fork 背景来自维护者说明；Tau 当前标记 retired。

## 发布前验证

- 前端全套 262 文件、1797 测试通过；六个类型检查入口通过。
- 修正两处 Promise 测试替身类型；修正命令面板旧宽度断言。
- GitHub Linux 暴露四处地区/时区依赖断言，改为当地计划时刻和当前 Intl 格式。
  UTC/英文定向 81 项及 GitHub Tests 已通过。
- Rust 主程序完整重跑 468 通过、29 条件跳过；其他二进制此前 5/19 项通过。
  严格 Clippy 通过，已有格式漂移仍为脚本 advisory。
- 工具路径探测前两轮整套失败、定向通过、最终整套通过。原因未确定，未放宽产品超时。
- 2265 个冻结提供方文件在 Git 暂存 blob 与原始内容间逐字节一致。

## 首次加载问题与修复

v0.4.0 的四平台 Release 门槛全部在 Inbox 注册检查失败，保持草稿，未公开发布。
本机已有缓存的检查通过，但复制到新路径后首次加载失败，因此已有缓存不能证明首次可用。

隔离诊断定位到 Pi 1.1.0 编译运行时的 Jiti 加载上下文：
`follow-redirects` 1.16.0 构造原型继承的错误对象时，
`Error.captureStackTrace(this, this.constructor)` 报 `First argument must be an Error object`。
调用链经 Axios 1.19.0 / 飞书 SDK。延长超时、压缩及 CJS 格式均不能修复这一问题。

Studio 的构建插件只转换该依赖的一处堆栈捕获：先捕获到真正的 Error，
再将 stack 放回库的错误对象。错误类、code、cause、message 和继承关系保持。
依赖代码签名不匹配时构建报错，要求重新审查；不编辑 node_modules、Pi 或 DevTools。
三个回归用例重现约束、验证错误语义并拒绝依赖漂移。
首次全新路径实际 Pi 命令注册、插件 HTTP 成功/拒绝/缺结果处理及退出通过，startup 10613ms。
因此验证脚本的整体期限由 10 秒改为有界 60 秒；所有功能断言保留，产品调用超时未变。

修复使用新的 v0.4.1 标签发布，不覆盖 v0.4.0。各平台构建与最终发布以对应 Actions 结果为准。
本机详细失败与通过证据持续保存在技术博客档案
`zicode-studio-desktop/iterations/public-release-2026-10-10/`。

## 仍待验收

DevTools 全目录 154 项完整验收仍为 0；候选基本操作验证不能代替完整工具接受。
其他系统完整人工体验、实际外部机器人登录/收发和所有提供方算法等价性未作为本轮通过。
资源响应丢失/写入确认后的不确定状态恢复等已知边界继续记录在插件文档。

## 2026-10-10 晚间：四平台第二轮阻塞
v0.4.1 Release 38020531435 的 Inbox 注册检查在四个平台通过；后续 Windows 布局断言依赖 LF，macOS 重复 generate_context! 导致 _EMBED_INFO_PLIST 重复，Linux notify-rust 4.11.4 不兼容锁定的 zbus 5.18.0，Release 仍为草稿且无产物，未公开发布。
主分支 Developer platform 38020522158 的已下载报告另发现 Rust 1.99 新 Clippy 告警，以及 Windows PTY 的 PowerShell 从 canonical verbatim EXE 路径推导出错误 UNC 模块路径。保留原失败报告，不降低门槛。
修复：读取 Rust 测试源码时统一换行；提取 application_context.rs 单一宏展开；最小升级 notify-rust 4.11.5（上游该补丁直接使用 futures-lite，不再依赖 zbus 的移除导出）；等价改写排序/遍历/除法、平台限定 OCR 常量；在 PTY 启动边界使用既有 Win32 路径转换器，保留此前 canonical 身份校验。大型 Rust 文件只改报错处，避免无关重构。
本机布局 68 项及 lint/design 通过；第一轮静态 Rust 通过，追加 Clippy/终端修复后的完整 Rust 检查进行中。先在 main 上检查四平台，成功后才生成新修订标签，不覆盖 v0.4.0/v0.4.1。
此前本机 0.4.0 编译在 makensis 阶段后进程已结束，无安装包；仅有旧版本 EXE，不算可交付。最终版本须重新完整构建并检查实际截图。
上游修复源码：https://github.com/hoodie/notify-rust/blob/v4.11.5/src/xdg/zbus_rs.rs

第二轮本机完整 Rust 检查通过：主程序468通过/29条件跳过，其他二进制5/19通过；严格Clippy通过，fmt仍为既有advisory。测试并发RUST_TEST_THREADS=2；新终端路径改写的真实PTY用例通过。各平台结果仍以新main运行报告为准。


终端夹具补充：project_environment PTY 测试此前只等待标记文件，没有像真实终端和其他PTY测试一样回复 ESC[6n 光标位置查询。补上读取及 ESC[1;1R 应答（可处理跨块查询）；保持12秒期限、原始PATH不变和文件标记断言。定向真实PTY 1项通过6.08秒，修改后的Rust静态检查/严格Clippy通过。此改动只涉及测试客户端，不改变产品超时或加载逻辑。main 9c152ed1 的四平台检查继续，不因这项测试补充取消已在运行的验证。

Linux 第二轮报告 38048690334：notify-rust/zbus 编译兼容阻塞已消失，继续暴露 automation_login_start.rs 的 AppImage 路径 OsString / current_exe PathBuf 分支类型不一致。将 AppImage 分支显式转 PathBuf，保持绝对路径/文件存在/UTF-8检查及安装程序路径而非挂载路径策略。Windows 静态检查通过仅证明当前系统分支，Linux最终确认仍依赖下一轮CI。
Developer platform 与 Release 的 Rust cache 设置 cache-on-failure:true；保留原缓存key和target，便于失败后的依赖复用，不改变发布门槛。上游输入说明：https://github.com/Swatinem/rust-cache#example-usage 。11项相关脚本检查通过，修改后Rust静态/严格Clippy通过。暂不推送，保留尚运行的Intel Mac/Windows报告。

Windows第二轮 38048690334 报告：全部脚本、Rust check、严格Clippy和真实Pi/多语言环境检查通过；仅环境PTY测试467通过1失败29跳过。失败输出已有普通C:\Program Files路径及正常PS提示符，无先前UNC搜索；原测试在Shell初始化前发送命令，未执行。修订测试先泵送终端查询、等首次PS提示符再发送一次工具命令，初始化和执行同在原12秒总期限内，保留PATH隔离及文件标记断言。本机定向1通过2.91秒，静态/严格Clippy通过。不能声称仅DSR修补已在CI通过，下一轮需核对。
为避免推送修复取消长时间main编译，Developer platform main/manual保留正在运行的检查；PR仍cancel-in-progress，使用默认单个最新pending，不排无界队列。官方说明 https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency 。11项相关脚本检查通过。
