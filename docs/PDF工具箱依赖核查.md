# PDF 工具箱依赖核查（2026-10-23）

新增依赖固定为 `@neslinesli93/qpdf-wasm@0.3.0`。npm 包约 1.38 MB、无运行时依赖、没有安装脚本，以 `npm install --save-exact --ignore-scripts` 安装。包元数据声明 ISC，内置 qpdf 12.2.0 使用 Apache-2.0；保留许可证与来源在 `public/licenses/`。参考 BentoPDF 的功能流程，未复制其 AGPL 应用源码。

实现依据：qpdf 12.2 的 Encryption、Optimizing File Size、Exit Status 与 Unicode Passwords 章节。WASM 在独立 Worker 内执行，文件仅写内存文件系统。参数作为字符串数组传给 qpdf，不经过 shell；输出和错误日志被拦截，用户只接收经过分类的错误。Worker 在取消、超时、成功或失败时销毁。

`npm audit` 的新增引擎未报告漏洞。现有 6 个 high 计数涉及开发依赖链：`vite`/`launch-editor` 和 `vite-plugin-static-copy` → `chokidar`/`fast-glob` → `micromatch`/`braces`。它们不进入发布后的浏览器/安卓运行时；本次验证服务仅监听 127.0.0.1，静态资源模式来自固定项目配置，不接收 PDF 的输入内容。保留现有依赖版本，避免顺带跨主版本更改构建插件。下次构建工具维护时处理，复核日期 2026-11-23。审计原始结果保存在本机忽略目录 `testdata-sample.mobile/pdf-audit.json`。
