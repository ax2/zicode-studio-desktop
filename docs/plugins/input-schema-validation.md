# Host 参数约束校验

当前源码在既有 inputSchema 子集中执行 `enum`、`const`、`minItems`、`maxItems`，并继续执行类型、字符串长度、数值范围、required、properties、additionalProperties 与 items。安装时拒绝空/非数组 enum、非非负整数数组界限、反向界限及过深嵌套。

- enum/const 使用 JSON 值比较；对象按键、数组按顺序，数字1与1.0相等。整数与浮点比较不先把整数转换成浮点，避免9007199254740993与9007199254740992误判相同。
- 不合声明的输入使用既有 `invalid_parameters` 固定码；不附加提交值。未声明字段只提示父对象存在未声明字段，不回显用户提交的未知字段名。
- 参数校验在 Worker 派发前执行，幂等缓存命中仍沿用当前 schema 复核。错误审计记录摘要和固定码，不能存原始输入。
- 字符串 maxLength 按字符计，不代表 UTF8 字节上限。诊断每字段8192字节、48KiB完整包等仍需要单独版本化协议校验。

这不是完整 JSON Schema 引擎；本轮未新增 $ref、oneOf/anyOf/allOf、if/then/else、pattern、format、uniqueItems 等的执行支持，不应依赖它们作为安全门禁。提供方需要这些约束时须提出明确版本化需求；不能把Host未执行的约束当成已验证。

初次源码验证：六专项、完整Rust425通过/18ignored及严格Clippy通过。Registry/Broker专项使用Studio自有微型声明，无Worker运行入口，验证非法枚举/常量/数组在派发前被拒绝并检查hash-only审计。该次不是实际Tauri/Pi/冻结EXE的新增行为验收；当时的af5a8964优化EXE未含此改动，旧交付未改写。诊断profile仍未支持，新提供方包仍待交付。

后续 Windows `release/plugin-contracts-2026-10-09-02bd9552-dirty` 已包含本轮约束；
自有夹具实际 View/SDK→Host 的非法枚举拒绝、有效执行及恢复通过。
原生专项未逐一覆盖所有约束，数组/数值等仍以源码测试为证据；真实 Pi 全链路和其他 OS 待验收。
