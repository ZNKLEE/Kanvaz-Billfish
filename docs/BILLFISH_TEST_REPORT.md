# 交付验证记录

测试平台：Windows 10 x64；Kanvaz 9.8.2；Electron 44.4.3。测试日期：2026-10-13。

## 自动检查

- `npm run lint`：零错误；保留上游五条警告（旧版本迁移标记、可选主题插件颜色）。
- `npm run validate`：通过，包括保存保护、格式限制、插件安全、浏览器端口和 MCP 集成检查。
- `npm run test:format`、`npm run test:plugins`：通过。
- `npm run test:billfish`：只读 SQLite、query_only、64 位 ID、分片预览、移动和缺失引用、独立 UUID、保存目录保护、关联保存与完整导出、原文件校验和、1185 条集中翻译检查通过。
- `npm run test:sequence`：通过帧号排序、缺帧、重复帧、多组和 PNG/JPEG/WebP/TIFF/EXR/DPX 扩展名测试。

## 真实 Electron 界面

`test/billfish-ui-test.js` 的隔离性能场景通过 30 张高分辨率图像加载测试，并验证 48 帧 24 fps 序列的 2 秒时间轴、视频本地引用、受控 Range 媒体协议、默认暂停和不嵌入视频内容。另用打包便携版播放 MPEG-4 Part 2 编码 AVI，确认浏览器不支持时生成 WebM 代理且代理实际就绪。测试期间未出现 renderer pageerror。

保存后重启验证：素材 ID 引用、位置、尺寸、35 度旋转和 0.75 画布缩放恢复。外部多路径启动进入同一窗口，重复请求不重复添加。

30 张 4096×3072 图片测试使用独立合成素材库：初始只加载可见卡片，适应画布后全部显示；主进程预览缓存保持在 32 MiB 预算内。该检查不等同于对所有真实大图格式的性能保证。

## Windows 包验证

安装版在项目内的隔离目录静默安装，实际启动已安装 EXE 并打开保存文件；便携 EXE 实际启动并打开保存文件。验证 1.5 倍设备缩放。卸载后检查原有 .png、.jpg、.kanvaz 默认打开程序保持不变。

执行脚本：`test/billfish-installer-test.js`、`test/billfish-ui-test.js`。最终构建和运行日志位于交付目录 `dist/verification`；校验值见 `dist/SHA256SUMS.txt`。

## 已知范围

追加启动器验证：`素材板启动器.exe` 复制到与主程序不同的目录后，实际启动便携版并成功恢复已保存的素材板、引用、旋转、尺寸和视角。它是可手动导入 Billfish 的 EXE 素材入口；本次没有自动执行 Billfish 导入操作。使用说明见 `BILLFISH_LAUNCHER.md`。

- 本项目是独立 Kanvaz 桌面应用。Billfish 主窗口顶部标签和原生右键菜单没有实现。
- 视频实际界面集成测试覆盖 WebM 直接播放和 MPEG-4 Part 2 AVI 的代理回退；MP4、MOV、MKV、AVI 其余编码组合及音频控制未逐项建立测试样本。代理转换进度和取消界面尚未完成。
- EXR/DPX 的逐帧解码、HDR 映射、视频代理取消与进度 UI，以及跨计算机的源文件重新关联尚未完成验证。
- MD、JSX、KYS 的 Billfish 原生导入扩展不属于本交付；第三方插件自定义文案不保证完整汉化。
- 本机无法创建测试符号链接，插件测试中的该分支未执行；未安装 Blender，其实际转换未执行。
- 自动保存和异常恢复沿用并加强上游机制；未模拟断电或操作系统级磁盘损坏。
- 发布包未提供商业代码签名证书；不包含任何安全保护绕过。
