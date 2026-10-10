# 2026-09-26 Python 项目命令与虚拟环境

状态：实现与 Windows 自动验证完成，跨系统实机和视觉验收待补齐。上一轮完成跨平台检查入口与 Windows 现场证据，本轮补充 Python 开发流程。

## 设计

- 根目录 pyproject.toml / requirements.txt 发现 unittest、pytest、build 标准模块命令。
- 优先使用项目 `.venv`，不存在时才查找宿主 Python；损坏的已有环境不能静默回退。
- 展示解释器路径，并把选择结果纳入预览指纹；不自动创建环境或安装依赖。
- Unix 允许虚拟环境解释器链接到系统 Python，但 `.venv` 目录本身必须位于项目内。
- 运行虚拟环境时设置 VIRTUAL_ENV、补充 PATH 并清除 PYTHONHOME，保持现有进程管理。
- 临时真实环境验证使用 `venv --without-pip` 和标准库 unittest，不下载测试依赖。

## 实现记录

- 独立 `python_tasks.rs` 负责清单发现、解释器选择和虚拟环境变量，不在入口文件内累积语言逻辑。
- 两种 Python 清单同时存在时合并为三项命令；参数由 Host 固定，ID 为 `@python/unittest`、
  `@python/pytest`、`@python/build`。仍使用注册项目、清单指纹、并发与输出上限。
- `.venv`、其脚本目录和配置路径检查真实范围；Unix 仅允许解释器文件链接到外部系统 Python。
  宿主回退排除相对 PATH、项目内任意可执行文件以及 Windows Store 占位入口。
- 虚拟环境选择结果写入指纹，修复或改变选择后要求刷新；预览显示解释器，运行记录显示实际工具路径。
- Python 输出使用 UTF-8 且关闭缓冲，以匹配 Host 日志解码和进度展示；不改变文件读写的默认编码。
- 三平台 CI 配置 Python 3.12；统一检查入口显式运行真实 `.venv` 用例并记录 Python 版本。

## 验证过程

- 新增虚拟环境优先级、PATH/VIRTUAL_ENV/PYTHONHOME 配置、损坏环境禁用、宿主查找和平台路径用例。
- 新增前端用例验证解释器显示、不可用按钮禁用及任务 ID 回传。
- 真实用例创建不带 pip 的标准环境，执行一个 unittest 检查 sys.prefix、VIRTUAL_ENV、PATH 和中文输出。
- 第一次专项失败来自测试比较 Windows 普通路径与 `\\?\` 路径表示，sys.prefix 已指向项目环境。
  改用 `os.path.samefile` 验证真实目录身份，避免把字符串表示差异判为环境错误。
- 已验证 workflow Python 安装配置和只读权限；远程矩阵尚未运行，不宣称 macOS/Linux 实机通过。

## 本轮结果

- `bun run check:platform`：10 项必需检查通过，Rust 全仓格式检查保留既有 advisory warning；总状态 `passed_with_warnings`。
- 前端与网关：10 个测试文件、74 项用例通过；Rust 默认测试 314 项通过、5 项忽略。
- 另行显式运行真实 Cargo/Go 项目用例和 Python `.venv` 用例，各 1 项通过。
  Python 3.14.7 下确认项目解释器、环境变量、子进程 PATH 与中文 UTF-8 输出。
- TypeScript、设计检查、翻译、Windows 子进程规则、Cargo check 和 Clippy 通过；2172 个翻译键无缺失。
- 本地证据：`E:\tmp\zicode-python-evidence\win32-x64-0363a409-de5f-4577-b319-ce76369255e2\summary.md`。
  该结果对应带本地修改的工作区，不代表干净提交或已发布版本。

## 限制

- pytest/build 需在选定环境可用，本轮不自动安装；仅 unittest 做了实际模块执行验证。
- 环境诊断仍报告宿主 Python，尚不解析 Python 版本要求或验证项目完整依赖。
- 仅识别项目根清单和标准 `.venv`；Conda、外部 Poetry 环境及自定义解释器选择待后续扩展。
- 视觉/WebView 和跨系统实机验收仍待补齐；未发布、推送或生成应用安装包/ZIP。
