# 平台验证 runner 目标门槛

日期：2026-10-01。状态：本地代码与工作流已修改，远端运行待验收。

## 目标与发现

三平台矩阵的报告已保存 `process.platform` 与 `process.arch`，但此前只验证仓库、触发 SHA 和工作区是否干净。若 Actions 标签对应的实际架构与文档预期不一致，检查可能通过，而使用报告的人还需手动发现这个偏差。

## 修改与边界

- 工作流为 Windows 2022、macOS 15 和 Ubuntu 22.04 分别声明预期 Node 平台与架构，并传给统一检查入口。
- CI 报告格式升至第 4 版，记录预期目标与匹配结果。runner 不匹配时先保存失败报告，再跳过后续耗时检查。
- 本地非 CI 检查不要求预期目标；它仍只记录当前设备的实际系统和架构。此门槛只确认 runner 身份，不能代替桌面启动、安装、升级或卸载验收。

## 验证与遗留

`bun run check`、`node --check scripts/developer-platform-checks.mjs`、Python YAML 解析与修改文件的 `git diff --check` 均退出 0；仓库静态检查仍有既有非阻断提示。未运行包含测试的 `check:platform` 或远端 Actions。下一次远端运行需核对三份报告的实际系统、架构、目标匹配结果和 GitHub 作业标签。

2026-10-01 另只读核对了 GitHub 官方 [runner-images README](https://github.com/actions/runner-images/blob/main/README.md) 的标签表：`windows-2022` 与 `ubuntu-22.04` 标为 x64，`macos-15` 标为 arm64；macOS 15 的 x64 标签是 `macos-15-large` / `macos-15-intel`。这支持当前矩阵的静态目标声明，但不能替代本仓库的真实 Actions 运行记录。
