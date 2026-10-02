# 生成 PWA 图标（512/192/apple-touch 180/maskable 512）
# 运行：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

function New-Icon {
  param([int]$Size, [string]$Out, [double]$Scale = 1.0, [bool]$Rounded = $true)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($Rounded) {
    $r = [int]($Size * 0.22)
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($Size - $r, 0, $r, $r, 270, 90)
    $path.AddArc($Size - $r, $Size - $r, $r, $r, 0, 90)
    $path.AddArc(0, $Size - $r, $r, $r, 90, 90)
    $path.CloseFigure()
  } else {
    $path.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)))
  }

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 13, 92, 216),
    [System.Drawing.Color]::FromArgb(255, 8, 60, 150),
    55.0)
  $g.FillPath($brush, $path)

  $fontSize = [float]($Size * 0.52 * $Scale)
  $font = New-Object System.Drawing.Font('Microsoft YaHei UI', $fontSize,
    [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF(0, ($Size * -0.01), $Size, $Size)
  $g.DrawString([char]0x5DE5, $font, [System.Drawing.Brushes]::White, $box, $fmt)

  $dir = Split-Path $Out -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $brush.Dispose(); $bmp.Dispose()
  Write-Host "OK  $Out"
}

$root = Join-Path $PSScriptRoot '..\public\icons'
New-Icon -Size 512 -Out (Join-Path $root 'icon-512.png')
New-Icon -Size 192 -Out (Join-Path $root 'icon-192.png')
New-Icon -Size 180 -Out (Join-Path $root 'apple-touch-icon.png')
New-Icon -Size 512 -Out (Join-Path $root 'icon-512-maskable.png') -Scale 0.68 -Rounded $false
Write-Host 'icons done'
