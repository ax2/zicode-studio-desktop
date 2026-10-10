# 签名插件包与发布

`.zicode-plugin` 是 ZiCode 应用插件的正式本地分发格式。它是 ZIP 容器，但扩展名固定为
`.zicode-plugin`；程序阶段版本仍不使用 ZIP。

## 信任模型

安装分为两件独立的事：

1. 验证包内容确实由某个 Ed25519 密钥签发；
2. 确认用户是否信任该密钥代表的发布者。

包内公钥不能自行建立信任。未知密钥第一次安装时，插件管理器显示发布者、64 位十六
进制 SHA-256 密钥指纹和权限清单；只有用户确认后才写入本机发布者信任库。撤销发布者
会禁用并卸载其活动注册项，之后同一密钥签发的包都会被拒绝。

## 容器结构

```text
example.zicode-plugin
├── package.json
├── plugin.json
├── views/...
├── runtime/tools.wasm
└── assets/...
```

`package.json` 包含固定顺序的签名载荷：

```json
{
  "schemaVersion": 1,
  "publisher": {
    "name": "Example Publisher",
    "keyId": "<sha256-of-raw-public-key>",
    "publicKey": "<base64-raw-ed25519-public-key>"
  },
  "files": [
    {
      "path": "plugin.json",
      "sha256": "<sha256>",
      "size": 1234
    }
  ],
  "signature": "<base64-ed25519-signature>"
}
```

签名内容是去掉 `signature` 后对上述 JSON 对象执行紧凑 JSON 序列化得到的 UTF-8
字节。文件列表按路径排序。

## 创建包

先在安全位置生成 Ed25519 私钥；私钥不得放入插件目录或提交到仓库：

```powershell
bun run plugin:keygen C:\secure\publisher-private.pem
bun run package:plugin examples/plugins/view-demo `
  --key C:\secure\publisher-private.pem `
  --out view-demo.zicode-plugin
```

打包器拒绝 `.env`、私钥、PFX、Source Map、符号链接、超过 10 MiB 的单文件、超过
2,048 个文件或 50 MiB 的展开内容。它不会输出私钥，只显示公钥指纹。

## 安装、更新与回滚

- Plugin Manager 的“安装签名插件包”先完成全部验证，再弹出发布者确认；
- 解包只写入随机 staging 目录，绝对路径、`..`、反斜杠、ADS、链接和未签名额外文件
  在写磁盘前被拒绝；
- 新版本验证并注册成功后才切换活动目录；失败恢复旧目录和元数据；
- 旧版本保留在 `signed-versions`，插件管理器提供显式回滚按钮；
- 回滚失败会恢复原活动版本；卸载默认保留插件数据。

## 当前安全边界

签名包 View 使用与 Developer View 相同的 opaque iframe 和限制性 CSP。签名只解决内容
完整性与发布者身份，不等于后台代码沙箱；因此签名包的 JavaScript Worker 默认不运行。
现有 Rust Host 已有 `runtime.wasi` 的 WASI Preview 1 执行基础；公开分发仍需完成
沙箱与供应链验收。ZiDevTools 首批的实际边界和待修复项见
[独立插件交付规范](devtools-interoperability.md)，不能把构建出 WASM 当成 Host 验收通过。
