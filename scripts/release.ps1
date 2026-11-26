# Kairos 一键出包 / 发布
# 用法（在仓库根目录，用 PowerShell 7）：
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1             只打 APK
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Exe        APK + Windows exe（云端打，下载到本地）
#   pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Publish    APK + exe + Release + Pages + 线上版本核验
#   加 -SkipPull 不切 main、不拉代码（测某个分支时用）
#   发布中断后加 -Resume：校验本地检查点并继续，不重复构建 APK
#   已发布版本会自动准备下一个补丁版本；匹配的未完成检查点会自动续跑。
# GitHub 读取遇到临时网络错误最多尝试三次；写入中断会先核对远端状态。
# 产物都放在仓库的 apk\ 目录（已在 .gitignore 里）。
# -Exe / -Publish 需要 GitHub CLI：winget install GitHub.cli，然后 gh auth login
[CmdletBinding()]
param(
    [switch]$Exe,
    [switch]$Publish,
    [switch]$Resume,
    [switch]$SkipPull,
    [hashtable]$Result = @{}
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
$Result.log = $LogFile
Write-Host "详细日志：$LogFile"
trap {
    $failureRecord = $_
    Add-Content -LiteralPath $LogFile -Value "失败：$($failureRecord.Exception.Message)" -Encoding UTF8
    Write-Host "失败：$($failureRecord.Exception.Message)`n详细日志：$LogFile" -ForegroundColor Red
    if ($Publish -and -not $Resume -and $statePath -and (Test-Path -LiteralPath $statePath)) {
        Write-Host '继续发布：pwsh -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Publish -Resume'
    }
    throw $failureRecord
}

function Step($msg) {
    $Result.stage = $msg
    Write-Host "`n==> $msg" -ForegroundColor Cyan
    Add-Content -LiteralPath $LogFile -Value "`n[$(Get-Date -Format 'HH:mm:ss')] $msg" -Encoding UTF8
}
function Run($exe, [string[]]$argv, [switch]$Capture, [switch]$Retry, [string]$DownloadDirectory) {
    $maxAttempts = if ($Retry) { 3 } else { 1 }
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $attemptArgs = @($argv)
        $attemptDirectory = $null
        if ($DownloadDirectory) {
            $destinationIndex = [array]::IndexOf($attemptArgs, '-D')
            if ($destinationIndex -lt 0 -or $destinationIndex -ge $attemptArgs.Count - 1) { throw '下载目录参数无效' }
            # A failed extraction can leave files behind. Never reuse its directory.
            $attemptDirectory = Join-Path $DownloadDirectory "attempt-$attempt"
            $attemptArgs[$destinationIndex + 1] = $attemptDirectory
        }
        Add-Content -LiteralPath $LogFile -Value "> $exe $($attemptArgs -join ' ')" -Encoding UTF8
        $lines = [Collections.Generic.Queue[string]]::new()
        $transient = $false
        $isRemoteTool = $exe -in 'git', 'gh'
        $diagnostic = $null
        $kind = $null
        $writer = [IO.File]::AppendText($LogFile)
        try {
            & $exe @attemptArgs 2>&1 | ForEach-Object {
                $line = $_.ToString()
                # Signed artifact download URLs can contain temporary credentials.
                $safeLine = $line -replace '(https?://[^\s"?]+)\?[^\s"]+', '$1?[redacted]'
                $writer.WriteLine($safeLine)
                $lines.Enqueue($line)
                if (-not $Capture -and $lines.Count -gt 12) { [void]$lines.Dequeue() }
                if ($isRemoteTool -and $line -match '(?i)timed?\s*out|timeout|connection (?:reset|refused|closed)|(?:connection.*forcibly closed|connected host has failed to respond)|unexpected EOF while reading|\bEOF\s*$|context deadline exceeded|temporary failure|HTTP (?:429|502|503|504)\b|\b(?:502|503|504) (?:Bad Gateway|Service Unavailable|Gateway Timeout)') {
                    $transient = $true
                    $diagnostic = $safeLine -replace 'https?://[^\s"]+', '[URL]'
                } elseif ($exe -eq 'git' -and $line -match 'Not possible to fast-forward') {
                    $kind = 'git_diverged'
                    $diagnostic = $safeLine
                } elseif ($isRemoteTool -and $line -match '\bHTTP 401\b|authentication failed|token.*invalid') {
                    $kind = 'authentication'
                    $diagnostic = $safeLine
                } elseif ($exe -eq 'npm' -and $line -match '\berror TS\d+:|^\s*- .+won.t be precached|^\s*(?:Error:|npm error code)\s+\S') {
                    $diagnostic = $safeLine.Trim()
                }
                if (-not $Capture -and $line -match '\b\d+ (high|critical) severity vulnerabilities\b') {
                    $Result.warning = $line.Trim()
                    Write-Host "依赖审计提示：$line（详情见日志）" -ForegroundColor Yellow
                } elseif (-not $Capture -and $VerbosePreference -eq 'Continue') { Write-Host $safeLine }
            }
            $exitCode = $LASTEXITCODE
        } finally { $writer.Dispose() }
        if ($exitCode -eq 0) {
            if ($DownloadDirectory) { return $attemptDirectory }
            if ($Capture) { return $lines }
            return
        }
        if ($Retry -and $transient -and -not $kind -and $attempt -lt $maxAttempts) {
            $delay = 3 * $attempt
            $message = "网络暂时失败，${delay} 秒后重试（$attempt/$maxAttempts）：$exe $($argv[0..([math]::Min(1, $argv.Count - 1))] -join ' ')"
            Write-Host $message -ForegroundColor Yellow
            Add-Content -LiteralPath $LogFile -Value $message -Encoding UTF8
            Start-Sleep -Seconds $delay
            continue
        }
        $tail = @($lines | Select-Object -Last 12 | ForEach-Object {
            $_ -replace '(https?://[^\s"?]+)\?[^\s"]+', '$1?[redacted]'
        })
        $tail | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        $detail = $diagnostic ?? ($tail | Where-Object { $_.Trim() } | Select-Object -Last 1)
        $failure = [Exception]::new("$exe $($argv[0]) 失败（退出码 $exitCode） $detail")
        if ($kind) { $failure.Data['kind'] = $kind }
        elseif ($transient) { $failure.Data['kind'] = 'network' }
        throw $failure
    }
}
function Get-DistHash {
    $directory = Join-Path $Root 'dist'
    $files = @(Get-ChildItem -LiteralPath $directory -Recurse -File -ErrorAction Stop | Sort-Object FullName)
    if (-not $files.Count) { throw '网页构建产物为空，不能继续发布' }
    $rows = $files | ForEach-Object { "$([IO.Path]::GetRelativePath($directory, $_.FullName)) $((Get-FileHash -LiteralPath $_.FullName).Hash)" }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($rows -join "`n"))).Replace('-', '') }
    finally { $sha256.Dispose() }
}
function Save-Checkpoint {
    $temporary = "$statePath.tmp"
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
}
function Read-Release {
    $release = Run gh @('api', "repos/{owner}/{repo}/releases/tags/$tag") -Capture -Retry | ConvertFrom-Json
    if ($release.tag_name -ne $tag) { throw "GitHub 返回的 Release 标签与 $tag 不一致" }
    if ($release.draft) { throw "Release $tag 是草稿，请核对并发布该草稿后续跑" }
    return $release
}
function Find-Release {
    $filter = ".[] | select(.tag_name == $($tag | ConvertTo-Json -Compress)) | .tag_name"
    if (Run gh @('api', '--paginate', 'repos/{owner}/{repo}/releases?per_page=100', '--jq', $filter) -Capture -Retry) {
        return Read-Release
    }
}
function Sync-ReleaseApk($existing) {
    $name = Split-Path $apkOut -Leaf
    for ($attempt = 0; ; $attempt++) {
        $asset = $existing.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
        if ($asset) {
            if ($asset.digest -ne "sha256:$($state.apkHash)") { throw '远端 APK 与检查点不一致，已停止，不会覆盖附件' }
            return
        }
        if ($attempt -eq 2) { throw $uploadFailure }
        try { Run gh @('release', 'upload', $tag, $apkOut); return }
        catch {
            if ($_.Exception.Data['kind'] -ne 'network') { throw }
            $uploadFailure = $_
        }
        Start-Sleep -Seconds 3
        $existing = Read-Release
    }
}

