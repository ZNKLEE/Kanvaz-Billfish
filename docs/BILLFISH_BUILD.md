# 从源码构建

源码包不包含 node_modules、开发机工具缓存、测试用户配置或用户素材。

Windows x64 安装 Node.js 24 和 npm、Git，解压源码并在项目根目录执行：

```powershell
npm ci
npm run prepare:ffmpeg
npm start
npm run lint
npm run validate
npm run test:format
npm run test:plugins
npm run test:billfish
npm run build:win
```

验证中的可选 MCP 插件端到端检查需要在 `official-plugins/mcp-bridge` 内执行其 `npm ci`；缺少依赖时验证脚本会标明跳过。

真实 UI 检查：`npm run test:ui`。默认读取本机 `D:\本地资源库`，测试配置与保存文件位于 `.tools`，程序只读访问真实素材。高分辨率性能样本由 `node test/make-performance-fixture.js` 在 `.tools` 中创建。

构建结果位于 `dist`。本版本不配置自动发布或上游自动更新。若需要商业代码签名，应使用自己的证书配置 electron-builder；当前交付包没有发布者数字签名。

`tools/package-billfish-source.py` 是本机交付归档辅助脚本，其 Git 路径可按新机器环境修改；它不参与应用运行。
