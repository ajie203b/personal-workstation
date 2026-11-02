[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PreviousTag,
    [Parameter(Mandatory)][string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $PreviousTag -notmatch '^v\d+\.\d+\.\d+$') { throw '版本号格式无效' }
if (git status --porcelain) { throw '自动准备版本前工作区必须干净' }
$subjects = @(git log --no-merges --format=%s "$PreviousTag..HEAD")
if ($LASTEXITCODE -ne 0) { throw "无法读取 $PreviousTag 之后的提交记录" }
if (-not $subjects.Count) { throw "自 $PreviousTag 以来没有新提交，无需重复发布" }

$packagePath = Join-Path $root 'package.json'
$lockPath = Join-Path $root 'package-lock.json'
$gradlePath = Join-Path $root 'android/app/build.gradle'
$changelogPath = Join-Path $root 'CHANGELOG.md'
$package = Get-Content $packagePath -Raw -Encoding UTF8
$lock = Get-Content $lockPath -Raw -Encoding UTF8
$gradle = Get-Content $gradlePath -Raw -Encoding UTF8
$changelog = Get-Content $changelogPath -Raw -Encoding UTF8
$oldVersion = $PreviousTag.Substring(1)
$versionPattern = '("version"\s*:\s*")' + [regex]::Escape($oldVersion) + '(")'
if ((($package | ConvertFrom-Json).version -ne $oldVersion) -or (($lock | ConvertFrom-Json -AsHashtable).version -ne $oldVersion) -or
    [regex]::Matches($package, $versionPattern).Count -lt 1 -or [regex]::Matches($lock, $versionPattern).Count -lt 2) { throw '版本文件的格式不符合预期，未修改' }
$namePattern = '(versionName\s+")' + [regex]::Escape($oldVersion) + '(")'
$codeMatch = [regex]::Match($gradle, 'versionCode\s+(\d+)')
if ([regex]::Matches($gradle, $namePattern).Count -ne 1 -or -not $codeMatch.Success) { throw 'Android 版本格式不符合预期，未修改' }
if ($changelog -notmatch '(?m)^# 更新记录[ \t]*\r?$') { throw '更新记录格式不符合预期，未修改' }
$nextCode = [int]$codeMatch.Groups[1].Value + 1
$replaceVersion = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value }
$package = ([regex]$versionPattern).Replace($package, $replaceVersion, 1)
$lock = ([regex]$versionPattern).Replace($lock, $replaceVersion, 2)
$gradle = [regex]::Replace($gradle, $namePattern, $replaceVersion)
$gradle = [regex]::Replace($gradle, 'versionCode\s+\d+', "versionCode $nextCode", 1)
$date = Get-Date -Format 'yyyy年M月d日'
$notes = ($subjects | ForEach-Object { '- ' + $_ }) -join "`n"
$section = "# 更新记录`n`n## v$Version · $date`n`n$notes`n`n安卓版本码为 $nextCode。"
$changelog = [regex]::Replace($changelog, '(?m)^# 更新记录[ \t]*\r?$', [System.Text.RegularExpressions.MatchEvaluator]{ $section }, 1)
Set-Content -LiteralPath $packagePath -Value $package -Encoding utf8 -NoNewline
Set-Content -LiteralPath $lockPath -Value $lock -Encoding utf8 -NoNewline
Set-Content -LiteralPath $gradlePath -Value $gradle -Encoding utf8 -NoNewline
Set-Content -LiteralPath $changelogPath -Value $changelog -Encoding utf8 -NoNewline
git add -- package.json package-lock.json android/app/build.gradle CHANGELOG.md
if ($LASTEXITCODE -ne 0) { throw '暂存版本文件失败' }
git commit -m "chore: prepare v$Version release"
if ($LASTEXITCODE -ne 0) { throw '提交版本文件失败；保留改动以便检查' }