# ---------- 预检 ----------
if ($Resume -and -not $Publish) { throw '-Resume 需要与 -Publish 一起使用' }
$bundledJdk = Join-Path $env:LOCALAPPDATA 'jdk-21'
if (Test-Path -LiteralPath "$bundledJdk\bin\java.exe") { $env:JAVA_HOME = $bundledJdk }
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "找不到 JDK：$env:JAVA_HOME" }
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

if ($Exe) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw '没装 GitHub CLI：先运行 winget install GitHub.cli，重开终端后 gh auth login'
    }
    Run gh @('auth', 'status') -Retry
}

if (-not $SkipPull -and -not $Resume) {
    Step '切到 main 并拉取'
    $dirty = Run git @('status', '--porcelain') -Capture
    if ($dirty) { throw "工作区有未提交改动，先处理：`n$dirty" }
    Run git @('checkout', 'main')
    Run git @('pull', '--ff-only') -Retry
}

$Result.stage = '校验版本和检查点'
$pkgVer = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$lockPath = Join-Path $Root 'package-lock.json'
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { throw '缺少 package-lock.json，不能确认发布版本' }
try { $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable }
catch { throw 'package-lock.json 格式无效，不能确认发布版本' }
$lockVer = $lock.version
$lockRootVer = if ($lock.packages -is [System.Collections.IDictionary] -and $lock.packages.Contains('')) { $lock.packages[''].version } else { $null }
if (-not $pkgVer -or $lockVer -ne $pkgVer -or $lockRootVer -ne $pkgVer) {
    throw "版本不一致：package.json=$pkgVer，package-lock.json=$lockVer，package-lock.json 根包=$lockRootVer"
}
$gradle = Get-Content android\app\build.gradle -Raw -Encoding UTF8
$verName = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
$verCode = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
Write-Host "package.json $pkgVer / versionName $verName / versionCode $verCode"
if ($pkgVer -ne $verName) { throw "版本不一致：package.json=$pkgVer，build.gradle=$verName" }
$tag = "v$verName"
$Result.tag = $tag
$apkOut = Join-Path $outDir "personal-workstation-$tag.apk"
$statePath = Join-Path $outDir "release-$tag.json"
$updaterConfigured = $false
$updaterConfigPath = Join-Path $Root 'src-tauri/tauri.conf.json'
if (Test-Path -LiteralPath $updaterConfigPath) {
    $updaterPublicKey = (Get-Content -LiteralPath $updaterConfigPath -Raw | ConvertFrom-Json).plugins.updater.pubkey
    $updaterConfigured = [bool]($updaterPublicKey -and $updaterPublicKey -notlike 'REPLACE_WITH_*')
}

