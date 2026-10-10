# 2026-09-29 WebSocket 客户端身份隔离

状态：Windows 本地编译与静态检查通过；真实多连接和远程设备验收待补。

## 目标与发现

- Host Router 以握手帧中的 `clientId` 为键记录桌面/远程类型；`connect` 会覆盖同名键，WebSocket 结束时也没有移除该条目。
- 前端在重连时会复用自己的 `clientId`。另一连接若提交同名 ID，可能改写原连接在 Router 中的类型；旧连接结束后也可能影响新连接的会话归属。
- 运行时扩展 UI 的答复权限同样按该字符串记录，因此需要与实际 WebSocket 连接绑定。

## 修改与决定

- 握手仍要求客户端提供非空、最多 128 字节的 `clientId`，用于协议兼容；Router 与扩展 UI 所有权改用每条连接由服务端生成的 UUID。
- 握手确认发送失败或连接结束时，移除该内部 ID 的 Router 记录；结束时仍清理对应的会话所有权。
- 客户端重连获得新的内部 ID，旧连接清理不会删除新连接的身份。远程 `host_request` 默认拒绝规则仍作用于每条连接自身的类型。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、两个目标文件的 rustfmt 与差异空白检查通过。
- 本轮未新增或运行测试，未建立真实双连接、远程配对或重连会话。现有 WebSocket 首帧和设备令牌路径的实际行为仍需验证。
- 回环地址的桌面身份信任边界、异常崩溃后的内存回收与真实多设备并发仍需单独审查。
