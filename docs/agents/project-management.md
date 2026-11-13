# GitHub Project 执行规则

用户于2026-11-13授权用 [ZiCode Studio · 产品与研发](https://github.com/users/ax2/projects/4) 统一管理需求、问题、中长期路线图与版本范围。

- Owner: `ax2`，Project number: `4`，ID: `PVT_kwHOACEdzs4BrZGU`。
- 仓库：`ax2/zicode-studio-desktop`；Issues 保存范围/验收/证据，Project 保存优先级与状态，Milestone 保存版本范围。
- 当前项目私人可见，仓库Issue公开；不得写凭据、私人笔记或用户文件内容。

## 工作前先读最新状态

在每轮开始、切换事项、提交/发布前运行 `bun scripts/project-status.mjs`，再读取选中 Issue 的最新正文、全部评论和依赖：

```powershell
bun scripts/project-status.mjs
gh issue view <number> -R ax2/zicode-studio-desktop --comments
gh api repos/ax2/zicode-studio-desktop/issues/<number>/dependencies/blocked_by
```

连续工作每30分钟重新读取；这是活跃工作流程，不创建任何后台定时任务。无法取得最新状态时，不开展新事项或发布，必要的安全收尾继续。不要把网络读取失败当作空项目。

## 决策与同步

1. 用户最新正文/评论、优先级、依赖与版本范围优先于本地旧计划。有冲突先保持数据安全并澄清，不能擅自覆盖用户调整。
2. 同优先级优先处理明确依赖和影响日常使用的问题；负责会话标明分工。浏览器/基础由主会话推进，视觉资产由“视觉资产中心”会话推进。
3. 开始时更新负责事项为开发中并说明下一步；实现但未完成对应实际验收为待验证。只有需求范围内证据充分才置已完成并关闭 Issue。
4. 发生实质进展、失败或阻塞时同步到 Issue，注明源码/构建、验证范围和剩余限制。不要用mock、入口可见、静态检查替代真实业务完成。
5. 只更新本次负责的状态/进展；写入前重读。不要批量重放初始化脚本，不自动改用户优先级、日期、正文或Milestone。
6. 新Issue进入待梳理；范围、验收和模块确认后排期。移出/删除项目的旧Issue不得自动补回；状态脚本只报告未收录项供人工判断。
7. 发布前重新拉取Milestone的实时完整清单，逐项核对。未通过则解决或由用户调整范围；不得自行把失败项移出版本以便发布。

## 初始规划

v0.5.9 为公开稳定基线。v0.5.10 先做上传、笔记日常回归、数据保留与Windows发布验证；v0.6.0 为AI浏览器与视觉创作规划。所有范围可由用户直接调整。Roadmap日期仅为初始规划窗口，不是承诺日期，不应自动推进或覆盖。

只构建Windows；固定资料保留。只退出本会话启动且身份核对通过的程序。模型调用、素材上传和生产副作用仍须应用内逐次授权，排期不代替授权。不创建定时任务。
