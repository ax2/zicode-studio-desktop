# ZiDevTools 图片缩放插件候选

此候选只实现一个 Studio capability：`devtools.image.resize`。它对用户在 Studio 资源选择器中明确选择并授权的一张 PNG、JPEG 或 WebP 图片缩放，然后生成一项 PNG、JPEG 或 WebP 派生资源。它不读取文件路径、环境变量或网络，也不自动保存或覆盖源文件。

Studio 工具中心负责资源选择与授权；插件本身只接受有限的宽度、输出格式和质量参数。输入宽度限制为 1–4096 像素，JPEG 质量为 35–95；质量参数只影响 JPEG，PNG 与当前 WebP 编码均为无损输出。图片宽高分别不得超过 4096，总像素不得超过 16 MP，输入与输出各不得超过 32 MiB。WASM 使用 `resource.wasi.image.resize.v1@1.0.0-preview.1` profile：每次最多 256 MiB guest memory、30B fuel 与 10 秒执行时间；并发和资源 lease 由 Host 管理。

目录包使用 `runtime/tools.wasm`，清单要求 schema v2、精确预览 profile 与最小 `resource.read` 权限。`catalog.json` 将该单一 capability 映射到 DevTools 的 `image-workflow` 0.11.0；它不是完整图片工作流的迁移声明。

本候选按未签名提供方目录交付。没有授权的 Ed25519 发布者密钥时，不生成伪签名或声称可由 Studio 签名包安装器验证。Studio Host 源码可静态校验该 manifest 形状；真正安装、权限授权、资源登记、预览、接力、保存、取消、lease 回收和完整并发验收仍由 Studio owner 完成。
