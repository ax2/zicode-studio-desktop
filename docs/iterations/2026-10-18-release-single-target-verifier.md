# Stage：Release 资产校验只读当前 Cargo 目标目录

日期：2026-10-18。范围为 Studio 的跨平台 Release 校验脚本；没有发布新版本。

## 发现与修改

当前 `.cargo/config.toml` 和桌面构建入口共用仓库 `target`，显式
`CARGO_TARGET_DIR` 由调用方指定。Release 校验器此前会同时搜索
`target` 与 `src-tauri/target`，显式相对覆盖路径时也会搜索两处。
这让旧目录参与 EXE 和安装包判断，偏离当前单一 Cargo 目标目录规则。

现在通过纯路径函数计算一次 `target[/triple]/release/bundle`，
EXE 与每种 bundle 都只在这个目录树下核验。相对覆盖路径基于 Release
工作流的仓库根工作目录，绝对覆盖路径保持原值；`CARGO_BUILD_TARGET`
继续插入目标三元组。缺少当前 EXE 或 bundle 会直接失败，旧
`src-tauri/target` 不再提供回退。发布工作流本身未改，仍按仓库根目录
运行且不设置目标目录覆盖。

## 验证与边界

`release-artifact-policy.test.js` 与 `release-draft-assets.test.js`
共 18/18 通过；覆盖默认、相对和绝对目标目录，以及带平台三元组的
路径。三份改动脚本通过 Biome lint、Node 语法及 `git diff --check`。
未执行大型 Tauri/Rust 构建、GitHub Release 流程、上传资产或真实
Windows/macOS/Linux 安装；现有发布版本不因此改变。

没有删除既有产物。原 `src-tauri/target` 的文件仍保留，当前扫描仅有
两个小文件；是否清理由项目磁盘规则另行判断，不因本次校验器修改
自动删除。

测试前后只读预算：`target` 30,041,815,353 B、非 scratch `.cache`
355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B
均未变化，未知项 0；E 卷空闲 112,902,144 → 111,009,792 B。
卷级变化不能归因于未变的四棵树；预算脚本因低空间建议退出 1。
