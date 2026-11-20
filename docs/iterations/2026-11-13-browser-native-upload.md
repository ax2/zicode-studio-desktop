# Windows 原生上传与窄窗边界 — 2026-11-13

对应 GitHub [#7](https://github.com/ax2/zicode-studio-desktop/issues/7)，计划纳入 v0.5.10。此批是开发修复与真实Windows验收，不是正式安装或发布。

## 行为

浏览器专用容器使用2px边距，既提供更宽网页区域，也避免175% DPI下舍入坐标超出原生窗口。网页区域窄于约400px时显示“全屏后选择文件”，复用现有Host全屏与恢复功能，保持同一网页。启动未就绪时该入口与导航一起禁用。未改变Host边界检查、网页权限或文件选择机制。

## 实际验证

复用已保留的Windows debug EXE（报告0.5.9），SHA256 `F2802BEA689386BED0CF996A87B768AA257AF175AFB5799AC7BD04E7FCBCC186`，从独立修复工作树读取前端；没有重新完整构建或覆盖已发布候选。主开发树按精确文本移植，浏览器JS（除尾部空行）和CSS与实测源一致，主树和独立树均189项浏览器测试及bun check通过。

隔离配置、自建HTTPS服务、现有Playwright连接真实WebView2 157、限定进程树的Windows原生文件选择器；没有用setInputFiles替代系统窗口，没有调用外部模型/生产服务。Browser插件不可用，因此使用现有Playwright。

| 请求窗口宽度 | 实际UI尺寸 | 原生网页尺寸 | 结果 |
|---|---|---|---|
| 422 | 422×801 | 419×596 | 直接选择/取消/明确提交通过 |
| 360 | 361×600（DPI舍入） | 全屏后1701×1005 | 全屏入口、文件操作与退出恢复通过 |
| 1000 | 1001×801（DPI舍入） | 946×708 | 选择/取消/明确提交回归通过 |

每个尺寸验证：空选择取消；原生窗口选择中文名自建文本；再次取消保留同一FileList与完整字节；没有隐式上传；切换Notes后同一文档和未提交文本/文件保留；明确提交后本地HTTPS服务收到精确字节。三组共9个原生对话框，网页总GET仅1次，三次明确POST；零页面错误和控制台警告，测试进程正常退出。360与422的应用切换动作在临时1000px下执行，不能据此宣称窄窗导航入口本身验收。

360宽度的Studio主WebView截图不能包含其原生子WebView；网页非空由独立native page截图、正文和真实上传回执证明，不能把主WebView截图的空白区域误判为页面不可用。

## 失败与证据

本会话工作区 `outputs/browser-upload-native-acceptance.json` 保留原422px/399网页宽度的WebView2最小400×300拒绝。`browser-upload-fit-attempt1`至`attempt4`保留开发修复期间的导航/恢复失败；最终实际Host诊断确认为viewport超出owner窗口。修复用2px边距，未放宽Host限制。

最终 `outputs/browser-upload-fit-acceptance.json`、`browser-upload-fit-422.png`、`browser-upload-fit-360.png`、`browser-upload-fit-1000.png`，以及`browser-upload-fit-main-check.log`、`browser-upload-fit-main-tests.log`。原始文件选择失败和中间失败没有覆盖。

仅新建隔离profile和自建样本；日常用户程序、固定资料选择、笔记与凭据没有写入或关闭。未声称真实网站上传兼容性、多文件/目录上传、其他DPI/平台或已安装交付。

入口文件超过500行，本次只增加按钮组合与启动状态接线，继续复用现有全屏模块，不新增原生权限或并行控制器。
