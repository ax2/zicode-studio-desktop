# 内嵌 Bun 下载边界（2026-09-28）

## 目标与发现

跨平台打包需要下载锁定版本的 Bun 运行时。`scripts/fetch-bun-runtime.js` 原先用 `response.arrayBuffer()` 一次性接收完整 ZIP，只有三分钟超时，没有响应大小上限。项目已有供 PortableGit 和 WebView2 使用的 `downloadLockedAsset`：只接受 HTTPS、限制十分钟与 512 MiB、流式写入 `.part`，成功后重命名，异常时清理临时文件。

## 修改

- Bun 缓存下载复用 `downloadLockedAsset`，不再一次性缓冲网络响应。
- 失败时移除未提交的缓存目标；成功后继续按锁文件 SHA-256 校验，再提取所需可执行文件。复用本机匹配版本 Bun 的路径不变。

## 验证与遗留

`node --check` 已通过；定向 Biome 首次检查发现文件原有长行格式问题，已按 Biome 格式化。Python 3.13 的严格 MkDocs 构建和 `git diff --check` 均通过。未新增或运行测试，也未触发真实下载或跨平台打包。ZIP 提取仍需在内存中完成；真实安装包资源和各平台网络行为待 CI 与实机验收。
