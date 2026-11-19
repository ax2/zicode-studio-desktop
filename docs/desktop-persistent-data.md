# 固定数据目录与版本升级

数据目录不属于安装目录、Cargo target 或版本编号。测试构建和正式构建使用同一套路径规则。

默认规则保持 `%LOCALAPPDATA%\zicode`（运行资料）与 `%USERPROFILE%\.zicode`（系统资料）。本机若已有需要长期沿用的独立配置，可以在 `%LOCALAPPDATA%\zicode\desktop-profile.json` 保存：

```json
{"schemaVersion":1,"profileRoot":"D:\\work\\local-state\\zicode-studio-desktop"}
```

配置只指向已经存在且带有 Studio 所有权标记的目录。目录缺失、无效或指向链接时启动失败，不新建空资料库、不悄悄回退。显式 `--isolated-profile` 仍优先，供真正独立的自动化测试使用；自动化测试不能改写个人目录选择。

普通启动会读取选定个人资料内的 `system/credentials/profile-permission.json`。文件缺省时关闭系统凭据访问；显式设置 `{"schemaVersion":1,"systemCredentials":true}` 后，Studio 可使用该资料对应的系统凭据。此设置独立于资料目录选择，升级时两者都要保留。个人资料继续禁用外部扩展自动发现。单独传入 `--isolated-profile` 的测试实例使用隔离模式，命名测试资料使用独立的模型凭据范围。

用户笔记、附件及应用资料仍保存在每个工作区自己的 `.zicode` 中。工作区注册信息保存在固定 profile 的 `system/metadata/picot.sqlite3`，不要随版本重建。升级必须保留注册信息和原工作区；重新接回旧工作区时沿用原 ID 和路径，禁止覆盖同名笔记或复制模型凭据。

启动清理只删除完全空的实例目录树。有任意文件或链接的实例一律保留，不能用“没有聊天 session”推断“没有用户数据”。正常构建、安装和更换 EXE 不删除上述数据。用户主动删除和回收站清理仍遵循各功能的确认规则。

本机固定位置：

- 当前配置：`D:\work\local-state\zicode-studio-desktop`
- 当前默认工作区笔记：`D:\work\local-state\zicode-studio-desktop\system\.zicode\notes`
- 原普通启动工作区笔记：`C:\Users\ax2\.zicode\.zicode\notes`（原地保留，并接回当前工作区列表）
- 本次升级前备份：`D:\work\local-state\zicode-studio-desktop\retained-backups\before-tray-persistence-2026-10-26`

以上目录长期保留，不列入构建缓存清理。备份不能替代磁盘故障时的异盘备份；本功能保证版本和安装位置不决定资料位置，不承诺存储介质永不损坏。

本机日常启动脚本 `D:\work\start-zicode-studio.cmd` 使用正式安装程序 `%LOCALAPPDATA%\ZiCode Studio Desktop\zicode-studio-desktop.exe`。更换安装版本后，日常入口应指向已安装的程序，普通启动会沿用同一份资料目录选择。旧开发运行目录和构建缓存独立保留。

备份时同时覆盖固定资料根目录和位于其外部的工作区。校验固定资料目录内的文件时，外部工作区的笔记和附件需按各自路径另行核对。[历史托盘与资料保留验收](iterations/2026-10-26-windows-tray-and-persistence.md)
