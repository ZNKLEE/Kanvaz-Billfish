# Third-Party Notices

Kanvaz is built with [Electron](https://www.electronjs.org/), distributed
under the MIT License by the OpenJS Foundation. Electron itself bundles
Chromium, Node.js, and V8, each under their own open-source licenses
(primarily BSD and MIT).

When Kanvaz is built into an installer or portable app (via
electron-builder), Electron's own license files — including
`LICENSE` and `LICENSES.chromium.html` — are automatically included
in the application's installation directory. These files contain the
full text and attribution for every third-party component bundled
inside the Electron runtime.

Kanvaz also bundles the following runtime dependencies, each under its
own MIT License:

- [electron-updater](https://www.npmjs.com/package/electron-updater) — powers the optional, click-to-check auto-updater.
- [JSZip](https://www.npmjs.com/package/jszip) — reads and writes the `.kanvaz` container format (since 4.1.0).
- [wink-nlp](https://www.npmjs.com/package/wink-nlp), [wink-eng-lite-web-model](https://www.npmjs.com/package/wink-eng-lite-web-model), and [wink-distance](https://www.npmjs.com/package/wink-distance) — power Smart Search's on-device lemmatized/fuzzy matching (since 6.3.0, off by default).

And the following, under its own license:

- [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) — Apache License 2.0, © Mozilla. Powers the scroll/zoom PDF preview on file-reference cards pointing at a `.pdf` (since 7.x). Vendored directly as two runtime files in `src/vendor/pdfjs/` (its own `LICENSE` file is included alongside them) rather than pulled in as a full npm dependency — the published package is ~35MB of locale data, CJK character maps, and a demo viewer this app never uses; only the actual rendering engine and its worker (~1.7MB total) are needed and shipped.
- [Three.js](https://threejs.org/) — MIT License, © three.js authors. Powers the live orbitable 3D model viewport on `model3d` cards (since 7.4.0) — the core renderer plus GLTFLoader/OBJLoader/FBXLoader/STLLoader/PLYLoader/VOXLoader/USDLoader (STL/PLY/VOX/USD added v8.x) and OrbitControls. Vendored directly as source files in `src/vendor/three/` (its own `LICENSE` file is included alongside them) rather than pulled in as a full npm dependency, following the same "only the runtime pieces this app actually uses" reasoning as pdf.js above.
- [fflate](https://github.com/101arrowz/fflate) — MIT License, © Arjun Barrett. A standalone (not Three.js's own) zip/deflate library that Three.js's own `USDLoader` uses for decompressing `.usdz` archives (`.usdz` is a zip container). Already vendored at `src/vendor/three/libs/fflate.module.js` since 7.4.0's original Three.js drop (presumably pulled in wholesale with Three's own `examples/jsm/` tree at the time) but never given its own attribution line until v8.2.0 put it to actual use — closing that gap here, exactly as Three.js's own examples ship it, rather than pulled in as a separate npm dependency.
- [Feather Icons](https://feathericons.com/) — MIT License, © Cole Bemis. The icon set used across the titlebar, toolbar, media controls, annotation tools (since 7.7.0), and the Layers panel's pin/visibility icons (since 7.22.0) — individual icon paths copied directly into the relevant `.js`/`.html` files rather than vendored as a library, since only a small, fixed subset of the full icon set is used.
- [FFmpeg 8.1 LGPL shared build](https://github.com/BtbN/FFmpeg-Builds) — Windows x64 runtime from BtbN's FFmpeg-Builds, used for sequence playback proxies and fallback video decoding. The pinned archive is `ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip`, SHA-256 `10FA2FDCBBD4554C480A8E81AF681F07C060B717921EA3E70EE78BD8C3B6CD7C`. This is the LGPL shared configuration (no GPL-only codecs); its `LICENSE.txt` ships in `resources/ffmpeg/`. Build instructions and a hash-checking fetch script are included in the source package.

Kanvaz's own source code (everything in `src/`, `docs/`, and this
repository) is © Atharva Patil | P4inz | P4inz Interactive Labs, licensed under the
MIT License — see [LICENSE](LICENSE).

Build tooling (`electron-builder` and its dependencies) is used only to
produce the installers and is not included in the shipped application.

---

# 开源声明

本项目基于 Kanvaz 9.8.2（https://github.com/p4inz-code/kanvaz）。
原作者：Atharva Patil | P4inz | P4inz Interactive Labs。
Kanvaz 使用 MIT 许可证，原始 LICENSE 文件完整保留。

Billfish 只读连接器、关联素材浏览器和中文语言包为本项目新增代码。
本项目不包含 Billfish 程序代码、数据库或用户素材；不是 Billfish 官方产品。
billfish-webui 仅作数据结构参考，未复制其代码。

Electron、Chromium、Node.js 与其他依赖的许可证随运行时及各 npm 包保留。
定制版本与上游使用不同的应用标识、用户数据目录和 Windows 文件关联 ProgID。
定制版本不接收上游自动更新包。
