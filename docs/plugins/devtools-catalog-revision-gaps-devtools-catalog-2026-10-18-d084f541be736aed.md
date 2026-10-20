# ZiDevTools 全目录修订逐项接入缺口（2026-10-18）

来源：Studio 冻结的 [devtools-catalog-2026-10-18-d084f541be736aed](../../tests/fixtures/devtools-catalog-2026-10-18-d084f541be736aed/package-map.json)，包外收据已逐文件、目录索引和语义核验。修订 SHA-256：`d084f541be736aed8ff6698eed4669a21f5531d5726e5cae11daec5ee6293b08`。本页由 `scripts/render-devtools-catalog-gaps.mjs` 从冻结字节生成；修改原因应先取得提供方新修订，不能编辑冻结夹具。

范围：154 个源工具；六个无签名候选包有具体操作映射的源工具 31 个；其余 123 个在这六包中无操作映射。提供方另将 `spring-actuator` 标为 candidate，但本修订没有它的包操作映射。候选映射、Host 子能力或历史 Windows 样例均不等于完整工具验收；完整接受仍 0/154。

下面的原因逐项沿用提供方 `uncoveredScope` 声明，属于待核验的交付范围说明；Studio 的责任与重开条件按迁移类别列出。任何行都不表示永久不可接入。需要正式签名包、收据、完整范围与真实 Host/Worker/Pi/View、权限/取消/错误/结果接力及跨平台验收后，才能更新接受状态。用户决定暂不启用的 JSON 对象插件保持禁用。

