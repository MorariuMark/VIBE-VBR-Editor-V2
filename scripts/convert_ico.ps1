Add-Type -AssemblyName System.Drawing

$src = 'd:\VIBE-VBR Editor\assets\icon.png'
$dest = 'd:\VIBE-VBR Editor\assets\icon.ico'

$img = [System.Drawing.Image]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap($img, 256, 256)
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$stream = [System.IO.File]::Create($dest)
$icon.Save($stream)
$stream.Close()

Write-Host "ICO created successfully at $dest"
