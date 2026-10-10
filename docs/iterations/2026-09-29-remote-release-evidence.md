# 2026-09-29 公开 Release 远端证据

状态：只读元数据核对完成；安装、启动与当前工作树发布验收未完成。

## 来源与版本边界

- GitHub REST Release 列表返回公开 `v0.1.0`，创建于 2026-07-30 09:29 UTC，发布于 2026-07-30 09:56 UTC。远端注释 tag 经 tag 对象解析指向提交 `7b6433d4d0bef80fa58497f681f944f69d42a5b7`，与本地同名 tag 一致。
- 本地 HEAD 为 `02bd95521cbd2219287bcd3af85a5ebf23325fcc`，工作树含大量未提交修改。以下资产属于 7 月旧提交，不能作为当前代码或新增发布门槛已通过的证据。

## 公开资产元数据

| 平台产物 | 字节数 | GitHub 报告的 SHA-256 |
| --- | ---: | --- |
| `ZiCode.Studio.Desktop_0.1.0_x64-setup.exe` | 312367833 | `21ac04a9fcf25a0bf5f21ef889d0aef0700ed36e0ae536b2a0e1863a7e01f559` |
| `ZiCode.Studio.Desktop_0.1.0_aarch64.dmg` | 38564787 | `953f2a8fe29525dd11ec20aef9dcec02b59893dfc98aacc24c9b2f43691ffa95` |
| `ZiCode.Studio.Desktop_0.1.0_amd64.AppImage` | 123988472 | `1c1e741e49dfe8dbe73397c26f051bb9de088bd47c60d5e48a6a5523de203b25` |
| `ZiCode.Studio.Desktop_0.1.0_amd64.deb` | 51676950 | `03da2016243794b6670bb194a8c279818cf29e005f14562aac44ce91f8281960` |

这些值来自 GitHub API 的资产元数据。本轮没有下载安装包并独立计算哈希，也没有在任一平台安装或运行。

## 工作流状态与下一步

- GitHub Actions 列表中最新可见的 `release.yml` 运行 `32643318555` 对应当前 HEAD、2026-08-23 13:45 UTC 的 main 推送，结论为 `failure`；Jobs API 返回 `total_count: 0`。不能据此确定失败原因或推断构建曾启动。
- 当前工作树中的 Release 工作流和三平台检查仍未提交或远端运行；新增草稿资产清单门槛只经过本地 YAML/Bash 静态检查。
- 下一步需在明确的提交上取得 Windows、macOS、Linux 构建及运行记录，再分别验收安装、启动、路径、凭据和升级；旧版资产元数据只能证明四个文件曾公开。
