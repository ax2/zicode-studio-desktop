# 2026-09-27 子项目包管理器继承

状态：实现与静态检查完成，运行验收待进行。

## 发现与设计

- catalog 只检查命令目录自身 packageManager/锁文件，pnpm 等 workspace 子包因此可能默认使用 npm。
- 提取共享选择器供命令清单与环境报告使用：本地显式 packageManager 优先，其次本地锁文件/有效 pnpm 文件；无本地依据时，在注册工作区内查找最近明确声明当前子包的 JS/pnpm 祖先，最多 32 层。
- 遇到最近声明明确排除/不包含该包，停止向上继承；不从注册工作区外继承。无法解析声明或多种锁文件冲突时报错。
- 显示选择的管理器、配置目录、来源与版本声明；有效选择信息进入命令指纹，改变管理器或版本/来源需刷新清单。
- 本轮不安装工具、不运行项目命令、不新增或运行测试。静态检查与文档记录随实现同步。

## 实现记录

- package_manager.rs 为独立共享选择器；选择结果包含 manager/source/directory/inherited/requirement。有效 pnpm 文件可以作为管理器依据，npm 的 package-lock/shrinkwrap 也能阻止错误继承。
- 声明成员检查直接匹配当前目录，不依赖有界发现列表是否曾枚举该包；沿用 pnpm 优先、glob 子集与排除匹配规则。仅本地证据为空时读取祖先声明，最多 32 层，不越过注册根目录。
- 本地显式 packageManager 优先于锁文件；无显式声明时，多种管理器的配置冲突报错。声明长度限制为 200 字节，版本可在环境页比较但不自动强制安装或切换。
- catalog 的 packageManager 元数据参与指纹；脚本仍在原子目录执行。环境报告附加相同选择结果或独立错误，不影响其他语言报告展示。
- PackageManagerDetails 是命令/环境共用展示组件，旧 Host 缺少新字段时保持兼容。中英文新增 9 个词条；大文件只增加模块声明与本功能词条。
- TypeScript、前端检查、i18n 与 React 构建通过，2513 键、0 缺失；既有 111 warnings、7 infos 与 xterm 内联尺寸提示保持。已恢复本轮前干净的无关前端产物。
- Cargo check --locked --all-targets、Clippy --locked --all-targets -- -D warnings、MkDocs strict 与差异空白检查通过。Rust 已用 rustfmt 格式化；日志前缀 E:\tmp\zicode-manager-inheritance-。

## 验收边界与遗留

- 本轮只做实现与静态检查，没有新增或运行测试、执行真实项目脚本、自动安装管理器、进行 UI 或 macOS/Linux 实机验收。
- 环境页的继承版本比较沿用现有工具报告，不强制版本、不启用 Corepack；实际脚本工作目录保持为用户选中的子包。
- 本地或祖先清单变化在请求时重新读取，不承诺多个文件的原子快照；指纹保护有效选择变化，未改变选择的无关清单改动不必改变指纹。
- YAML/glob 仍使用当前支持子集，复杂声明无法判定时报告错误，不宣称完整复刻 npm/pnpm/Yarn/Bun 的工作区解析。
- engines、依赖配置、环境变量、Conda/Poetry 与跨平台运行验收仍待推进。没有提交、推送、生成安装包或发布。
