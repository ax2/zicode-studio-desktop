# 固定数据目录与版本升级

数据目录不属于安装目录、Cargo target 或版本编号。测试构建和正式构建使用同一套路径规则。

默认规则保持 `%LOCALAPPDATA%\zicode`（运行资料）与 `%USERPROFILE%\.zicode`（系统资料）。本机若已有需要长期沿用的独立配置，可以在 `%LOCALAPPDATA%\zicode\desktop-profile.json` 保存：

```json
{"schemaVersion":1,"profileRoot":"D:\\work\\local-state\\zicode-studio-desktop"}
```

配置只指向已经存在且带有 Studio 所有权标记的目录。目录缺失、无效或指向链接时启动失败，不新建空资料库、不悄悄回退。显式 `--isolated-profile` 仍优先，供真正独立的自动化测试使用；自动化测试不能改写个人目录选择。

这个选择复用隔离配置原有安全行为（包括不自动发现外部扩展、不访问系统模型凭据），不会迁入账号或降低隔离限制。没有此配置文件的用户保持既有默认行为。旧二进制不认识新配置时，仍须显式传入同一 `--isolated-profile`；已经发布的旧程序不会被本次源码修改自动更新。

用户笔记、附件及应用资料仍保存在每个工作区自己的 `.zicode` 中。工作区注册信息保存在固定 profile 的 `system/metadata/picot.sqlite3`，不要随版本重建。升级必须保留注册信息和原工作区；重新接回旧工作区时沿用原 ID 和路径，禁止覆盖同名笔记或复制模型凭据。

启动清理只删除完全空的实例目录树。有任意文件或链接的实例一律保留，不能用“没有聊天 session”推断“没有用户数据”。正常构建、安装和更换 EXE 不删除上述数据。用户主动删除和回收站清理仍遵循各功能的确认规则。

本机固定位置：

- 当前配置：`D:\work\local-state\zicode-studio-desktop`
- 当前默认工作区笔记：`D:\work\local-state\zicode-studio-desktop\system\.zicode\notes`
- 原普通启动工作区笔记：`C:\Users\ax2\.zicode\.zicode\notes`（原地保留，并接回当前工作区列表）
- 本次升级前备份：`D:\work\local-state\zicode-studio-desktop\retained-backups\before-tray-persistence-2026-10-26`

以上目录长期保留，不列入构建缓存清理。备份不能替代磁盘故障时的异盘备份；本功能保证版本和安装位置不决定资料位置，不承诺存储介质永不损坏。

当前本机运行入口为 D:\work\start-zicode-studio.cmd，指向 D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe。交付 EXE 须具有普通 Medium 完整性标签，不能继承构建目录的 Low 标签；构建缓存、资料库和运行目录分开保留。完整验收见 iterations/2026-10-26-windows-tray-and-persistence.md。
