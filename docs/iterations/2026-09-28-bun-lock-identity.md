# Bun 锁文件根包身份（2026-09-28）

## 目标与发现

跨平台 PR 与发布工作流都使用 `bun install --frozen-lockfile`。当前 `package.json` 包名是 `zicode-studio-desktop`，但 `bun.lock` 的根工作区仍写旧名 `pi-studio`。这个不一致会让锁文件无法准确代表当前产品；是否直接导致 CI 拒绝安装不能仅凭静态阅读断定。

## 修改与验证

- 将锁文件根工作区的 `name` 同步为 `zicode-studio-desktop`，未调整依赖版本。
- 使用 Bun 的 JSONC 解析检查根包名及根 `dependencies` / `devDependencies` 声明与 `package.json` 一致：通过。
- Bun 1.3.14 执行 `bun install --dry-run --frozen-lockfile --ignore-scripts`：通过；没有安装依赖或运行生命周期脚本。

本轮未新增或运行应用测试，未触发远程 Windows/macOS/Linux CI；实际矩阵结果仍待验收。
