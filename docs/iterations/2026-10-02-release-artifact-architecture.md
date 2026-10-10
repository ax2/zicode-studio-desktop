# 发布产物架构与失败报告

日期：2026-10-02。状态：本地规则实现与回归通过，未创建或发布 Release。

## 发现

原上传校验只有 DMG 文件名架构检查，Windows EXE、Linux AppImage 与 Debian 包仅检查扩展名和非空。最终发布清单也接收任意 EXE/AppImage/Deb 架构后缀。另有 `pending.map(path.basename)` 将数组索引作为 basename 的第二参数传入，多个产物缺失时可能触发类型错误，掩盖实际缺失信息。

## 修改

新增独立产物策略模块，限定四种当前支持的目标与完整类型集合：Windows x64 的 NSIS、两种 macOS 架构各一个 DMG、Linux x64 的 AppImage 和 Deb。重复类型、缺少类型、额外类型和未知目标均拒绝。

上传校验检查文件名架构后缀，最终发布清单使用相同后缀：`_x64-setup.exe`、`_aarch64.dmg`、`_x64.dmg`、`_amd64.AppImage`、`_amd64.deb`。Linux 命名核对了当前本地 Tauri bundler 源码缓存的文件名生成逻辑；Windows 名称与已有安装包证据一致。缺失报告使用显式单参数回调，不再把数组索引传给 basename。

策略回归纳入跨平台统一检查入口，覆盖五种产物名称、错误架构、完整类型集合与缺失报告。

## 验证与限制

- 策略与跨平台检查脚本：2 个文件、11 条用例通过。
- `node --check scripts/verify-release-artifacts.mjs` 通过；代码与设计检查退出 0，既有 advisory 保留。
- 首次误用 `bun --check` 实际执行了脚本；它因缺少发布环境参数在访问 GitHub 前退出，随后改用 Node 的语法检查。
- 不包含二进制内部架构解析、安装或启动验证。文件名规则配合既有构建主机核对和上传 SHA-256 比较，仍不能替代实机交付验收。
- 未运行远端流水线，未上传或发布文件，未产生 Rust 构建缓存。
