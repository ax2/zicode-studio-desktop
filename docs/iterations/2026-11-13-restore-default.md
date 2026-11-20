# 恢复确认默认保留与关闭行为（2026-11-13）

关联 Issue #31。完整离线恢复已在独立工作树提交 `536b2701f352195d9ed74cb53682aa7e18f4e259`，本批补充默认动作和原生关闭语义，不代表完整升级验收或发布。

复核发现初始确认框默认选中撤销。第一次调整两个按钮后，候选 `3051B34372210760702893DBF06B5BF008B44E9AA504854F43DEF487A815E4F1` 在真实Windows关闭确认框时仍撤销了合成请求。根因为tauri-plugin-dialog 2.7.1将原生Cancel结果映射成自定义Cancel按钮文案，单纯判断文案无法区分关闭与点击。失败保留为主会话`outputs/restore-default-keep.json`，130个合成文件未变，测试PID64604正常退出。此失败候选未交付。

最终采用保留/撤销/关闭三个独立结果槽位，第一项默认保留；关闭和Escape映射到独立关闭文案，只有明确撤销按钮可授权。回归覆盖全部普通结果、保留、关闭和未知文案，单项通过；全目标check和严格Clippy通过，静态脚本退出0，既有格式提示保留。

Windows debug候选SHA256：`DDC1F029F4569DB4E411D0ECBE3A9714B3678F017D3CE376DB0FC1AF9F45C753`。版本仍0.5.3。视觉 #41 的7个Rust文件和2个资源在构建前后均按其冻结摘要核对；本批运行验证不代表视觉生成验收通过。

真实Windows后台独立桌面验证：读取按钮的`WM_GETDLGCODE`确认默认按钮确为“保留请求”；向实际原生确认框发送关闭消息，请求保持且工作区未打开。正常退出再启动后，实际点击“撤销恢复”并确认结果框，生成精确请求ID取消回执。再次正常重启后工作区打开，真实Host回读3份先前移动笔记的ID与正文一致。三阶段130个合成Notes文件的完整清单和SHA256均不变。没有通过原生键盘发送Enter/Escape，不能把默认按钮标记及关闭测试扩大成全键盘验收。

只操作本会话合成profile。每个退出均核对PID、路径、启动时间和EXE摘要，用WM_QUIT正常退出；启动器返回0，app退出码字段null不冒称0。用户输入桌面保持Default；未触碰个人固定资料。首次DirectUI正文读取限制和WebView2退出1412提示继续保留。

最终证据：主会话`outputs/restore-default-safe-{tests,static,native-build}.log`、`restore-default-safe-source-hashes.json`、`restore-default-safe-{keep,cancel,reopen}.json`及对应`-page.json`、截图；进程收尾在`.cache/task-scratch/restore-default-safe-native/`。独立提交工作树备份设置36项和78个Tauri权限检查通过；仅生成settings资源且摘要D930351B…与此前候选一致，未带入视觉或凭据改动。

Issue仍开发中：普通selector、完整发行包升级、已注册旧根更多布局和设置页至交换点硬中断链路仍待完成。未推送发行分支或发布新版。
