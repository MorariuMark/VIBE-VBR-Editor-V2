$desktop = [Environment]::GetFolderPath('Desktop')
$targetPath = 'd:\VIBE-VBR Editor\dist\win-unpacked\VIBE-BR-Video Editor.exe'
$shortcutPath = Join-Path $desktop 'VIBE-BR Video Editor.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = 'd:\VIBE-VBR Editor\dist\win-unpacked'
$shortcut.IconLocation = 'd:\VIBE-VBR Editor\assets\icon.png'
$shortcut.Save()

Write-Host "Desktop shortcut created at $shortcutPath"
