# Kairos 一键出包 / 发布
# 用法（在仓库根目录，用 PowerShell 7）：
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1             只打 APK
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Exe        APK + Windows exe（云端打，下载到本地）
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Publish    APK + exe + Release + Pages + 线上版本核验
#   加 -SkipPull 不切 main、不拉代码（测某个分支时用）
# 产物都放在仓库的 apk\ 目录（已在 .gitignore 里）。
# -Exe / -Publish 需要 GitHub CLI：winget install GitHub.cli，然后 gh auth login
[CmdletBinding()]
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
$outDir = Join-Path $Root 'apk'
$logDir = Join-Path $outDir 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$LogFile = Join-Path $logDir "release-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8)).log"
Write-Host "详细日志：$LogFile"
trap {
    $failureRecord = $_
    Add-Content -LiteralPath $LogFile -Value "失败：$($failureRecord.Exception.Message)" -Encoding UTF8
    Write-Host "失败：$($failureRecord.Exception.Message)`n详细日志：$LogFile" -ForegroundColor Red
    throw $failureRecord
}

function Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
    Add-Content -LiteralPath $LogFile -Value "`n[$(Get-Date -Format 'HH:mm:ss')] $msg" -Encoding UTF8
}
function Run($exe, [string[]]$argv, [switch]$Capture) {
    Add-Content -LiteralPath $LogFile -Value "> $exe $($argv -join ' ')" -Encoding UTF8
    $lines = [Collections.Generic.List[string]]::new()
    & $exe @argv 2>&1 | ForEach-Object {
        $line = $_.ToString()
        $lines.Add($line)
        Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
        if (-not $Capture -and $VerbosePreference -eq 'Continue') { Write-Host $line }
    }
    if ($LASTEXITCODE -ne 0) {
        $lines | Select-Object -Last 12 | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "失败：$exe $($argv -join ' ')（退出码 $LASTEXITCODE）"
    }
    if ($Capture) { $lines }
}

# ---------- 预检 ----------
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'jdk-21'
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "找不到 JDK：$env:JAVA_HOME" }
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

if ($Exe) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw '没装 GitHub CLI：先运行 winget install GitHub.cli，重开终端后 gh auth login'
    }
    Run gh @('auth', 'status')
}

if (-not $SkipPull) {
    Step '切到 main 并拉取'
    $dirty = Run git @('status', '--porcelain') -Capture
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
    # 只检查本次标签，历史标签有同名差异也不会阻塞新版本，更不会覆盖它们。
    if (Run git @('tag', '--list', $tag) -Capture) { throw "标签 $tag 已存在，先升版本号" }
    if (Run git @('ls-remote', '--tags', 'origin', "refs/tags/$tag") -Capture) {
        throw "远端标签 $tag 已存在，先核对已发布版本，不要重复发版"
    }
    $notes = [regex]::Match((Get-Content CHANGELOG.md -Raw -Encoding UTF8),
        "(?ms)^## $([regex]::Escape($tag))\b[^\n]*\n(.*?)(?=^## |\z)").Groups[1].Value.Trim()
    if (-not $notes) { throw "CHANGELOG.md 里没有 $tag 的条目，先写更新记录" }

    # Windows 的 bash 可能指向 WSL，明确使用 Git for Windows 自带的 Bash。
    $gitPath = (Get-Command git -CommandType Application | Select-Object -First 1).Source
    $gitRoot = Split-Path (Split-Path $gitPath -Parent) -Parent
    $gitBash = Join-Path $gitRoot 'bin/bash.exe'
    if (-not (Test-Path -LiteralPath $gitBash)) { throw '找不到 Git Bash，请安装 Git for Windows 后再发布' }
    if (-not (Test-Path -LiteralPath './scripts/deploy-gh-pages.sh')) { throw '缺少 Pages 部署脚本' }
    $pagesUrl = ((Run gh @('api', 'repos/{owner}/{repo}/pages', '--jq', '.html_url') -Capture) | Out-String).Trim()
    $pagesUri = $null
    if (-not [uri]::TryCreate($pagesUrl, [UriKind]::Absolute, [ref]$pagesUri) -or $pagesUri.Scheme -ne 'https') {
        throw "GitHub Pages 地址无效，请检查仓库 Pages 设置：$pagesUrl"
    }
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
    $certOut = Run $apksigner.FullName @('verify', '--print-certs', $apk) -Capture | Out-String
    $m = [regex]::Match($certOut, 'SHA-256 digest:\s*([0-9a-fA-F]+)')
    if (-not $m.Success) { throw "apksigner 没读到签名：`n$certOut" }
    $sha = (($m.Groups[1].Value.ToUpper() -split '(.{2})') | Where-Object { $_ }) -join ':'
} else {
    $certOut = Run keytool @('-printcert', '-jarfile', $apk) -Capture | Out-String
    $m = [regex]::Match($certOut, 'SHA256:\s*([0-9A-F:]+)')
    if (-not $m.Success) { throw "keytool 没读到签名：`n$certOut" }
    $sha = $m.Groups[1].Value
}
Write-Host "SHA-256 $sha"
if (-not $sha.StartsWith($ExpectedSha256Prefix)) {
    throw "签名不对！应以 $ExpectedSha256Prefix 开头，装了会覆盖失败，已停止"
}
Write-Host '签名一致，可以覆盖安装' -ForegroundColor Green

