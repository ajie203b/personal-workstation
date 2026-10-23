# Kairos 一键出包 / 发布
# 用法（在仓库根目录，用 PowerShell 7）：
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1             只打 APK
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Exe        APK + Windows exe（云端打，下载到本地）
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Publish    APK + exe + 推标签 + 发 GitHub Release
#   加 -SkipPull 不切 main、不拉代码（测某个分支时用）
# 产物都放在仓库的 apk\ 目录（已在 .gitignore 里）。
# -Exe / -Publish 需要 GitHub CLI：winget install GitHub.cli，然后 gh auth login
param(
    [switch]$Exe,
    [switch]$Publish,
    [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
$ExpectedSha256Prefix = 'D3:2D:F3:EC'
$DesktopWorkflow = 'desktop.yml'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if ($Publish) { $Exe = $true }

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "失败：$exe $($argv -join ' ')（退出码 $LASTEXITCODE）" }
}

# ---------- 预检 ----------
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'jdk-21'
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "找不到 JDK：$env:JAVA_HOME" }
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

if ($Exe) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw '没装 GitHub CLI：先运行 winget install GitHub.cli，重开终端后 gh auth login'
    }
    gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI 没登录：先运行 gh auth login' }
}

if (-not $SkipPull) {
    Step '切到 main 并拉取'
    $dirty = git status --porcelain
    if ($dirty) { throw "工作区有未提交改动，先处理：`n$dirty" }
    Run git @('checkout', 'main')
    Run git @('pull')
}

$pkgVer = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$gradle = Get-Content android\app\build.gradle -Raw -Encoding UTF8
$verName = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
$verCode = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
Write-Host "package.json $pkgVer / versionName $verName / versionCode $verCode"
if ($pkgVer -ne $verName) { throw "版本不一致：package.json=$pkgVer，build.gradle=$verName" }
$tag = "v$verName"

if ($Publish) {
    Run git @('fetch', '--tags', '--quiet')
    if (git tag --list $tag) { throw "标签 $tag 已存在，先升版本号" }
    $notes = [regex]::Match((Get-Content CHANGELOG.md -Raw -Encoding UTF8),
        "(?ms)^## $([regex]::Escape($tag))\b[^\n]*\n(.*?)(?=^## |\z)").Groups[1].Value.Trim()
    if (-not $notes) { throw "CHANGELOG.md 里没有 $tag 的条目，先写更新记录" }
}

# ---------- APK ----------
Step 'npm install'
Run npm @('install')

Step 'npm run build'
Run npm @('run', 'build')

Step 'cap sync android'
Run npx @('cap', 'sync', 'android')

Step 'gradlew assembleRelease'
Push-Location android
try { Run .\gradlew.bat @('assembleRelease') } finally { Pop-Location }

$apk = Join-Path $Root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "没找到 APK：$apk" }

Step '核对签名'
$sdk = $env:ANDROID_HOME
if (-not $sdk -and (Test-Path android\local.properties)) {
    $line = Select-String -Path android\local.properties -Pattern '^sdk\.dir=(.+)$' | Select-Object -First 1
    if ($line) { $sdk = $line.Matches[0].Groups[1].Value -replace '\\\\', '\' -replace '\\:', ':' }
}
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$apksigner = Get-ChildItem "$sdk\build-tools\*\apksigner.bat" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if ($apksigner) {
    $certOut = & $apksigner.FullName verify --print-certs $apk 2>&1 | Out-String
    $m = [regex]::Match($certOut, 'SHA-256 digest:\s*([0-9a-fA-F]+)')
    if (-not $m.Success) { throw "apksigner 没读到签名：`n$certOut" }
    $sha = (($m.Groups[1].Value.ToUpper() -split '(.{2})') | Where-Object { $_ }) -join ':'
} else {
    $certOut = & keytool -printcert -jarfile $apk 2>&1 | Out-String
    $m = [regex]::Match($certOut, 'SHA256:\s*([0-9A-F:]+)')
    if (-not $m.Success) { throw "keytool 没读到签名：`n$certOut" }
    $sha = $m.Groups[1].Value
}
Write-Host "SHA-256 $sha"
if (-not $sha.StartsWith($ExpectedSha256Prefix)) {
    throw "签名不对！应以 $ExpectedSha256Prefix 开头，装了会覆盖失败，已停止"
}
Write-Host '签名一致，可以覆盖安装' -ForegroundColor Green

$outDir = Join-Path $Root 'apk'
New-Item -ItemType Directory -Force $outDir | Out-Null
$apkOut = Join-Path $outDir "personal-workstation-$tag.apk"
Copy-Item $apk $apkOut -Force
Write-Host "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length / 1MB, 1)) MB）" -ForegroundColor Green

# ---------- 发布 / 触发 exe ----------
function Wait-DesktopRun($event, $since) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 4
        $runs = gh run list --workflow $DesktopWorkflow --event $event --limit 5 `
            --json databaseId,createdAt | ConvertFrom-Json
        $run = $runs | Where-Object { ([datetime]$_.createdAt).ToUniversalTime() -ge $since } |
            Select-Object -First 1
        if ($run) { return $run.databaseId }
    }
    throw '两分钟内没等到桌面版打包任务启动，去 GitHub Actions 页面看看'
}

if ($Exe) {
    $since = (Get-Date).ToUniversalTime().AddSeconds(-30)

    if ($Publish) {
        Step "推送标签 $tag 并创建 Release"
        Run git @('tag', $tag)
        Run git @('push', 'origin', $tag)
        $notesFile = Join-Path $env:TEMP "kairos-notes-$tag.md"
        Set-Content -Path $notesFile -Value $notes -Encoding UTF8
        Run gh @('release', 'create', $tag, $apkOut, '--title', $tag, '--notes-file', $notesFile)
        $runId = Wait-DesktopRun 'push' $since
    } else {
        $branch = (git rev-parse --abbrev-ref HEAD).Trim()
        Step "在云端打 exe（分支 $branch）"
        Run gh @('workflow', 'run', $DesktopWorkflow, '--ref', $branch)
        $runId = Wait-DesktopRun 'workflow_dispatch' $since
    }

    Step "等待桌面版打包（任务 $runId，一般 10 分钟左右）"
    Run gh @('run', 'watch', "$runId", '--exit-status', '--interval', '20')

    Step '下载 exe'
    $tmp = Join-Path $env:TEMP "kairos-exe-$runId"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Run gh @('run', 'download', "$runId", '-n', 'Kairos-windows', '-D', $tmp)
    Get-ChildItem $tmp -Filter *.exe -Recurse | ForEach-Object {
        Copy-Item $_.FullName $outDir -Force
        Write-Host "exe：$(Join-Path $outDir $_.Name)" -ForegroundColor Green
    }

    if ($Publish) {
        $assets = gh release view $tag --json assets --jq '.assets[].name'
        Write-Host "`nRelease $tag 附件：" -ForegroundColor Green
        $assets | ForEach-Object { Write-Host "  $_" }
        if (-not ($assets -match '\.exe$')) { Write-Warning 'Release 上还没看到 exe，稍后刷新确认' }
        gh release view $tag --json url --jq '.url'
    }
}

Write-Host "`n完成。" -ForegroundColor Green
