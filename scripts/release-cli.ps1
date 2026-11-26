# Compact, non-interactive interface for automation. See AGENTS.md.
$ErrorActionPreference = 'Stop'
$command = 'npm run --silent release'
$Mode = if ($args.Count) { [string]$args[0] } else { 'publish' }
if ($Mode -eq 'help' -and $args.Count -eq 1) {
    [ordered]@{ ok = $true; publish = $command; resume = "$command -- resume"; apk = "$command -- apk"
        windows = "$command -- windows"; windowsIncludesApk = $true; success = 'exit 0 and ok=true' } | ConvertTo-Json -Compress
    exit 0
}

$result = [ordered]@{ ok = $false; mode = $Mode }
$context = @{ stage = 'preflight' }
$guard = $null
try {
    if ($args.Count -gt 1) { throw 'Expected one mode. Run npm run --silent release -- help.' }
    $flags = switch -Exact ($Mode) {
        publish { @{ Publish = $true } }
        resume  { @{ Publish = $true; Resume = $true } }
        apk     { @{} }
        windows { @{ Exe = $true } }
        default { throw "Unknown mode '$Mode'. Use publish, resume, apk, windows or help." }
    }
    $outDir = [IO.Directory]::CreateDirectory((Join-Path $PSScriptRoot '../apk'))
    $lockPath = Join-Path $outDir.FullName '.release.lock'
    try { $guard = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { throw "Cannot lock $lockPath. Wait for the active build to finish, then retry." }

    & (Join-Path $PSScriptRoot 'release.ps1') @flags -Result $context *> $null
    $result.ok = $true
    foreach ($key in 'tag', 'apk', 'exe', 'release', 'pages', 'warning') {
        if ($context[$key]) { $result[$key] = $context[$key] }
    }
} catch {
    $result.stage = $context.stage
    $message = ($_.Exception.Message -replace '\s+', ' ').Trim()
    $result.error = $message.Substring(0, [math]::Min(400, $message.Length))
    $hint = switch ($_.Exception.Data['kind']) {
        network { '检查 GitHub 网络或代理连接，恢复后重试。' }
        git_diverged { '用 git log --left-right --oneline main...origin/main 核对两侧提交，整合后重试。' }
        authentication { '运行 gh auth status 检查当前账号和凭据，再重试。' }
    }
    if ($hint) { $result.hint = $hint }
    if ($context.tag) { $result.tag = $context.tag }
    if ($context.log) { $result.log = $context.log }
    if ($context.resume) { $result.retry = "$command -- resume" }
} finally {
    if ($guard) { $guard.Dispose() }
}
$result | ConvertTo-Json -Compress
if (-not $result.ok) { exit 1 }
exit 0
