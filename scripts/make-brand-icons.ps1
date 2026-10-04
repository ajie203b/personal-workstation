# Generate all app icons from a brand image (PWA + Android launcher + splash)
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-brand-icons.ps1 -SourceImage "C:\path\to\image.jpg"
param([string]$SourceImage = 'D:\Users\yang''jie\Downloads\IMG_20241014_001339.jpg')

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

if (!(Test-Path $SourceImage)) { throw "source image not found: $SourceImage" }
$root = Join-Path $PSScriptRoot '..'
$webIcons = Join-Path $root 'public\icons'
$res = Join-Path $root 'android\app\src\main\res'

# --- load source, center-crop to square ---
$src = [System.Drawing.Image]::FromFile($SourceImage)
$side = [Math]::Min($src.Width, $src.Height)
$square = New-Object System.Drawing.Bitmap($side, $side)
$sg = [System.Drawing.Graphics]::FromImage($square)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$offX = [int](($src.Width - $side) / 2)
$offY = [int](($src.Height - $side) / 2)
$sg.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)),
  (New-Object System.Drawing.Rectangle($offX, $offY, $side, $side)), [System.Drawing.GraphicsUnit]::Pixel)
$sg.Dispose()
$src.Dispose()

function New-RoundedPath {
  param([int]$Size, [double]$RadiusRatio)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($RadiusRatio -le 0) {
    $path.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)))
    return $path
  }
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
  $Bmp.Dispose()
  Write-Host "OK  $Out"
}

# --- generic: brand image drawn with a clip shape ---
function New-BrandIcon {
  param([int]$Size, [string]$Out, [string]$Shape = 'rounded', [double]$Scale = 1.0, [string]$Bg = $null)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = 'AntiAlias'

  if ($Bg) {
    # solid background first (for adaptive foreground blending)
    $g.Clear([System.Drawing.Color]::White)
  }

  $drawSize = [int]($Size * $Scale)
  $off = [int](($Size - $drawSize) / 2)
  $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($Shape -eq 'rounded') {
    $clip = New-RoundedPath -Size $drawSize -RadiusRatio 0.18
  } elseif ($Shape -eq 'circle') {
    $clip.AddEllipse(0, 0, $drawSize, $drawSize)
  } else {
    $clip.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $drawSize, $drawSize)))
  }
  $g.SetClip($clip)
  $g.DrawImage($square, (New-Object System.Drawing.Rectangle($off, $off, $drawSize, $drawSize)),
    (New-Object System.Drawing.Rectangle(0, 0, $side, $side)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()
  $clip.Dispose()
  $g.Dispose()
  Save-Png $bmp $Out
}

# --- splash: white bg + centered brand image ---
function New-Splash {
  param([int]$W, [int]$H, [string]$Out)
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::White)
  $logoSize = [int]([Math]::Min($W, $H) * 0.24)
  $lx = [int](($W - $logoSize) / 2)
  $ly = [int](($H - $logoSize) / 2)
  $clip = New-RoundedPath -Size $logoSize -RadiusRatio 0.18
  $g.SetClip($clip)
  $g.DrawImage($square, (New-Object System.Drawing.Rectangle($lx, $ly, $logoSize, $logoSize)),
    (New-Object System.Drawing.Rectangle(0, 0, $side, $side)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()
  $clip.Dispose()
  $g.Dispose()
  Save-Png $bmp $Out
}

Write-Host '--- PWA icons ---'
New-BrandIcon -Size 512 -Out (Join-Path $webIcons 'icon-512.png') -Shape 'rounded'
New-BrandIcon -Size 192 -Out (Join-Path $webIcons 'icon-192.png') -Shape 'rounded'
New-BrandIcon -Size 512 -Out (Join-Path $webIcons 'icon-512-maskable.png') -Shape 'square' -Scale 0.70 -Bg '#FFFFFF'
New-BrandIcon -Size 180 -Out (Join-Path $webIcons 'apple-touch-icon.png') -Shape 'square' -Scale 0.95 -Bg '#FFFFFF'

# favicon.png (small square)
New-BrandIcon -Size 48 -Out (Join-Path $root 'public\favicon.png') -Shape 'rounded'

# in-app brand mark (sidebar / mobile top bar)
New-BrandIcon -Size 144 -Out (Join-Path $root 'public\brand.png') -Shape 'square'

Write-Host '--- Android launcher icons ---'
$densities = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
foreach ($k in $densities.Keys) {
  $size = $densities[$k]
  New-BrandIcon -Size $size -Out (Join-Path $res ($k + '\ic_launcher.png')) -Shape 'rounded' -Scale 0.94
  New-BrandIcon -Size $size -Out (Join-Path $res ($k + '\ic_launcher_round.png')) -Shape 'circle' -Scale 0.94
}
# adaptive foreground: brand image at 62% centered (safe zone is ~66% of canvas),
# white padding blends into the white background layer -> full image visible on any launcher mask
$fg = @{ 'mipmap-mdpi' = 108; 'mipmap-hdpi' = 162; 'mipmap-xhdpi' = 216; 'mipmap-xxhdpi' = 324; 'mipmap-xxxhdpi' = 432 }
foreach ($k in $fg.Keys) {
  New-BrandIcon -Size $fg[$k] -Out (Join-Path $res ($k + '\ic_launcher_foreground.png')) -Shape 'square' -Scale 0.62 -Bg '#FFFFFF'
}

# adaptive icon background -> white (blends with the brand image edge)
$bgFile = Join-Path $res 'values\ic_launcher_background.xml'
Set-Content -Path $bgFile -Value '<resources><color name="ic_launcher_background">#FFFFFF</color></resources>' -Encoding UTF8
Write-Host "OK  $bgFile"

Write-Host '--- Splash screens ---'
Get-ChildItem -Path $res -Recurse -Filter splash.png | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $w = $img.Width; $h = $img.Height
  $img.Dispose()
  New-Splash -W $w -H $h -Out $_.FullName
}

$square.Dispose()
Write-Host 'brand icons done'