$apkOut = Join-Path $outDir "personal-workstation-$tag.apk"
Copy-Item $apk $apkOut -Force
Write-Host "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length / 1MB, 1)) MB）" -ForegroundColor Green

# ---------- 发布 / 触发 exe ----------
function Wait-DesktopRun($event, $since) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 4
        $runs = Run gh @('run', 'list', '--workflow', $DesktopWorkflow, '--event', $event, '--limit', '5',
            '--json', 'databaseId,createdAt') -Capture | ConvertFrom-Json
        $run = $runs | Where-Object { ([datetime]$_.createdAt).ToUniversalTime() -ge $since } |
            Select-Object -First 1
        if ($run) { return $run.databaseId }
    }
    throw '两分钟内没等到桌面版打包任务启动，去 GitHub Actions 页面看看'
}

function Wait-OnlineVersion([string]$siteUrl, [string]$expectedVersion) {
    $deadline = [datetime]::UtcNow.AddMinutes(3)
    $lastSeen = '尚未读取'
    for ($attempt = 0; $attempt -lt 36 -and [datetime]::UtcNow -lt $deadline; $attempt++) {
        $url = "$($siteUrl.TrimEnd('/'))/version.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        try {
            $timeout = [math]::Max(1, [math]::Min(10, [int]($deadline - [datetime]::UtcNow).TotalSeconds))
            $online = Invoke-RestMethod -Uri $url -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec $timeout
            $lastSeen = [string]$online.version
            if ($lastSeen -eq $expectedVersion) {
                Write-Host "线上版本已确认：$lastSeen（$siteUrl）" -ForegroundColor Green
                return
            }
        } catch { $lastSeen = "读取失败：$($_.Exception.Message)" }
        if ($attempt -lt 35 -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 4 }
    }
    throw "Release 已创建，但 Pages 更新未确认：期望 $expectedVersion，最后读到 $lastSeen。请检查 Pages 部署后重发网页版，本次发布未完成。"
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
        $branch = (Run git @('rev-parse', '--abbrev-ref', 'HEAD') -Capture).Trim()
        Step "在云端打 exe（分支 $branch）"
        Run gh @('workflow', 'run', $DesktopWorkflow, '--ref', $branch)
        $runId = Wait-DesktopRun 'workflow_dispatch' $since
    }

    Step "等待桌面版打包（任务 $runId，一般 10 分钟左右）"
    Run gh @('run', 'watch', "$runId", '--exit-status', '--interval', '20')

    Step '下载 exe'
    $tmp = Join-Path $env:TEMP "kairos-exe-$runId-$([guid]::NewGuid().ToString('N'))"
    Run gh @('run', 'download', "$runId", '-n', 'Kairos-windows', '-D', $tmp)
    Get-ChildItem $tmp -Filter *.exe -Recurse | ForEach-Object {
        Copy-Item $_.FullName $outDir -Force
        Write-Host "exe：$(Join-Path $outDir $_.Name)" -ForegroundColor Green
    }

    if ($Publish) {
        $release = Run gh @('release', 'view', $tag, '--json', 'tagName,assets,url') -Capture | ConvertFrom-Json
        $assets = @($release.assets | ForEach-Object { $_.name })
        Write-Host "`nRelease $tag 附件：" -ForegroundColor Green
        $assets | ForEach-Object { Write-Host "  $_" }
        $expectedExe = "Kairos_${verName}_x64-setup.exe"
        if ($release.tagName -ne $tag -or $assets -notcontains (Split-Path $apkOut -Leaf) -or $assets -notcontains $expectedExe) {
            throw "Release $tag 缺少本次 APK 或 EXE 附件，请检查桌面打包任务，本次发布未完成"
        }
        Write-Host $release.url

        Step '发布网页版和更新检测版本'
        $previousSiteUrl = $env:DEPLOY_SITE_URL
        try {
            $env:DEPLOY_SITE_URL = $pagesUrl
            Run $gitBash @('./scripts/deploy-gh-pages.sh', '--fast')
        } finally { $env:DEPLOY_SITE_URL = $previousSiteUrl }
        Step '等待 GitHub Pages 生效（最多约三分钟）'
        Wait-OnlineVersion $pagesUrl $verName
    }
}

Write-Host "`n完成。" -ForegroundColor Green
Write-Host "详细日志：$LogFile"
