# v0.7.9 · Inspect 密集 YAML 转换

Inspect 0.1.5 在原 Windows Worker 限额内完成了 Inspect 0.1.4 中失败的三份合法 8 KiB YAML。分别为 1,200 项小数序列、620 键纯数值映射和 4,095 项整数序列。转换保留精确整数和小数。重复键和无法原样写出的数字会收到拒绝提示，转换过程只读取原文件。

在插件管理安装并启用此候选后，从工具中心使用 YAML → JSON 和 JSON → YAML。单次输入最多 8 KiB，完整结果上限 48 KiB，Worker 仍使用 10,000,000 fuel、64 MiB 和 5 秒的原有预算。复杂或嵌套 YAML 仍使用通用解析器，极密输入仍可能耗尽预算。独立版继续使用原来的转换路径。

## 实测与冻结

- 提供方从精确核验头 `b06cbfc7a5e8a961d0d53a28eef12ae9b9cb1c38` 合入 `6e25533a50b1f33ae3566b896cd16fe165bb5c0c`，三个文件字节一致。Rust 定向 38 项及严格 Clippy 通过。[提供方 PR #58](https://github.com/ax2/zi-devtools/pull/58)
- 真实 Windows Worker 5/5。三份原失败文件现在分别输出 10,802、10,432 和 20,477 字节，均与独立期望文件逐字节一致。两个 8 KiB 对照结果不变。固定引擎中的三项计量由 20,436,956、19,138,240、33,314,243 分别降至 2,969,625、4,543,993、5,207,450 fuel。
- 443 份实际模块的对照中，370 份完整响应与旧版逐字节一致，73 份在两版的原有预算下均未完成。额外 10 份边界对照逐字节一致，覆盖未加引号的普通键、整数负零和空序列。
- [Inspect 0.1.5 候选](../../tests/fixtures/devtools-inspect-strict-yaml/inspect-0.1.5-candidate-01) · [冻结件逐文件收据](../../tests/fixtures/devtools-inspect-strict-yaml/inspect-0.1.5-candidate-01-verification.json)。共 619 件、2,413,024 字节。目录索引 `4c8519836eb542c94aa9dd55870066d2959b10abbee1a4095d14355f71023245`，收据 `0580dc0c125d40f2e9f314e16be8d85771dbbd010f1de3894338f291e5f00f31`，WASM `c9737a4b58d0b5bd54ac4965ca39be43ff0521037d5b97a516ba766acac5fa59`。两代包各自核对索引，0.1.4 的记录见[原验收](2026-11-26-inspect-strict-yaml.md)。
- 隔离 Windows Host 基线 `207db8999dc7553e01c4429e49794f3929f7665c` 安装并启用 0.1.5 后，目录出现 8 个工具。首装和同资料重启均通过真实 Host 的工具准备、执行及实际 Worker。生产文件读取器先打开六份合成原件，验证 8,193 字节输入被拒绝。两轮共 12 次调用，8 份完整输出与独立期望字节相同，4 次精度或重复键拒绝均未生成结果，12 次原件均逐字节保留。真实系统选文件和正式安装包集中验收。[本机 Host 回执](../../tests/fixtures/devtools-inspect-strict-yaml/inspect-0.1.5-candidate-01-windows-host.json)
- 正常工具中心继续提供 0.1.5 的双向 YAML 和三项 Unicode 文件入口。已有入口回归及字节下载验证达到 50 通过、8 跳过，生产 Tool Center 构件 SHA-256 `f9ae69273eefb7d709fc90ab82c4ffd8a4cbfe85aeb1abf256ab10057318d0bf`。
