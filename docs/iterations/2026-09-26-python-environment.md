# 2026-09-26 Python 环境版本要求

状态：实现与 Windows 自动化验证完成，实际界面及其他平台待验收。

## 目标与设计

- Python 清单目前仅检测存在；增加 PEP 621 `project.requires-python` 的读取与宿主 Python 比较。
- PEP 440 不等同 npm semver。Host 使用独立 `pep440_rs` 库解析范围，前端只消费匹配的 Host 评估结果。
- 复用现有只读清单限制、宿主工具路径筛选和版本探测，不执行项目 `.venv` 或构建后端。
- 动态生成的 requires-python 与 Poetry 专用声明保留未支持状态；项目虚拟环境、自定义解释器与依赖验收是后续工作。
- 已安装预发布解释器按 PEP 440 的已安装例外进行范围匹配；这不代表依赖解析器将选择相同预发布版本。

## 实现与关键决定

- 新增 `python_requirements.rs`，独立负责 pyproject TOML 声明提取和版本评估；引入锁定的 `pep440_rs 0.7.3` 及其 `unscanny 0.1.0` 依赖，其余依赖版本未因本轮升级。
- 复用 256 KiB 内容上限、200 字符声明上限和项目边界检查；文件类型错误、静态/动态重复声明、非法范围均保留失败状态。
- 标准 `project.requires-python` 优先作为公开运行要求；缺少该声明但存在 Poetry Python 声明时提示不支持，不把 caret/union 当作 PEP 440。
- 空字符串表示无版本约束；缺少声明表示没有提供此项要求，不凭 requirements.txt 中的依赖推断 Python 版本。
- 返回 Host 评估状态、规范化版本和所观察的完整版本行；前端核对观察值与工具状态，拒绝过期、未知状态、失败工具上的通过结果及旧 Host 缺少评估的响应。
- UI 保留“宿主 Python”作用域说明；项目 `.venv`、Conda/Poetry 环境及命令运行器的实际解释器仍需单独验收。

## 验证过程

- 新增 4 个 Rust 测试：静态/动态/Poetry 声明，22 组 PEP 440 范围向量，不可用/未知/截断状态，以及真实文件读取与报告字段范围。
- 22 组向量通过 Python `packaging.SpecifierSet.contains(prereleases=True)` 交叉核对，覆盖排除范围、通配符、兼容版本、预发布、开发版、后发布、本地版本和 epoch。脚本与输出保留在 `E:\tmp\zicode-python-pep440-reference.py`、`E:\tmp\zicode-python-pep440-reference.log`；此策略针对已安装解释器，不等同解析器候选选择。
- 真实 Host WebSocket 测试新增 pyproject 夹具；确认版本评估与同一报告的 Python 版本一致，不返回构建后端内容，未执行构建后端。
- 新增前端评估 8 项与环境组件 1 项测试；定向 15 项通过。完整前端/扩展/网关 36 个文件、472 项通过。
- 首次编译在测试文件尚未落盘时失败；补齐后编译通过。首轮 `check:rust` 的 Python 相关用例通过，但现有 P2P Host 测试的 Windows 临时目录清理偶发文件占用，导致整体退出失败；单独复跑该用例通过，完整平台门禁的 Rust 测试也全部通过。未修改 P2P 产品逻辑或隐藏失败。
- 平台门禁 Rust 默认合计 333 项通过、5 项忽略；静态/设计检查保留原有 111 warnings / 7 infos，翻译 2241 项、缺失 0。React 相关资源已重建。
- 浏览器通道再次报 `nodeRepl.fetch request failed`，实际流程「项目 → 开发环境 → 查看 Python 范围/宿主版本 → 刷新」未获得 WebView 证据。按 frontend-testing-debugging 技能保留视觉验收，没有新增截图或替换通道。

## 边界与后续

- 当前 Python 探测仍来自宿主 PATH，并排除项目内可执行文件；只读环境诊断不会执行项目解释器或安装工具。
- Python 版本满足不等同依赖完整、扩展 ABI 兼容、环境可重建或项目能运行；动态构建后端和 Poetry 专用约束尚未解析。
- macOS/Linux 实机与完整交付尚无本轮证据；没有推送、发布或生成安装包。
- 现有 P2P 测试目录清理的偶发占用已记录，未来应验证 Host 关闭资源回收，而不是仅靠增加等待掩盖原因。

## 统一检查

- 本轮证据目录：`E:\tmp\zicode-python-environment-evidence\win32-x64-07e3c393-2e7b-495d-8f1f-72fd33034b79`。
- 10 项必需检查全部通过，状态 `passed_with_warnings`，Rust 全仓格式仍为既有 advisory。真实 Cargo/Go 临时项目和 Python 虚拟环境生命周期用例通过；MkDocs 严格构建和差异空白检查通过。所有证据来自 Windows 本地未提交工作区，整体开发者平台目标继续推进。