if ($Publish) {
    if (Run git @('status', '--porcelain') -Capture) { throw '发布前请先提交工作区改动' }
    $commit = (Run git @('rev-parse', 'HEAD') -Capture).Trim()
    # 只查询本次标签，避免历史标签差异阻塞；未完成发布可以复用本地检查点。
    $localTag = Run git @('tag', '--list', $tag) -Capture
    $remoteTags = @(Run git @('ls-remote', '--tags', 'origin', "refs/tags/$tag", "refs/tags/$tag^{}") -Capture -Retry)
    if (-not $Resume) {
        $checkpoint = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable } else { $null }
        if ($checkpoint -and $checkpoint.schema -eq 1 -and $checkpoint.commit -eq $commit -and $checkpoint.version -eq $verName) {
            Write-Host "发现匹配的发布检查点，自动续跑 $tag"
            $Resume = $true
        } elseif ($localTag -or $remoteTags.Count) {
            if (-not $localTag) { Run git @('fetch', 'origin', "refs/tags/${tag}:refs/tags/${tag}") -Retry }
            if ($verName -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw '自动升级仅支持数字版本号，请手动处理' }
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
            do {
                $patch++
                $nextVersion = "$major.$minor.$patch"
                $nextTag = "v$nextVersion"
                $nextLocal = Run git @('tag', '--list', $nextTag) -Capture
                $nextRemote = @(Run git @('ls-remote', '--tags', 'origin', "refs/tags/$nextTag", "refs/tags/$nextTag^{}") -Capture -Retry)
            } while ($nextLocal -or $nextRemote.Count)
            Step "准备新版本 $nextTag"
            & (Join-Path $PSScriptRoot 'prepare-release.ps1') -PreviousTag $tag -Version $nextVersion 2>&1 |
                ForEach-Object { Add-Content -LiteralPath $LogFile -Value $_ -Encoding UTF8 }
            Write-Host "版本准备完成，继续发布 $nextTag"
            # 重新执行完整预检，让版本、提交和所有产物始终对应。
            & $PSCommandPath -Publish -SkipPull -Result $Result
            return
        }
    }
    if ($Resume) {
        if (-not (Test-Path -LiteralPath $statePath)) { throw '找不到发布检查点，请先使用普通 -Publish 构建并发布' }
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
        if ($state.schema -ne 1 -or $state.commit -ne $commit -or $state.version -ne $verName) {
            throw '检查点的提交或版本与当前源码不同，不能复用旧产物；请回到原提交续跑，或升版本重新发布'
        }
        if (-not (Test-Path -LiteralPath $apkOut) -or (Get-FileHash -LiteralPath $apkOut).Hash -ne $state.apkHash -or
            (Get-DistHash) -ne $state.distHash) { throw '本地构建产物已改变，不能续跑，请恢复原产物或升版本重新发布' }
        Step "从检查点继续 $tag（提交 $($commit.Substring(0, 7))）"
        $Result.resume = $true
    }
    if ($Resume) {
        if ($localTag -and (Run git @('rev-parse', "refs/tags/$tag^{commit}") -Capture) -ne $commit) { throw '本地标签指向不同提交，已停止' }
        $remoteTagCommit = $null
        if ($remoteTags.Count) {
            $peeled = $remoteTags | Where-Object { $_.EndsWith('^{}') } | Select-Object -First 1
            $remoteTagCommit = (($peeled ?? $remoteTags[0]) -split '\s+')[0]
            if ($remoteTagCommit -ne $commit) { throw '远端标签指向不同提交，已停止，不会覆盖标签' }
        }
    }
    $notes = [regex]::Match((Get-Content CHANGELOG.md -Raw -Encoding UTF8),
        "(?ms)^## $([regex]::Escape($tag))\b[^\n]*\n(.*?)(?=^## |\z)").Groups[1].Value.Trim()
    if (-not $notes) { throw "CHANGELOG.md 里没有 $tag 的条目，先写更新记录" }

    # Windows 的 bash 可能指向 WSL，明确使用 Git for Windows 自带的 Bash。
    $gitPath = (Get-Command git -CommandType Application | Select-Object -First 1).Source
    $gitRoot = Split-Path (Split-Path $gitPath -Parent) -Parent
    $gitBash = Join-Path $gitRoot 'bin/bash.exe'
    if (-not (Test-Path -LiteralPath $gitBash)) {
        # A PATH shim may live outside Git for Windows. Ask Git for its own installation.
        $execPath = (Run git @('--exec-path') -Capture).Trim()
        $gitBash = [IO.Path]::GetFullPath((Join-Path $execPath '../../../bin/bash.exe'))
        if (-not (Test-Path -LiteralPath $gitBash -PathType Leaf)) { throw '找不到 Git Bash，请安装 Git for Windows 后再发布' }
    }
    if (-not (Test-Path -LiteralPath './scripts/deploy-gh-pages.sh')) { throw '缺少 Pages 部署脚本' }
    $pagesUrl = ((Run gh @('api', 'repos/{owner}/{repo}/pages', '--jq', '.html_url') -Capture -Retry) | Out-String).Trim()
    $pagesUri = $null
    if (-not [uri]::TryCreate($pagesUrl, [UriKind]::Absolute, [ref]$pagesUri) -or $pagesUri.Scheme -ne 'https') {
        throw "GitHub Pages 地址无效，请检查仓库 Pages 设置：$pagesUrl"
    }
}

