# 2026-10-01 开发环境工具分组

状态：实现与静态检查完成；真实界面验收待补。

## 目标与发现

- 环境页已并行诊断二十余种工具，单一列表中的缺失提示会掩盖当前项目实际使用的工具。
- Host 报告已经提供清单种类、版本声明、包管理器选择与全部工具诊断，可在界面侧分组，不改变探测协议。

## 修改与决策

- 从已安全读取的清单种类、显式版本要求和包管理器选择推导相关工具，保留 Host 原有顺序；Git 作为通用项目工具随相关组显示。
- 其他工具放入原生可展开区域，数量可见，仍能检查每项状态、版本和路径；没有可识别关联时展示完整列表。
- 分组只影响呈现，不改变 Host 探测、版本比较、任务执行或工作区边界。
- 后续核对发现按语言种类会误把 Bundler、Composer、Maven 和 Gradle 都列为当前项目主要工具。现仅在对应 Gemfile、composer.json、pom.xml 或 Gradle 清单被安全检测到时突出；单独的 Ruby/PHP 版本文件只突出语言运行时。普通 Python 版本文件和 requirements.txt 只突出 Python，pyproject.toml 仍列出 Poetry 与 uv 供核对。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。首次检查发现重复翻译键，移除后复查通过。
- 本轮不新增或运行测试。
- 清单细分更新后重新执行 `bun run typecheck`、`bun run check`、`bun run build:react` 与两处改动文件的 Biome 格式检查，均通过；没有运行测试或三平台实机验收。
- 清单仅能推断常见工具关系，复杂自定义构建系统需要展开其他工具；真实桌面和窄屏界面待验收。
- 本次只更新本地代码与档案；未提交、推送或发布。
