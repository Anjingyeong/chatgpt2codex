[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\ChatGPT To Codex"),
  [switch]$NoShortcut
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$PackageDir = Join-Path $Root "build\windows\chatgpt2codex"

if (-not (Test-Path -LiteralPath (Join-Path $PackageDir "start-chatgpt.cmd"))) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-windows-app.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Windows package build failed."
  }
}

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $InstallDir -Recurse -Force

function New-ChatGpt2CodexShortcut([string]$ShortcutPath, [string]$TargetPath, [string]$WorkingDirectory, [string]$IconPath) {
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($ShortcutPath)) -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = "Start ChatGPT To Codex"
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Save()
}

if (-not $NoShortcut) {
  $programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $desktop = [Environment]::GetFolderPath("DesktopDirectory")
  if (-not $desktop) {
    $desktop = Join-Path $env:USERPROFILE "Desktop"
  }
  $target = Join-Path $InstallDir "chatgpt2codex.exe"
  if (-not (Test-Path -LiteralPath $target)) {
    $target = Join-Path $InstallDir "start-chatgpt.cmd"
  }
  $icon = Join-Path $InstallDir "chatgpt2codex.ico"
  if (-not (Test-Path -LiteralPath $icon)) {
    $icon = $target
  }

  New-ChatGpt2CodexShortcut (Join-Path $programs "ChatGPT To Codex.lnk") $target $InstallDir $icon
  New-ChatGpt2CodexShortcut (Join-Path $desktop "ChatGPT To Codex.lnk") $target $InstallDir $icon
}

Write-Host "ChatGPT To Codex installed to:"
Write-Host "  $InstallDir"
if (-not $NoShortcut) {
  Write-Host "Shortcuts:"
  Write-Host "  Start Menu: ChatGPT To Codex"
  Write-Host "  Desktop: ChatGPT To Codex"
}
