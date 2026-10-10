# 发布可执行文件架构校验

日期：2026-10-02。状态：实现与 Windows 内嵌运行时检查完成，其他平台真实产物待补。

## 实现

文件名不足以证明架构。本轮新增独立头部解析：Windows PE 的 Machine 与 PE32+ 标记、Linux ELF64 的 class/byte order/machine、macOS thin Mach-O64 的 magic 与 CPU type。只接受当前四个发布目标；32 位、其他 CPU、截断、未知格式与不匹配目标拒绝。读取最多 1 MiB 并关闭文件描述符，不加载完整的大型运行时文件。

发布流程下载内嵌运行时后检查 Pi 与 Bun 的实际头部。上传产物校验还要求定位到唯一的构建后主程序，并检查其架构。头部测试纳入跨平台统一入口。

格式依据：[Microsoft PE/COFF](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)、[ELF ABI](https://refspecs.linuxfoundation.org/elf/x86_64-SysV-psABI.pdf)、Apple 的 [Mach-O 头](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h)与 [CPU 类型](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/machine.h)。

## 当前证据

- 本机 `src-tauri/resources/pi/pi.exe` 与 `src-tauri/resources/bun/bun.exe` 头部均识别为 Windows x64。
- 二进制头、发布文件策略与平台检查脚本：3 个文件、17 条用例通过。跨平台头部来自人工构造的测试数据，不能报告为真实 macOS/Linux 产物。
- 发布校验与运行时检查脚本语法检查通过，代码/设计检查退出 0；既有 advisory 保留。
- 未构建桌面主程序，未执行远端工作流，未上传、发布或安装产物，未产生 Rust 构建缓存。

## 范围与后续

头部架构核对不是完整可执行格式校验、签名验证或启动测试，不解析安装包内部文件。当前发布按单一架构提供，Universal/Fat Mach-O 尚不接受；若未来提供 Universal 包，需要显式增加切片校验与发布清单。安装、升级与三平台运行仍待实机证据。
