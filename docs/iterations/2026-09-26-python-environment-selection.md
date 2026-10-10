# 2026-09-26 显式 Python 虚拟环境

状态：代码实现和静态检查完成；运行、配置升级与界面验收待补。本轮未新增或运行测试。

## 目标与设计

- 项目可选择自动模式，或指定本机已有的标准 Python venv 目录。自动模式保持命令目录 `.venv` 优先。
- 显式环境优先于自动 `.venv`，应用于 Python 命令、环境版本诊断和新建终端；不改动运行中的进程。
- 与工具目录共享本机存储、项目作用域和 CAS 修订号。旧客户端省略新字段时保留已有选择；明确传 null 才恢复自动模式。
- 保存请求只校验目录、`pyvenv.cfg`、脚本目录和解释器，不创建环境、不安装包。界面保存成功后会自动刷新版本诊断，该诊断会执行所选解释器的版本查询。
- Unix 保留解释器符号链接的调用路径，避免绕过虚拟环境的 `sys.prefix`；显式环境失效时不静默回退。

## 验证边界

- 只进行源码阅读、类型/编译检查、格式与静态检查及前端资源构建；不执行含测试的 `check:rust` / `check:platform`。
- 上一轮测试证据仅属于工具目录阶段，不能作为本轮环境选择的运行证据。
- 持久化迁移、真实 Python/PTY 生命周期、界面交互及各系统实机验收均需后续测试确认。

## 实现记录

- 独立 `project_environment/python.rs` 校验标准 venv 结构及 PATH 可用性。显式目录可位于项目外，脚本目录和配置文件需留在所选环境内；解释器可保持标准 venv 的符号链接。
- 现有数据库增加独立选择表，与工具目录在同一事务内写入，共享修订号；未选择的旧记录通过 LEFT JOIN 返回自动模式。
- `pythonEnvironment` 支持省略、null、目录字符串三种协议语义，分别对应保留、自动、显式选择。旧 Host 未返回该字段时，前端禁用新选择控件。
- 配置快照与命令指纹包含选择；新进程注入 PATH、VIRTUAL_ENV 并移除 PYTHONHOME。显式环境结构失效时拒绝新启动，原有停止接口不依赖该配置。
- 终端信息返回启动时的显式 Python 目录，UI 标注为启动选择；它不宣称代表 Shell 内后续手动激活后的状态。自动模式显示未显式指定，旧 Host 没有此字段时不猜测。
- 前端沿用公共 UI 控件和既有加载/冲突/过期响应处理。已有 Rust 测试夹具仅补充默认字段以保持类型兼容，没有新增用例、断言或执行测试。
- 框架入口未新增功能逻辑；解析、存储和表单位于各自专用模块。没有提交、发布或生成完整安装包。

## 静态检查结果

- `cargo check --locked --all-targets` 与最终 `cargo clippy --locked --all-targets -- -D warnings` 通过。编译包含既有测试目标，但未运行用例。
- TypeScript 类型检查、`bun run check`、中英文键覆盖通过；字典 2305 键、0 缺失。
- Biome 保留既有 111 warnings、7 infos；xterm 生成文件保留既有 1 条内联尺寸提示，设计检查退出 0。
- React 与 CSS 资源已重建；文档 strict 构建和 `git diff --check` 通过。
- 静态证据：`E:\tmp\zicode-python-selection-clippy-complete.log`、`E:\tmp\zicode-python-selection-types-final.log`、`E:\tmp\zicode-python-selection-static-final.log`、`E:\tmp\zicode-python-selection-i18n-final.log`、`E:\tmp\zicode-python-selection-docs-final.log`。
- 这些结果不证明新选择已经过真实 Python、终端、数据库升级或浏览器验收。仍需补齐自动/显式切换、环境损坏、旧客户端保存、多窗口冲突和跨平台运行验证。
