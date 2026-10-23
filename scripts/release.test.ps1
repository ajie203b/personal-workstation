# Offline integration tests: execute the real release script, replacing external tools/network only.
$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot 'release.ps1') -Raw
$originalLocation = Get-Location
$previousTestState = Get-Variable -Name ReleaseTest -Scope Global -ErrorAction SilentlyContinue
$savedEnv = @{}
foreach ($name in @('LOCALAPPDATA', 'JAVA_HOME', 'ANDROID_HOME', 'TEMP', 'Path')) {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name)
}
$suiteId = [guid]::NewGuid().ToString('N')
$testRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apk'))
New-Item -ItemType Directory -Force $testRoot | Out-Null
$suiteRoot = Join-Path $testRoot "release-tests-$suiteId 中文 user's path"
New-Item -ItemType Directory $suiteRoot | Out-Null
Set-Content (Join-Path $suiteRoot '.test-owner') $suiteId
$remotes = @{}

function script:git {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:ReleaseTest.events.Add("git $command")
    switch -Wildcard ($command) {
        'status --porcelain' { return }
        'checkout main' { return }
        'pull*' { return }
        'fetch --tags*' {
            if ($global:ReleaseTest.options.HistoricalTagConflict) { $global:LASTEXITCODE = 1 }
            return
        }
        'tag --list *' { if ($global:ReleaseTest.remote.LocalTag) { 'v9.9.9' }; return }
        'ls-remote --tags origin refs/tags/*' {
            if ($global:ReleaseTest.options.RemoteTagMismatch) { "$('b' * 40) refs/tags/v9.9.9" }
            elseif ($global:ReleaseTest.options.RemoteTagExists) { 'abc123 refs/tags/v9.9.9' }
            elseif ($global:ReleaseTest.remote.RemoteTag) { "$($global:ReleaseTest.remote.RemoteTag) refs/tags/v9.9.9" }
            return
        }
        'rev-parse HEAD' { if ($global:ReleaseTest.options.DifferentCommit) { 'b' * 40 } else { 'a' * 40 }; return }
        'rev-parse refs/tags/v9.9.9^{commit}' { $global:ReleaseTest.remote.LocalTag; return }
        'tag v9.9.9' { $global:ReleaseTest.remote.LocalTag = 'a' * 40; return }
        'push origin v9.9.9' { $global:ReleaseTest.remote.RemoteTag = 'a' * 40; return }
        'rev-parse --abbrev-ref HEAD' { 'main'; return }
        default { throw "Unexpected git command: $command" }
    }
}
function script:npm {
    $global:LASTEXITCODE = 0
    $global:ReleaseTest.events.Add("npm $($args -join ' ')")
    'npm log marker'
    if ($global:ReleaseTest.options.AuditWarning) { '6 high severity vulnerabilities' }
}
function script:npx { $global:LASTEXITCODE = 0 }
function script:Invoke-ReleaseTestGradle { $global:LASTEXITCODE = 0 }
function script:Invoke-ReleaseTestSigner {
    $global:LASTEXITCODE = 0
    'Signer #1 certificate SHA-256 digest: d32df3ec5a94487db404a700a8338fac6ca2edeae4a47dde4fee7728d038838f9'
}
function script:keytool {
    $global:LASTEXITCODE = 0
    'SHA256: D3:2D:F3:EC:5A:94:48:7D:B4:04:A7:00:A8:33:8F:AC:6C:A2:ED:AE:A4:7D:DE:4F:EE:77:28:9D:03:88:38:F9'
}
function script:Invoke-ReleaseTestBash {
    if (($args -join ' ') -ne './scripts/deploy-gh-pages.sh --fast') { throw 'Unexpected Pages invocation' }
    $global:ReleaseTest.events.Add('deploy pages')
    $global:LASTEXITCODE = $(if ($global:ReleaseTest.options.DeployFails) { 7 } else { 0 })
}
function script:Get-Command {
    [CmdletBinding()]
    param([string]$Name, [object]$CommandType)
    if ($Name -eq 'git' -and $CommandType -eq 'Application') {
        return [pscustomobject]@{ Source = (Join-Path $global:ReleaseTest.root 'git/cmd/git.exe') }
    }
    Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
function Get-TestAssets {
    $assets = @('personal-workstation-v9.9.9.apk', 'Kairos_9.9.9_x64-setup.exe')
    if ($global:ReleaseTest.options.MissingExe -or $global:ReleaseTest.remote.RunFailed) { $assets = @($assets | Where-Object { $_ -notlike '*.exe' }) }
    if ($global:ReleaseTest.options.MissingApk -and -not $global:ReleaseTest.remote.ApkRepaired) { $assets = @($assets | Where-Object { $_ -notlike '*.apk' }) }
    if ($global:ReleaseTest.options.WrongExeVersion) { $assets = @($assets | ForEach-Object { $_.Replace('Kairos_9.9.9', 'Kairos_9.9.8') }) }
    return $assets
}
function script:gh {
    $global:LASTEXITCODE = 0
    $argv = @($args)
    $command = $argv -join ' '
    $global:ReleaseTest.events.Add("gh $command")
    switch -Wildcard ($command) {
        'auth status' { return }
        'api repos/{owner}/{repo}/pages --jq .html_url' { 'https://example.github.io/workstation/'; return }
        'api --paginate repos/{owner}/{repo}/releases*' {
            if ($global:ReleaseTest.remote.ReleaseExists) { 'v9.9.9' }; return
        }
        'api repos/{owner}/{repo}/releases/tags/v9.9.9' {
            $apkHash = (Get-FileHash (Join-Path $global:ReleaseTest.root 'apk/personal-workstation-v9.9.9.apk')).Hash.ToLowerInvariant()
            if ($global:ReleaseTest.options.WrongApkDigest) { $apkHash = '0' * 64 }
            @{ tag_name = 'v9.9.9'; html_url = 'https://example.test/release/v9.9.9'; assets = @(Get-TestAssets | ForEach-Object {
                @{ name = $_; digest = "sha256:$apkHash" }
            }) } | ConvertTo-Json -Depth 4 -Compress
            return
        }
        'release create *' {
            if ($global:ReleaseTest.options.CreateFails) { $global:LASTEXITCODE = 1; return }
            $global:ReleaseTest.remote.ReleaseExists = $true; return
        }
        'release upload *' { $global:ReleaseTest.remote.ApkRepaired = $true; return }
        'workflow run *' { return }
        'run list *' {
            ConvertTo-Json -InputObject @(@{ databaseId = 123; createdAt = [datetime]::UtcNow.ToString('o'); headSha = ('a' * 40); headBranch = 'v9.9.9' }) -Compress
            return
        }
        'run view *' {
            @{ headSha = $(if ($global:ReleaseTest.options.WrongRunCommit) { 'c' * 40 } else { 'a' * 40 }); headBranch = 'v9.9.9'; attempt = $global:ReleaseTest.remote.Attempt;
                status = 'completed'; conclusion = $(if ($global:ReleaseTest.remote.RunFailed) { 'failure' } else { 'success' }) } |
                ConvertTo-Json -Compress
            return
        }
        'run rerun *' { $global:ReleaseTest.remote.RunFailed = $false; $global:ReleaseTest.remote.Attempt++; return }
        'run watch *' {
            if ($global:ReleaseTest.options.DesktopFails) { $global:ReleaseTest.remote.RunFailed = $true; $global:LASTEXITCODE = 1 }
            return
        }
        'run download *' {
            $destination = $argv[[array]::IndexOf($argv, '-D') + 1]
            New-Item -ItemType Directory -Force $destination | Out-Null
            Set-Content (Join-Path $destination 'Kairos_9.9.9_x64-setup.exe') 'fake exe'
            return
        }
        'release view *' {
            $assets = @(Get-TestAssets)
            if ($command.EndsWith('--jq .assets[].name')) { $assets; return }
            if ($command -like '*--json url --jq .url') { 'https://example.test/release/v9.9.9'; return }
            @{ tagName = 'v9.9.9'; url = 'https://example.test/release/v9.9.9'; assets = @($assets | ForEach-Object { @{ name = $_ } }) } |
                ConvertTo-Json -Depth 4 -Compress
            return
        }
        default { throw "Unexpected gh command: $command" }
    }
}
function script:Start-Sleep { param([int]$Seconds) }
function script:Invoke-RestMethod {
    param([uri]$Uri, [hashtable]$Headers, [int]$TimeoutSec)
    if ($Uri.AbsoluteUri -notlike 'https://example.github.io/workstation/version.json?*') { throw "Unexpected URL: $Uri" }
    if ($Headers['Cache-Control'] -ne 'no-cache' -or $TimeoutSec -le 0) { throw 'Expected uncached, bounded request' }
    $global:ReleaseTest.events.Add('read online version')
    $global:ReleaseTest.reads++
    if ($global:ReleaseTest.options.TransientReads -and $global:ReleaseTest.reads -eq 1) { throw 'Temporary network error' }
    $version = if ($global:ReleaseTest.options.Stale -or
        ($global:ReleaseTest.options.TransientReads -and $global:ReleaseTest.reads -eq 2)) { '9.9.8' } else { '9.9.9' }
    return @{ version = $version }
}

function Invoke-Scenario([string]$Name, [hashtable]$Options = @{}, [string[]]$Flags = @('-Publish', '-SkipPull'), [switch]$Reuse) {
    $fixture = Join-Path $suiteRoot $Name
    if (-not $Reuse) {
    foreach ($directory in @('scripts', 'android/app/build/outputs/apk/release', 'local/jdk-21/bin',
        'sdk/build-tools/35.0.0', 'git/cmd', 'git/bin', 'tmp', 'dist')) {
        New-Item -ItemType Directory -Force (Join-Path $fixture $directory) | Out-Null
    }
    Set-Content (Join-Path $fixture 'scripts/release.ps1') $source
    Set-Content (Join-Path $fixture 'scripts/deploy-gh-pages.sh') '# mocked at process boundary'
    Set-Content (Join-Path $fixture 'package.json') '{"version":"9.9.9"}'
    Set-Content (Join-Path $fixture 'android/app/build.gradle') "versionName `"9.9.9`"`nversionCode 999"
    Set-Content (Join-Path $fixture 'CHANGELOG.md') "## v9.9.9`n`nTest release."
    foreach ($file in @('local/jdk-21/bin/java.exe', 'sdk/build-tools/35.0.0/apksigner.bat', 'git/cmd/git.exe',
        'git/bin/bash.exe', 'android/app/build/outputs/apk/release/app-release.apk', 'dist/index.html')) {
        Set-Content (Join-Path $fixture $file) 'fixture'
    }
    $remotes[$Name] = @{ LocalTag = $null; RemoteTag = $null; ReleaseExists = $false; RunFailed = $false; Attempt = 1; ApkRepaired = $false }
    }
    $env:LOCALAPPDATA = Join-Path $fixture 'local'
    $env:ANDROID_HOME = Join-Path $fixture 'sdk'
    $env:TEMP = Join-Path $fixture 'tmp'
    $global:ReleaseTest = @{ root = $fixture; options = $Options; remote = $remotes[$Name]; reads = 0; events = [Collections.Generic.List[string]]::new() }
    Set-Alias -Scope Script -Name '.\gradlew.bat' -Value Invoke-ReleaseTestGradle -Force
    Set-Alias -Scope Script -Name (Join-Path $fixture 'sdk/build-tools/35.0.0/apksigner.bat') -Value Invoke-ReleaseTestSigner -Force
    Set-Alias -Scope Script -Name (Join-Path $fixture 'git/bin/bash.exe') -Value Invoke-ReleaseTestBash -Force
    $messages = [Collections.Generic.List[string]]::new()
    $failure = $null
    try {
        # Switches must be splatted as parameters, rather than string arguments.
        $parameters = @{}
        foreach ($flag in $Flags) { $parameters[$flag.TrimStart('-')] = $true }
        & (Join-Path $fixture 'scripts/release.ps1') @parameters 6>&1 |
            ForEach-Object { $messages.Add($_.ToString()) }
    } catch { $failure = "$($_.Exception.Message) at $($_.ScriptStackTrace)" }
    $logFiles = @(Get-ChildItem (Join-Path $fixture 'apk/logs') -Filter '*.log' -ErrorAction SilentlyContinue)
    [pscustomobject]@{ Error = $failure; Events = $global:ReleaseTest.events; Reads = $global:ReleaseTest.reads;
        Completed = ($messages -join "`n") -match '(?m)^完成。\r?$'; Messages = $messages -join "`n";
        Log = ($logFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n" }
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

$failed = 0
try {
    $cases = [ordered]@{
        'resume after Pages failure does not rebuild or create another release' = {
            $first = Invoke-Scenario 'resume-pages' @{ DeployFails = $true }
            Assert ($first.Error) 'Expected deployment failure'
            $result = Invoke-Scenario 'resume-pages' @{} @('-Publish', '-Resume') -Reuse
            Assert (-not $result.Error -and $result.Completed) "Resume failed: $($result.Error)"
            Assert (-not $result.Events.Contains('npm install') -and -not ($result.Events -match '^gh release create')) 'Resume rebuilt or recreated the release'
            Assert (-not ($result.Events -match '^gh run download')) 'Resume downloaded an already verified EXE'
        }
        'resume after version propagation timeout does not redeploy Pages' = {
            $first = Invoke-Scenario 'resume-online' @{ Stale = $true }
            Assert ($first.Error) 'Expected online version timeout'
            $result = Invoke-Scenario 'resume-online' @{} @('-Publish', '-Resume') -Reuse
            Assert (-not $result.Error -and $result.Completed -and -not $result.Events.Contains('deploy pages')) "Resume should only verify online version: $($result.Error)"
        }
        'resume repairs interrupted release creation without repushing the tag' = {
            $first = Invoke-Scenario 'resume-create' @{ CreateFails = $true }
            Assert ($first.Error) 'Expected release creation failure'
            $result = Invoke-Scenario 'resume-create' @{} @('-Publish', '-Resume') -Reuse
            Assert (-not $result.Error -and $result.Completed) "Resume failed: $($result.Error)"
            Assert (($result.Events -match '^gh release create') -and -not $result.Events.Contains('git push origin v9.9.9') -and -not $result.Events.Contains('npm install')) 'Resume must create only the missing release'
        }
        'resume retries a failed desktop run' = {
            $first = Invoke-Scenario 'resume-desktop' @{ DesktopFails = $true }
            Assert ($first.Error) 'Expected desktop build failure'
            $result = Invoke-Scenario 'resume-desktop' @{} @('-Publish', '-Resume') -Reuse
            Assert (-not $result.Error -and $result.Completed -and ($result.Events -match '^gh run rerun 123')) "Expected desktop retry: $($result.Error)"
            Assert (-not $result.Events.Contains('npm install')) 'Resume rebuilt APK unnecessarily'
        }
        'resume refuses a different source commit' = {
            $null = Invoke-Scenario 'resume-commit' @{ DeployFails = $true }
            $result = Invoke-Scenario 'resume-commit' @{ DifferentCommit = $true } @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '检查点的提交或版本' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'Changed source must not reuse old artifacts'
        }
        'resume refuses a changed APK' = {
            $null = Invoke-Scenario 'resume-apk' @{ DeployFails = $true }
            Set-Content (Join-Path $suiteRoot 'resume-apk/apk/personal-workstation-v9.9.9.apk') 'tampered'
            $result = Invoke-Scenario 'resume-apk' @{} @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '本地构建产物已改变' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'Changed APK must not be reused'
        }
        'resume refuses changed web artifacts' = {
            $null = Invoke-Scenario 'resume-dist' @{ DeployFails = $true }
            Set-Content (Join-Path $suiteRoot 'resume-dist/dist/index.html') 'tampered'
            $result = Invoke-Scenario 'resume-dist' @{} @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '本地构建产物已改变' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'Changed dist must not be reused'
        }
        'resume refuses a remote tag from another commit' = {
            $null = Invoke-Scenario 'resume-tag' @{ DeployFails = $true }
            $result = Invoke-Scenario 'resume-tag' @{ RemoteTagMismatch = $true } @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '远端标签' -and -not ($result.Events -match '^git push|^gh release')) 'Resume must not overwrite a different remote tag'
        }
        'resume refuses a different remote APK digest' = {
            $null = Invoke-Scenario 'resume-digest' @{ DeployFails = $true }
            $result = Invoke-Scenario 'resume-digest' @{ WrongApkDigest = $true } @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '远端 APK' -and -not ($result.Events -match '^gh release upload') -and -not $result.Completed) 'Resume must not overwrite different release assets'
        }
        'resume uploads only a missing APK asset' = {
            $null = Invoke-Scenario 'resume-missing-apk' @{ MissingApk = $true }
            $result = Invoke-Scenario 'resume-missing-apk' @{ MissingApk = $true } @('-Publish', '-Resume') -Reuse
            Assert (-not $result.Error -and $result.Completed -and ($result.Events -match '^gh release upload')) "Missing APK was not repaired: $($result.Error)"
            Assert (-not ($result.Events -match '--clobber|^gh release create')) 'Resume overwrote an asset or recreated a release'
        }
        'resume refuses a desktop run from another commit' = {
            $null = Invoke-Scenario 'resume-run-commit' @{ DeployFails = $true }
            $result = Invoke-Scenario 'resume-run-commit' @{ WrongRunCommit = $true } @('-Publish', '-Resume') -Reuse
            Assert ($result.Error -match '构建任务' -and -not $result.Completed -and -not ($result.Events -match '^gh run download')) 'Resume accepted another commit build'
        }
        'resume requires a local checkpoint' = {
            $result = Invoke-Scenario 'resume-no-checkpoint' @{} @('-Publish', '-Resume')
            Assert ($result.Error -match '检查点' -and -not $result.Events.Contains('npm install')) 'Missing checkpoint must not trigger a new build'
        }
        'default output is concise and full details are logged' = {
            $result = Invoke-Scenario 'logging' @{} @('-SkipPull')
            Assert (-not $result.Error -and $result.Completed) "Unexpected error: $($result.Error)"
            Assert ($result.Messages -notmatch 'npm log marker' -and $result.Log -match 'npm log marker') 'Build output must go to the log by default'
        }
        'important dependency audit summaries remain visible' = {
            $result = Invoke-Scenario 'audit-summary' @{ AuditWarning = $true } @('-SkipPull')
            Assert (-not $result.Error -and $result.Messages -match '6 high severity vulnerabilities' -and $result.Log -match '6 high severity vulnerabilities') 'Concise output hid the dependency audit summary'
        }
        'verbose output also displays build details' = {
            $result = Invoke-Scenario 'verbose' @{} @('-SkipPull', '-Verbose')
            Assert (-not $result.Error -and $result.Messages -match 'npm log marker' -and $result.Log -match 'npm log marker') 'Verbose output or log is missing'
        }
        'publish verifies Pages before completion' = {
            $result = Invoke-Scenario 'publish'
            Assert (-not $result.Error) "Unexpected error: $($result.Error)"
            Assert ($result.Events.Contains('deploy pages')) 'Pages was not deployed'
            Assert ($result.Reads -gt 0 -and $result.Completed) 'Online version was not verified'
            Assert ($result.Events.IndexOf('deploy pages') -lt $result.Events.IndexOf('read online version')) 'Verification ran before deployment'
        }
        'stale online version fails' = {
            $result = Invoke-Scenario 'stale' @{ Stale = $true }
            Assert ($result.Error -and -not $result.Completed) 'A stale online version must not report completion'
            Assert ($result.Error -match '9.9.8' -and $result.Error -match '9.9.9') 'Failure must show observed and expected versions'
        }
        'transient network and stale cache recover' = {
            $result = Invoke-Scenario 'retry' @{ TransientReads = $true }
            Assert (-not $result.Error -and $result.Completed -and $result.Reads -eq 3) 'Expected retry until online version is current'
        }
        'deployment failure stops completion' = {
            $result = Invoke-Scenario 'deploy-failure' @{ DeployFails = $true }
            Assert ($result.Error -match '退出码 7' -and -not $result.Completed -and $result.Reads -eq 0) 'Failed deployment must stop before verification'
        }
        'missing EXE stops publication' = {
            $result = Invoke-Scenario 'no-exe' @{ MissingExe = $true }
            Assert ($result.Error -match '附件' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'Missing EXE must fail before Pages deployment'
        }
        'missing APK stops publication' = {
            $result = Invoke-Scenario 'no-apk' @{ MissingApk = $true }
            Assert ($result.Error -match '附件' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'Missing APK must fail before Pages deployment'
        }
        'EXE from another version stops publication' = {
            $result = Invoke-Scenario 'wrong-exe-version' @{ WrongExeVersion = $true }
            Assert ($result.Error -match '附件' -and -not $result.Completed -and -not $result.Events.Contains('deploy pages')) 'An old EXE must not satisfy the asset check'
        }
        'unrelated historical tag conflict does not block release' = {
            $result = Invoke-Scenario 'old-tag' @{ HistoricalTagConflict = $true }
            Assert (-not $result.Error -and $result.Completed) "Unrelated tag blocked release: $($result.Error)"
        }
        'existing remote release tag stops before build' = {
            $result = Invoke-Scenario 'existing-tag' @{ RemoteTagExists = $true }
            Assert ($result.Error -and -not $result.Events.Contains('npm install') -and -not $result.Events.Contains('git push origin v9.9.9')) 'Remote tag must be checked before build/push'
        }
        'APK only does not deploy Pages' = {
            $result = Invoke-Scenario 'apk-only' @{} @('-SkipPull')
            Assert (-not $result.Error -and $result.Completed -and $result.Reads -eq 0 -and -not $result.Events.Contains('deploy pages')) 'APK-only behavior changed'
        }
        'EXE only does not deploy Pages' = {
            $result = Invoke-Scenario 'exe-only' @{} @('-Exe', '-SkipPull')
            Assert (-not $result.Error -and $result.Completed -and $result.Reads -eq 0 -and -not $result.Events.Contains('deploy pages')) 'EXE-only behavior changed'
        }
    }
    foreach ($case in $cases.GetEnumerator()) {
        try { & $case.Value; Write-Host "PASS $($case.Key)" }
        catch { $failed++; Write-Host "FAIL $($case.Key): $($_.Exception.Message)" -ForegroundColor Red }
    }
} finally {
    Set-Location $originalLocation
    foreach ($name in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
    if ($previousTestState) { Set-Variable -Name ReleaseTest -Scope Global -Value $previousTestState.Value }
    else { Remove-Variable -Name ReleaseTest -Scope Global -ErrorAction SilentlyContinue }
    # Only delete this run's owned directory, after checking its absolute location and marker.
    $resolved = [IO.Path]::GetFullPath($suiteRoot)
    $allowedRoot = $testRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Get-Content (Join-Path $resolved '.test-owner') -Raw).Trim() -ne $suiteId) { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
if ($failed) { throw "$failed release test(s) failed" }
Write-Host "$($cases.Count) release tests passed."