| 源 ID / 工具 | 提供方版本 / 状态 | 本修订候选映射 | 未覆盖范围或阻塞原因 | 责任方 / 重开条件 |
| --- | --- | --- | --- | --- |
| advanced-calculator / 全能计算器 | 0.15.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| agent-claude / Claude CLI 适配器 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| agent-codex / Codex CLI 适配器 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| agent-replay / Agent 记录查看器 | 1.1.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| agent-runner / Agent 任务工作台 | 1.10.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| agent-scheduler / 定时任务与触发器 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| anythingllm / AnythingLLM 连接器 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| app-delta-update / 增量更新与回滚 | 0.2.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| app-update-check / 程序更新检查 | 0.8.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| artifact-hub / 类型化资料与结果 | 0.13.1 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| ascii-art / ASCII Art 字符画 | 1.0.1 / implemented | 本修订无候选包映射 | 仅计算部分可提取；完整字符工具的主动复制、图片资源读取与TXT保存需分别协商Host授权，不用文字子集代替完整工具。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| ascii-codes / ASCII 码表 | 1.0.1 / implemented | 本修订无候选包映射 | 仅计算部分可提取；完整字符工具的主动复制、图片资源读取与TXT保存需分别协商Host授权，不用文字子集代替完整工具。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| base64 / Base64 | 1.1.3 / implemented | com.zicode.devtools.text@0.4.1 | 文本插件0.4.1候选包含Base64/SHA；七项既有能力声明Studio目录分类、用途和中英文别名；43条native/WASI一致性、官方Wasmtime fuel/冷启动及两主题View已通过，Studio Host/Pi待验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| browser-clipper / 网页与对话收集 | 1.2.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| calendar-planner / 万年历与日程 | 1.7.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| case-convert / 命名转换 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| celery-diagnostics / Celery 任务故障分析 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| checksum-manifest / 校验清单 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| cidr / IPv4 CIDR | 1.0.2 / implemented | com.zicode.devtools.inspect@0.1.2 | 共享纯Rust检查核心的全部既有操作均有界迁移；unsigned 0.1.2新候选增加tool.open.v1只定位UI、不执行能力，Studio Host/Pi待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| clipboard-actions / 剪贴板动作 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| clipboard-workflows / 剪贴板数据工作流 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| clock-workbench / 全功能时钟 | 0.7.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| color / 颜色转换 | 1.0.2 / implemented | com.zicode.devtools.inspect@0.1.2 | 共享纯Rust检查核心的全部既有操作均有界迁移；unsigned 0.1.2新候选增加tool.open.v1只定位UI、不执行能力，Studio Host/Pi待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| command-collections / 工作区与工具集合 | 0.3.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| cron / Cron 表达式 | 1.0.2 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| crypto / 加密与签名实验台 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| csv-merge / CSV 合并与关联 | 1.2.0 / implemented | 本修订无候选包映射 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| curl-import / cURL 导入 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| data / CSV / JSON 数据工作台 | 1.10.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| data-schema / 数据质量检查 | 1.0.2 / implemented | 本修订无候选包映射 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| data-sqlite-export / 表格另存 SQLite | 1.1.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| data-transform / 数据列变换 | 1.2.0 / implemented | 本修订无候选包映射 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| diff / 文本差异对比 | 1.0.3 / implemented | 本修订无候选包映射 | 1.0.3已通过263功能/时钟、258原预算、512混合文本对照、869原生回归与优化构建/隔离服务；258项独立冷启动全部通过（最长3277.577ms）；View/Host待验收，固定矩阵不证明全部合法输入性能，插件未交付。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| disk-inspector / 目录空间分析 | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| django-checks / Django 部署检查报告 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| django-drf / DRF OpenAPI 契约对比 | 1.3.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| django-environment / Python / Django 环境诊断 | 1.1.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| django-migrations / Django 迁移计划检查 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| django-sql / Django SQL / N+1 分析 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| django-trace / Django / Python 堆栈 | 1.0.3 / implemented | com.zicode.devtools.trace@0.1.0 | 完整文本堆栈操作共享核心，unsigned提供方候选已冻结；实际Host及Pi待验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| django-urls / Django URL / reverse 检查 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| docker-panel / Docker 本地面板 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| duplicate-files / 重复文件检查 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| embedding-playground / Embedding 工作台 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| encoding-detect / 文件编码转换 | 1.2.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| escape-suite / 转义与转码扩展 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| explorer-menu / 资源管理器统一右键入口 | 0.30.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| file-compare / 目录内容对比 | 1.2.7 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| file-intake / 文件拖放入口 | 1.3.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| file-rename / 批量重命名 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| file-search / 文件内容检索 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| files / 批量文件校验 | 1.2.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| git-workbench / Git 工作区面板 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| global-launcher / 全局快捷启动器 | 1.6.8 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| hex / UTF-8 / Hex | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| html-escape / HTML 转义 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| http / HTTP 请求调试 | 1.0.2 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| http-collections / HTTP 集合与环境 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| image-batch / 图片批处理 | 1.4.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| image-crop-annotate / 图片裁剪与标注 | 1.5.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| image-metadata / 图片元数据检查与清理 | 1.4.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| image-tools / 图片工作台 | 1.7.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| image-workflow / 图片操作流程 | 0.12.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| integrations / 本机集成发现 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| java-dependencies / Maven / Gradle 依赖冲突 | 1.3.0 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| java-environment / JDK / 构建环境诊断 | 1.1.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| java-gc-log / Java GC 日志分析 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| java-jfr / JFR 录制报告浏览 | 1.3.0 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| java-thread-dump / Java 线程转储分析 | 1.3.0 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| java-trace / Java 异常链 | 1.0.3 / implemented | com.zicode.devtools.trace@0.1.0 | 完整文本堆栈操作共享核心，unsigned提供方候选已冻结；实际Host及Pi待验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| json / JSON | 1.3.0 / implemented | com.zicode.devtools.text@0.4.1、com.zicode.devtools.json-object@0.1.0 | JSON 格式化/压缩/校验仍由 Text 0.4.1 候选提供；对象摘要另由 JSON Object 0.1.0 候选声明 result.json.v1，对象接收能力用于显式接力。提供方字节一致验证已完成，Studio Host/Pi 和结果接力仍待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| json-diff / 结构化 JSON 对比 | 1.0.4 / implemented | 本修订无候选包映射 | 完整JSON核心已共享；字段实验适配220项native/WASI、原预算及冷启动本次全部通过（最高842.455ms）；更大和复杂正则预算仍需完整验证，Host尚未验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| json-path / JSON 路径查询 | 1.0.3 / implemented | 本修订无候选包映射 | 完整JSON核心已共享；字段实验适配220项native/WASI、原预算及冷启动本次全部通过（最高842.455ms）；更大和复杂正则预算仍需完整验证，Host尚未验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| json-schema / JSON Schema 校验 | 0.2.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| jwt / JWT 内容查看 | 1.0.2 / implemented | com.zicode.devtools.inspect@0.1.2 | 共享纯Rust检查核心的全部既有操作均有界迁移；unsigned 0.1.2新候选增加tool.open.v1只定位UI、不执行能力，Studio Host/Pi待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| jwt-verify / JWT 本地验签 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| lines / 文本行处理 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| log-viewer / 日志工作台 | 0.2.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| markdown / Markdown 预览 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| mcp-connections / MCP 连接管理 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| mcp-export / MCP 客户端配置导出 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| mcp-inspector / MCP 协议调试台 | 0.4.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| mcp-permissions / MCP 工具权限 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| mcp-server / Zi DevTools MCP Server | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| memo-library / 备忘资料库互通 | 0.4.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| memos / 备忘录 | 1.5.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| model-benchmark / 本机模型性能测试 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| model-chat / 多轮模型工作台 | 0.5.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| model-compare / 模型对比评测 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| model-profiles / 模型连接配置 | 0.2.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| network / 网络诊断 | 1.1.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| number / 进制转换 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| obsidian-vault / Obsidian / Markdown 库 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| ocr-documents / 本地 OCR 文档助手 | 0.4.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| ollama-manager / Ollama 模型管理 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| openapi / OpenAPI 请求生成 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| operation-permissions / 授权写入与变更预览 | 0.4.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| parquet-workbench / Parquet / Arrow 工作台 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| pdf-text / PDF 文本提取 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| pipeline / 可组合数据管线 | 0.21.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| planner-interop / 日程进阶与互通 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugin-health / 插件健康诊断 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugin-market / 插件目录与安装源 | 0.5.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugin-sdk / 隔离进程插件 SDK | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugin-settings / 插件设置与凭据 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugin-updates / 插件版本与更新 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| plugins / 插件与连接器 | 1.15.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| prompt-library / 提示词模板库 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| qr / 二维码 | 1.0.2 / implemented | 本修订无候选包映射 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| rag-answer / 带引用的知识问答 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-eval / RAG 质量评测 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-index / 增量知识索引 | 1.4.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-ingestion / 文档解析与分块 | 1.4.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-keyword-search / 本机关键词检索 | 1.1.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-search / 混合检索工作台 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-sources / 本地知识源管理 | 1.2.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| rag-vectors / 本机向量索引 | 1.0.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| random / 随机数据生成 | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| recorder-tutorial / 教程录屏辅助 | 0.11.2 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| regex / 正则表达式 | 1.0.9 / implemented | 本修订无候选包映射 | 正则工具1.0.9为单个Unicode标量重复增加轻量识别，避开HIR展开解析的fuel开销；265项native/WASI功能和260项Wasmtime 10M fuel矩阵通过，Host未验收，更大复杂语法预算仍待验证。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| regex-replace / 正则替换 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| screen-recorder / 屏幕录制 | 1.1.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| screen-recorder-audio-gain / 录屏独立音量调节 | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| screen-recorder-audio-meter / 录屏实时音频电平 | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| screen-recorder-audio-mix / 双声源混录 | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| screen-recorder-long-audio / 录屏长时音频稳定性 | 0.1.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| screen-recorder-multimonitor / 显示器选择录屏 | 0.1.2 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| screenshot-workbench / 截图与透明套索 | 0.15.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| services / 本地服务管理 | 1.8.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| sha256 / SHA-256 文本摘要 | 1.1.3 / implemented | com.zicode.devtools.text@0.4.1 | 文本插件0.4.1候选包含Base64/SHA；七项既有能力声明Studio目录分类、用途和中英文别名；43条native/WASI一致性、官方Wasmtime fuel/冷启动及两主题View已通过，Studio Host/Pi待验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| spring-actuator / Spring Actuator 只读诊断 | 1.1.1 / implemented | 候选标签；本修订无包操作映射 | 0.1.1仅有固定health/info/metrics HTTP View候选；Studio任务生命周期profile仍是未实现草案，provider schema/vectors待Studio复核；报告资源profile亦未发布。无正式包/收据、真实Pi到Host到View未验收，完整来源范围未交付。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| spring-config / Spring 配置对比 | 1.2.1 / implemented | com.zicode.devtools.diagnostics@0.1.4 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| sql-format / SQL 格式化 | 0.3.1 / in-progress | com.zicode.devtools.text@0.4.1 | 共享纯Rust SQL格式化核心新增WASI通用方言操作；仅覆盖格式化单操作，不含桌面方言/缩进/大小写选择，Studio Host/Pi仍待接收方验收。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| sqlite / SQLite 浏览器 | 1.5.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| structured-output / 结构化输出验证 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| super-clipboard / 超级剪贴板 | 0.20.3 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| symbol-library / 特殊字符与表情 | 1.0.1 / implemented | 本修订无候选包映射 | 仅计算部分可提取；完整字符工具的主动复制、图片资源读取与TXT保存需分别协商Host授权，不用文字子集代替完整工具。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| task-center / 后台任务中心 | 1.13.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| task-runtime / 统一后台运行管理 | 0.5.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| text-escape / 文本转义 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| text-flow / 文本 / 表格流程 | 1.13.0 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| text-stats / 文本统计 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| time-zone / 时区工作台 | 0.1.2 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| timestamp / 时间戳 | 1.0.2 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| tls-inspect / TLS 证书检查 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| token-budget / Token 与上下文预算 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| unicode / Unicode 字符检查 | 1.0.2 / implemented | com.zicode.devtools.inspect@0.1.2 | 共享纯Rust检查核心的全部既有操作均有界迁移；unsigned 0.1.2新候选增加tool.open.v1只定位UI、不执行能力，Studio Host/Pi待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| unified-shortcuts / 统一前缀快捷键 | 0.7.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| url / URL 编码 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| url-inspect / URL 解析 | 1.0.2 / implemented | com.zicode.devtools.transforms@0.1.0 | 文本/数据纯计算迁移候选；需抽离核心、确定有界协议并实际构建验收，尚未接入。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
| uuid / UUID | 1.0.1 / implemented | 本修订无候选包映射 | 需资源、服务、桌面或通用扩展Host接口；不得用路径直读、独立EXE或本地HTTP绕过。 | Studio 与提供方确定版本化 Host 接口；提供方交包后 Studio 验收 |
| workflow-builder / 可视化工具工作流 | 0.0.0 / planned | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| workspace-sessions / 项目空间与工作实例 | 0.5.0 / in-progress | 本修订无候选包映射 | 独立版整体尚未完成；已有开发子集不等于该功能的插件交付。 | 提供方完成独立版对应范围并交付插件候选；Studio 接收验证 |
| yaml / YAML / JSON | 1.0.2 / implemented | com.zicode.devtools.inspect@0.1.2 | 共享纯Rust检查核心的全部既有操作均有界迁移；unsigned 0.1.2新候选增加tool.open.v1只定位UI、不执行能力，Studio Host/Pi待接收方验收。 | 提供方交付完整范围的独立包与收据；Studio 验收 |
