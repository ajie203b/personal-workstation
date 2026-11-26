# 发布与打包

Windows 终端使用 PowerShell 7（`pwsh`）。用户目录名含单引号，拼路径用 `Join-Path $env:USERPROFILE ...`。

从仓库根目录执行。将待发改动提交到 `main`，保持工作区干净。打 APK 需要本机 Android 签名环境，云端打包和发布还需要已登录的 GitHub CLI。

| 用户意图 | 命令 |
| --- | --- |
| 发布新版（APK、Windows 安装包、GitHub Release、Pages） | `npm run --silent release` |
| 只打 APK | `npm run --silent release -- apk` |
| 打 APK 和 Windows 安装包 | `npm run --silent release -- windows` |
| 查看用法 | `npm run --silent release -- help` |

脚本自动处理补丁升版、更新记录和发布核验。等待同一进程结束，退出码 0 且 JSON 的 `ok` 为 `true` 即成功。失败时读 `error` 和可选的 `hint`，修复后执行 `retry` 给出的命令，否则重跑原命令。需要细节时只读 `log` 文件末尾。
