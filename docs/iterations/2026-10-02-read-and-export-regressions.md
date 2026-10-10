# 页面读取与记录导出回归（2026-10-02）

## 范围

接续页面读取生命周期及命令历史证据导出两轮修改，新增可重复的行为验证。没有改 Host 调度和用户数据。

`frontend/src/features/automation/page-read-lifecycle.test.ts` 对任务中心与自动化中心分别覆盖三种交错：销毁后读取失败不安排就绪重试、不更新旧错误；失败后主动读取成功取消待执行重试；旧 tick 未结束时销毁并重开，旧读取收尾后立即观察新状态。

`frontend/src/features/projects/project-run-history-export.test.ts` 覆盖快照来源及时间单位、输出内容排除、历史摘要完整性未知、工作区混入及重复记录拒绝、非法读取时间拒绝，以及 40 条上限的省略计数。

## 当前证据

- 两个新增文件的 10 个用例通过。
- 任务、自动化、运行摘要导出、Inbox 和原生派发/任务存储联合检查：13 个文件、127 个用例通过。
- 前端 TypeScript 和项目静态检查通过；仍有既有 124 条 warning、7 条 info 和终端生成代码设计 advisory。
- 新用例位于现有前端测试发现目录，跨平台开发者检查包含 projects/tasks/automation 目录，无需另加入口。

命令：`bun run vitest run frontend/src/features/tasks frontend/src/features/automation frontend/src/features/projects/project-run-history-export.test.ts public/components/super-agent-runtime.test.js public/super-agent/native-dispatch.test.js public/super-agent/task-store.test.js --reporter=dot`。

本轮是在 Windows 上运行的 store 与数据用例；它们不证明真实 WebView 页面卸载、下载文件、安装包、后台 worker、休眠或其他平台行为。Rust 编译目录未重新生成，整体目标保持进行中。