# ---------- APK ----------
if (-not $Resume) {
    Step 'npm install'
    Run npm @('install')

    Step 'npm run build'
    Run npm @('run', 'build')

    Step 'cap sync android'
    Run npx @('cap', 'sync', 'android')

    Step 'gradlew assembleRelease'
    Push-Location android
    try { Run .\gradlew.bat @('assembleRelease') } finally { Pop-Location }
}

$apk = if ($Resume) { $apkOut } else { Join-Path $Root 'android\app\build\outputs\apk\release\app-release.apk' }
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

if (-not $Resume) { Copy-Item $apk $apkOut -Force }
$Result.apk = $apkOut
Write-Host "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length / 1MB, 1)) MB）" -ForegroundColor Green
if ($Publish -and -not $Resume) {
    $state = @{ schema = 1; commit = $commit; version = $verName; apkHash = (Get-FileHash -LiteralPath $apkOut).Hash;
        distHash = Get-DistHash; runId = $null; pagesPushed = $false }
    Save-Checkpoint
    $Result.resume = $true
}

# ---------- 发布 / 触发 exe ----------
function Wait-DesktopRun($event, $since, $ref, $sha) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 4
        $arguments = @('run', 'list', '--workflow', $DesktopWorkflow, '--event', $event, '--limit', '5',
            '--json', 'databaseId,createdAt,headSha,headBranch', '--branch', $ref, '--commit', $sha)
        $runs = Run gh $arguments -Capture -Retry | ConvertFrom-Json
        $run = $runs | Where-Object {
            $_.headSha -eq $sha -and $_.headBranch -eq $ref -and
                ($Publish -or ([datetime]$_.createdAt).ToUniversalTime() -ge $since)
        } |
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
    throw "Pages 更新未确认：期望 $expectedVersion，最后读到 $lastSeen。请检查 Pages 部署状态，部署生效后续跑以核验线上版本。"
}

