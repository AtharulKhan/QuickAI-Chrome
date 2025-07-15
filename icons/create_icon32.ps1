# PowerShell script to create icon32.png in the images directory

$base64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGUlEQVR42mP8z/C/HwMDAwMjI2NgYGBgAAAwAABJkA9nAAAAAASUVORK5CYII="
[IO.File]::WriteAllBytes("icon32.png", [Convert]::FromBase64String($base64))
Write-Host "icon32.png created in images/"
