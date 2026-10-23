# 在当前 Windows 用户下生成并配置桌面更新密钥。不会覆盖已有密钥；秘密不进入命令参数或日志。
[CmdletBinding()]
param([switch]$Upload)
$ErrorActionPreference='Stop'
$repository='ajie203b/personal-workstation'
$projectRoot=Split-Path -Parent $PSScriptRoot
$configPath=Join-Path $projectRoot 'src-tauri/tauri.conf.json'
$configText=[IO.File]::ReadAllText($configPath)
$configuredKey=($configText | ConvertFrom-Json).plugins.updater.pubkey
$keyDirectory=Join-Path $env:USERPROFILE '.tauri/kairos-updater'
$privatePath=Join-Path $keyDirectory 'kairos.key'
$publicPath="$privatePath.pub"
$passwordPath=Join-Path $keyDirectory 'password.dpapi'

function Invoke-PrivateProcess([string]$Executable,[string[]]$Arguments,[hashtable]$Variables=@{},[string]$InputText) {
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$Executable
    $info.WorkingDirectory=$projectRoot
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    $info.RedirectStandardInput=$true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    foreach ($entry in $Variables.GetEnumerator()) { $info.Environment[$entry.Key]=[string]$entry.Value }
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        if ($null -ne $InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        $process.WaitForExit()
        # Tauri generate can print secret material. Never forward child output, including failures.
        [void]$stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "受保护的子进程执行失败（退出码 $($process.ExitCode)）；未输出秘密日志。" }
    } finally { $process.Dispose() }
}

if (-not (Test-Path -LiteralPath $privatePath)) {
    if ($configuredKey -and $configuredKey -notlike 'REPLACE_WITH_*') { throw '项目已配置公钥但本机没有原私钥，请恢复原密钥；不能自动换钥。' }
    if (Test-Path -LiteralPath $keyDirectory) { throw '密钥目录已存在但没有完整密钥，请先检查，脚本不会覆盖。' }
    [void][IO.Directory]::CreateDirectory($keyDirectory)
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    Set-Acl -LiteralPath $keyDirectory -AclObject $acl
    $randomBytes=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $password=[Convert]::ToBase64String($randomBytes)
    $protectedPassword=ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString
    [IO.File]::WriteAllText($passwordPath,$protectedPassword)
    Invoke-PrivateProcess (Get-Command node).Source @((Join-Path $PSScriptRoot 'updater-signer.cjs'),'generate',$privatePath) @{TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$password}
}
if (-not (Test-Path -LiteralPath $publicPath) -or -not (Test-Path -LiteralPath $passwordPath)) { throw '密钥或口令保护文件不完整，请恢复原文件。' }
$securePassword=ConvertTo-SecureString ([IO.File]::ReadAllText($passwordPath))
$password=[Net.NetworkCredential]::new('', $securePassword).Password
try {
    $publicKey=[IO.File]::ReadAllText($publicPath).Trim()
    if ($configuredKey -and $configuredKey -notlike 'REPLACE_WITH_*' -and $configuredKey -ne $publicKey) { throw '本机密钥与客户端公钥不一致，拒绝自动换钥。' }
    if ($configuredKey -like 'REPLACE_WITH_*') { [IO.File]::WriteAllText($configPath,$configText.Replace($configuredKey,$publicKey)) }
    $fixtureDirectory=Join-Path $projectRoot 'apk/signing-self-test'
    [void][IO.Directory]::CreateDirectory($fixtureDirectory)
    $fixturePath=Join-Path $fixtureDirectory 'self-test.txt'
    [IO.File]::WriteAllText($fixturePath,'Kairos updater signing self-test; no user data.')
    Invoke-PrivateProcess (Get-Command node).Source @((Join-Path $PSScriptRoot 'updater-signer.cjs'),'sign',$fixturePath,'0.0.0') @{TAURI_SIGNING_PRIVATE_KEY_PATH=$privatePath;TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$password}
    & node (Join-Path $PSScriptRoot 'verify-updater.mjs') --config $configPath --artifact $fixturePath --signature "$fixturePath.sig" --version '0.0.0'
    if ($LASTEXITCODE -ne 0) { throw '真实 Tauri 签名验证失败，未上传密钥。' }
    if ($Upload) {
        $gh=(Get-Command gh).Source
        Invoke-PrivateProcess $gh @('secret','set','TAURI_SIGNING_PRIVATE_KEY','--repo',$repository) @{} ([IO.File]::ReadAllText($privatePath))
        Invoke-PrivateProcess $gh @('secret','set','TAURI_SIGNING_PRIVATE_KEY_PASSWORD','--repo',$repository) @{} $password
        Write-Host 'GitHub Actions 的两项签名 Secret 已配置。'
    }
    Write-Host "密钥保存目录：$keyDirectory"
    Write-Host '口令使用 Windows DPAPI 保护，仅当前 Windows 用户可解密；跨机迁移前应将私钥和口令备份到密码管理器。'
} finally { $password=$null;$securePassword.Dispose() }
