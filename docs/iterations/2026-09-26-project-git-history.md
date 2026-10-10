# 2026-09-26 项目 Git 提交历史

状态：实现与静态检查完成，运行验收待进行。上一轮终端恢复有代码与静态检查进展，本轮接续项目改动追溯。

## 目标与设计

- 项目总览按需读取当前 HEAD 中影响项目目录的最近 50 次提交，展示完整对象 ID、作者、作者时间和提交说明。
- 固定读取 HEAD 快照，不接受任意命令或 revision。工作区路径由已注册 ID 解析，沿用 Git 的进程超时、输出上限与环境隔离。
- 使用 NUL 字段与记录分隔，文本展示不解释 HTML/Markdown；消息过长明确截断。旧请求不得覆盖新项目、刷新或关闭后的状态。
- 不执行 fetch、提交、分支切换或自动 AI 发送。浅克隆与局部克隆不能证明完整历史。

## 工作日志

- git_history.rs 先解析 HEAD^{commit}，再使用固定对象 ID 和 literal 目录筛选读取最多 51 条，返回 50 条及 hasMore；HEAD 读取失败时用 porcelain v2 的 initial 标记识别未出生分支，其他错误保留失败。
- NUL 分隔四个字段，验证完整对象 ID（SHA-1/SHA-256）及 RFC3339 作者时间。作者限制 200 Unicode 字符，完整消息限制 16384 字符；字段截断显式报告。
- 沿用每个 Git 子进程 5 秒、标准输出/错误分别 2 MiB 上限，历史整体 12 秒超时。禁用签名展示、外部 diff、textconv、notes 和装饰；共享 Git 读取器添加 GIT_NO_LAZY_FETCH=1，禁止支持该变量的 Git 自动补取对象。
- data-gateway.js 增加只读操作，Host 由注册工作区获取根目录。大文件 host_server.rs、host_data.rs、store.ts 与项目入口仅作路由、模块和组件接线，业务逻辑位于新模块；i18n.js 仅补充翻译。
- GitHistoryPanel 默认收起，按需加载；按工作区、请求函数、刷新版本隔离结果，清理过期 Promise 回复。原生 details 展开记录，textarea 供键盘浏览和复制。GitHistory 解析器拒绝超量、重复 ID 或错误字段。
- 首次 TypeScript 检查发现可空 workspace 与 result 比较不能缩窄 null，已补充显式可空字段判断；最终前端检查通过。中英文帮助、平台路线与导航已同步。

## 静态检查

- TypeScript、bun run check、中英文覆盖检查通过，2442 键、0 缺失；既有 111 warnings、7 infos 与 xterm 内联尺寸提示保留。
- cargo check --locked --all-targets 通过（2m 21s），cargo clippy --locked --all-targets -- -D warnings 通过（2m 54s）。没有执行测试二进制。
- React 构建、MkDocs strict 与差异空白检查通过；构建后恢复本轮前干净的无关前端产物，保留项目相关及原有修改。
- 证据前缀 E:\tmp\zicode-git-history-。

## 验证边界

- 本轮不新增或运行测试；静态检查不代表真实仓库、UI 或跨平台行为已验收。
- 仅当前 HEAD 可达、影响注册项目目录的 Git 默认简化历史；没有全分支浏览、分页、重命名跟随、签名验证或提交详情差异。
- 作者日期不是 committer 日期；显示按本机时区转换，历史排序沿用 Git 默认顺序。
- 局部/浅克隆可能缺失历史；旧 Git 对 GIT_NO_LAZY_FETCH 的支持需在平台验收确认。本轮没有实际 fetch、Shell/PTY、提交、推送或发布。