if ($Exe) {
    $since = (Get-Date).ToUniversalTime().AddSeconds(-30)

    if ($Publish) {
        $publishBranch = (Run git @('rev-parse', '--abbrev-ref', 'HEAD') -Capture).Trim()
        if ($publishBranch -eq 'main' -and -not $remoteTagCommit -and -not $state.mainPushed) {
            Step '推送 main，确保发布源码与远端同步'
            # Every retry proposes the same verified commit, even if a previous push succeeded.
            Run git @('push', 'origin', "${commit}:refs/heads/main") -Retry
            $state.mainPushed = $true
            Save-Checkpoint
        }
        Step "推送标签 $tag 并创建 Release"
        if (-not $Resume -or -not $remoteTagCommit) {
            if (-not $localTag) { Run git @('tag', $tag) }
            Run git @('push', 'origin', $tag)
        }
        $existing = if ($Resume) { Find-Release }
        if (-not $existing) {
            $notesFile = Join-Path $env:TEMP "kairos-notes-$tag.md"
            Set-Content -LiteralPath $notesFile -Value $notes -Encoding UTF8
            try { Run gh @('release', 'create', $tag, $apkOut, '--title', $tag, '--notes-file', $notesFile) }
            catch {
                if ($_.Exception.Data['kind'] -ne 'network') { throw }
                $existing = Find-Release
                if (-not $existing) { throw }
            }
        }
        if ($existing) { Sync-ReleaseApk $existing }
        $runId = if ($Resume -and $state.runId) { $state.runId } else { Wait-DesktopRun 'push' $since $tag $commit }
        $state.runId = $runId
        Save-Checkpoint
    } else {
        $branch = (Run git @('rev-parse', '--abbrev-ref', 'HEAD') -Capture).Trim()
        $head = (Run git @('rev-parse', 'HEAD') -Capture).Trim()
        Step "在云端打 exe（分支 $branch）"
        Run gh @('workflow', 'run', $DesktopWorkflow, '--ref', $branch)
        $runId = Wait-DesktopRun 'workflow_dispatch' $since $branch $head
    }

    $desktopComplete = $false
    if ($Resume) {
        $run = Run gh @('run', 'view', "$runId", '--json', 'headSha,headBranch,status,conclusion,attempt') -Capture -Retry | ConvertFrom-Json
        if ($run.headSha -ne $commit -or $run.headBranch -ne $tag) { throw '桌面构建任务的提交或标签与本次发布不符，已停止' }
        $desktopComplete = $run.status -eq 'completed' -and $run.conclusion -eq 'success'
        if ($run.status -eq 'completed' -and -not $desktopComplete) {
            Step "重试失败的桌面构建（任务 $runId）"
            $previousAttempt = $run.attempt
            $rerunArguments = @('run', 'rerun', "$runId")
            if ($run.conclusion -eq 'failure') { $rerunArguments += '--failed' }
            Run gh $rerunArguments
            for ($attempt = 0; $attempt -lt 30; $attempt++) {
                Start-Sleep -Seconds 4
                $retry = Run gh @('run', 'view', "$runId", '--json', 'attempt') -Capture -Retry | ConvertFrom-Json
                if ($retry.attempt -gt $previousAttempt) { break }
            }
            if ($retry.attempt -le $previousAttempt) { throw '桌面构建重试尚未启动，请稍后续跑' }
        }
    }
    if (-not $desktopComplete) {
        Step "等待桌面版打包（任务 $runId，一般 10 分钟左右，详细进度见日志）"
        Run gh @('run', 'watch', "$runId", '--exit-status', '--interval', '20') -Retry
    }

    $expectedExe = "Kairos_${verName}_x64-setup.exe"
    $exeOut = Join-Path $outDir $expectedExe
    if ($Resume -and $state.exeHash -and (Test-Path -LiteralPath $exeOut) -and
        (Get-FileHash -LiteralPath $exeOut).Hash -eq $state.exeHash) {
        Step '复用已核验的本地 exe'
    } else {
        Step '下载 exe'
        $tmp = Join-Path $env:TEMP "kairos-exe-$runId-$([guid]::NewGuid().ToString('N'))"
        $downloadedDirectory = Run gh @('run', 'download', "$runId", '-n', 'Kairos-windows', '-D', $tmp) -Retry -DownloadDirectory $tmp
        $installers = @(Get-ChildItem -LiteralPath $downloadedDirectory -Filter $expectedExe -Recurse -File)
        if ($installers.Count -ne 1) { throw "构建附件中未找到唯一的 $expectedExe，已停止" }
        Copy-Item -LiteralPath $installers[0].FullName -Destination $exeOut -Force
        if ($Publish) {
            $state.exeHash = (Get-FileHash -LiteralPath $exeOut).Hash
            Save-Checkpoint
        }
    }
    Write-Host "exe：$exeOut" -ForegroundColor Green
    $Result.exe = $exeOut

    if ($Publish) {
        $Result.stage = '核验 Release 附件'
        $release = Read-Release
        $assets = @($release.assets | ForEach-Object { $_.name })
        Write-Host "`nRelease $tag 附件：" -ForegroundColor Green
        $assets | ForEach-Object { Write-Host "  $_" }
        if ($release.tag_name -ne $tag -or $assets -notcontains (Split-Path $apkOut -Leaf) -or $assets -notcontains $expectedExe) {
            throw "Release $tag 缺少本次 APK 或 EXE 附件，请检查桌面打包任务，本次发布未完成"
        }
        Write-Host $release.html_url
        foreach ($artifact in @(@{ name = (Split-Path $apkOut -Leaf); hash = $state.apkHash }, @{ name = $expectedExe; hash = $state.exeHash })) {
            $asset = $release.assets | Where-Object { $_.name -eq $artifact.name } | Select-Object -First 1
            if ($asset.digest -ne "sha256:$($artifact.hash)") { throw "Release 附件与本机产物不一致：$($artifact.name)" }
        }

        if ($updaterConfigured) {
            Step '核验桌面自动更新签名和清单'
            foreach ($required in @("$expectedExe.sig", 'latest.json')) {
                if ($assets -notcontains $required) { throw "Release 缺少 $required，不能发布不完整的自动更新" }
            }
            $updaterDirectory = Join-Path $outDir "updater-$tag"
            New-Item -ItemType Directory -Force $updaterDirectory | Out-Null
            Run gh @('release', 'download', $tag, '--pattern', 'latest.json', '--pattern', "$expectedExe.sig", '--dir', $updaterDirectory, '--clobber') -Retry
            Run node @('scripts/verify-updater.mjs', '--config', $updaterConfigPath, '--artifact', $exeOut,
                '--signature', (Join-Path $updaterDirectory "$expectedExe.sig"), '--manifest', (Join-Path $updaterDirectory 'latest.json'), '--version', $verName)
        }

        if (-not $Resume -or -not $state.pagesPushed) {
            Step '发布网页版和更新检测版本'
            $previousSiteUrl = $env:DEPLOY_SITE_URL
            try {
                $env:DEPLOY_SITE_URL = $pagesUrl
                Run $gitBash @('./scripts/deploy-gh-pages.sh', '--fast')
            } finally { $env:DEPLOY_SITE_URL = $previousSiteUrl }
            $state.pagesPushed = $true
            Save-Checkpoint
        }
        Step '等待 GitHub Pages 生效（最多约三分钟）'
        Wait-OnlineVersion $pagesUrl $verName
        $Result.pages = $pagesUrl
        $Result.release = $release.html_url
    }
}

Write-Host "`n完成。" -ForegroundColor Green
Write-Host "详细日志：$LogFile"
