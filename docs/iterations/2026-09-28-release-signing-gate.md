# 发布工作流签名门槛（2026-09-28）

## 发现

Release workflow 的更新产物上传步骤在 `if` 条件中直接引用 secret。GitHub Actions 不支持这种条件引用；同时上传失败被 `|| echo` 吞掉，可能让发布作业在缺少已有签名产物时仍继续。

## 修改

- 构建作业的环境变量只保存签名私钥是否配置的布尔值，步骤条件引用该变量，不输出或保存密钥内容。
- 更新产物存在时，`gh release upload` 的失败会使构建作业失败，从而阻止依赖全部构建作业成功的公开发布步骤。
- 当前 `createUpdaterArtifacts` 仍为 `false`。真实签名构建、产物路径及 Windows/macOS/Linux 同名更新清单合并尚未验证，不能据此开启自动更新。

## 验证

YAML 解析、条件字段静态检查、`git diff --check` 与离线严格 MkDocs 构建通过。本轮未运行测试、触发发布或配置 secrets；GitHub Actions 实际求值与跨平台产物仍待验证。
