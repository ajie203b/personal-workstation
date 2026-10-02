# Generate Android launcher icons + splash screens (overwrite Capacitor template assets)
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-android-icons.ps1
Add-Type -AssemblyName System.Drawing

$res = Join-Path $PSScriptRoot '..\android\app\src\main\res'

function New-Brush {
  param([System.Drawing.Rectangle]$Rect)
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $Rect,
    [System.Drawing.Color]::FromArgb(255, 13, 92, 216),
    [System.Drawing.Color]::FromArgb(255, 8, 60, 150),
    55.0)
}

function New-RoundedPath {
  param([int]$Size, [double]$RadiusRatio)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = [int]($Size * $RadiusRatio)
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($Size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($Size - $r, $Size - $r, $r, $r, 0, 90)
  $path.AddArc(0, $Size - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  return $path
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bmp, [string]$Out)
  $dir = Split-Path $Out -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $Bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "OK  $Out"
}

function Draw-Glyph {
  param([System.Drawing.Graphics]$g, [int]$BoxWidth, [int]$CanvasSize, [double]$Ratio)
  $font = New-Object System.Drawing.Font('Microsoft YaHei UI', [float]($BoxWidth * $Ratio),
    [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $off = [int](($CanvasSize - $BoxWidth) / 2)
  $box = New-Object System.Drawing.RectangleF($off, ($off - $BoxWidth * 0.01), $BoxWidth, $BoxWidth)
  $g.DrawString([string][char]0x5DE5, $font, [System.Drawing.Brushes]::White, $box, $fmt)
  $font.Dispose()
}

function New-LauncherIcon {
  param([int]$Size, [string]$Out, [bool]$Round = $false)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $brush = New-Brush $rect
  if ($Round) {
    $g.FillEllipse($brush, 0, 0, $Size, $Size)
  } else {
    $path = New-RoundedPath $Size 0.22
    $g.FillPath($brush, $path)
    $path.Dispose()
  }
  Draw-Glyph $g $Size $Size 0.52
  $g.Dispose(); $brush.Dispose()
  Save-Png $bmp $Out
}

# Adaptive foreground: transparent bg + white glyph inside the 66% safe zone
function New-AdaptiveForeground {
  param([int]$Size, [string]$Out)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  Draw-Glyph $g ([int]($Size * 0.46)) $Size 0.0
  $g.Dispose()
  Save-Png $bmp $Out
}

# Splash: light bg + centered rounded logo
function New-Splash {
  param([int]$W, [int]$H, [string]$Out)
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 245, 245, 247))
  $logoSize = [int]([Math]::Min($W, $H) * 0.22)
  $lx = [int](($W - $logoSize) / 2)
  $ly = [int](($H - $logoSize) / 2)
  $logoRect = New-Object System.Drawing.Rectangle($lx, $ly, $logoSize, $logoSize)
  $brush = New-Brush $logoRect
  $path = New-RoundedPath $logoSize 0.24
  $g.FillPath($brush, $path)
  $path.Dispose()
  $fontSize = [float]($logoSize * 0.52)
  $font = New-Object System.Drawing.Font('Microsoft YaHei UI', $fontSize,
    [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF($lx, ($ly - $logoSize * 0.01), $logoSize, $logoSize)
  $g.DrawString([string][char]0x5DE5, $font, [System.Drawing.Brushes]::White, $box, $fmt)
  $font.Dispose(); $brush.Dispose(); $g.Dispose()
  Save-Png $bmp $Out
}

# --- 1. Legacy launcher icons (square + round) for all densities ---
$densities = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
foreach ($k in $densities.Keys) {
  $size = $densities[$k]
  New-LauncherIcon -Size $size -Out (Join-Path $res ($k + '\ic_launcher.png'))
  New-LauncherIcon -Size $size -Out (Join-Path $res ($k + '\ic_launcher_round.png')) -Round $true
}

# --- 2. Adaptive icon foreground (108dp based) ---
$fg = @{ 'mipmap-mdpi' = 108; 'mipmap-hdpi' = 162; 'mipmap-xhdpi' = 216; 'mipmap-xxhdpi' = 324; 'mipmap-xxxhdpi' = 432 }
foreach ($k in $fg.Keys) {
  New-AdaptiveForeground -Size $fg[$k] -Out (Join-Path $res ($k + '\ic_launcher_foreground.png'))
}

# --- 3. Adaptive icon background color -> brand blue ---
$bgFile = Join-Path $res 'values\ic_launcher_background.xml'
$xml = '<resources><color name="ic_launcher_background">#0B57D0</color></resources>'
Set-Content -Path $bgFile -Value $xml -Encoding UTF8
Write-Host "OK  $bgFile"

# --- 4. Splash screens: redraw at each template's existing size ---
Get-ChildItem -Path $res -Recurse -Filter splash.png | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $w = $img.Width; $h = $img.Height
  $img.Dispose()
  New-Splash -W $w -H $h -Out $_.FullName
}

Write-Host 'android icons done'
