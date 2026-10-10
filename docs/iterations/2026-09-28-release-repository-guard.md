# 发版仓库身份检查（2026-09-28）

## 发现与更正

`gh repo view` 在当前双 remote 检出中显示公开的 `shixin-guo/picot`，但直接读取 Git remote 配置确认：`origin` 是私有的 `ax2/zicode-studio-desktop`，`upstream` 才是 `shixin-guo/picot`。进一步查询 GitHub API 确认目标私有仓库存在且当前身份可见。先前据 `gh repo view` 推断 `origin` 指向 upstream 是误判；本地发版脚本现有 `git push origin` 目标正确。

## 修改

- `scripts/release-repository.json` 明确记录发布仓库，供本地和 CI 共用。
- 本地 `bun run release` 在测试、版本修改和 tag 创建前读取 `origin` 的获取地址和所有推送地址（Git 可单独配置 `pushurl`），只提取 GitHub 的仓库路径，不输出 URL 或其中可能包含的认证信息；任何地址不匹配就停止。
- Release workflow 在创建草稿前核对 GitHub 提供的 `GITHUB_REPOSITORY`。本地脚本兼容常用 HTTPS、SSH URL 与 GitHub scp 形式。
- `.gitattributes` 固定本地发版脚本为 LF 换行，避免 Windows 的 `core.autocrlf=true` 检出后 Bash 无法解析。

## 验证与限制

`node --check`、定向 Biome、Release YAML 解析、Bash 语法、`bun run check`、Python 3.13 的严格 MkDocs 构建和 `git diff --check` 均通过。`bun run check` 报告了现存警告，但退出码为 0。没有运行发版脚本、创建 tag 或触发 CI；远端推送权限与真实发版结果仍需单独确认。
