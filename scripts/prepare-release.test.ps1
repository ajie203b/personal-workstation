$ErrorActionPreference = 'Stop'
$base = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apk'))
$id = [guid]::NewGuid().ToString('N')
$fixture = Join-Path $base "prepare-test-$id"
$original = Get-Location
try {
    New-Item -ItemType Directory -Force (Join-Path $fixture 'scripts'), (Join-Path $fixture 'android/app') | Out-Null
    Set-Content (Join-Path $fixture '.owner') $id
    Copy-Item (Join-Path $PSScriptRoot 'prepare-release.ps1') (Join-Path $fixture 'scripts')
    Set-Content (Join-Path $fixture 'package.json') '{"version":"1.2.3"}'
    Set-Content (Join-Path $fixture 'package-lock.json') '{"version":"1.2.3","packages":{"":{"version":"1.2.3"},"node_modules/other":{"version":"1.2.3"}}}'
    Set-Content (Join-Path $fixture 'android/app/build.gradle') "versionName `"1.2.3`"`nversionCode 7"
    Set-Content (Join-Path $fixture 'CHANGELOG.md') "# 更新记录`n`n## v1.2.3`n`nEarlier release."
    Set-Location $fixture
    git init -q
    git config user.name 'Release Test'
    git config user.email 'release-test@example.invalid'
    git add .
    git commit -q -m baseline
    git tag v1.2.3
    Set-Content feature.txt 'test'
    git add feature.txt
    git commit -q -m 'fix: test change'
    & ./scripts/prepare-release.ps1 -PreviousTag v1.2.3 -Version 1.2.4
    if ($LASTEXITCODE -ne 0) { throw '版本准备提交失败' }
    $package = Get-Content package.json -Raw | ConvertFrom-Json
    $lock = Get-Content package-lock.json -Raw | ConvertFrom-Json -AsHashtable
    $gradle = Get-Content android/app/build.gradle -Raw
    $changelog = Get-Content CHANGELOG.md -Raw
    if ($package.version -ne '1.2.4' -or $lock.version -ne '1.2.4' -or $lock.packages[''].version -ne '1.2.4' -or
        $lock.packages['node_modules/other'].version -ne '1.2.3' -or $gradle -notmatch 'versionCode 8' -or
        $gradle -notmatch 'versionName "1.2.4"' -or $changelog -notmatch '## v1.2.4' -or
        $changelog -notmatch 'fix: test change' -or $changelog -notmatch '## v1.2.3' -or (git status --porcelain)) {
        throw '版本、更新记录或提交结果不正确'
    }
    Set-Content feature.txt 'uncommitted'
    $blocked = $false
    try { & ./scripts/prepare-release.ps1 -PreviousTag v1.2.3 -Version 1.2.5 } catch { $blocked = $true }
    if (-not $blocked) { throw '有未提交文件时不应自动提交' }
    Write-Host '版本准备测试通过。'
} finally {
    Set-Location $original
    $resolved = (Resolve-Path -LiteralPath $fixture).ProviderPath
    if ([IO.Path]::GetDirectoryName($resolved) -ne $base -or (Get-Content (Join-Path $resolved '.owner') -Raw).Trim() -ne $id) { throw '测试目录校验失败' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
