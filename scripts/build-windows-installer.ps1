[CmdletBinding()]
param(
  [string]$OutputExe = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$BuildRoot = Join-Path $Root "build\windows"
$PackageDir = Join-Path $BuildRoot "chatgpt2codex"
if (-not $OutputExe -or $OutputExe.Trim().Length -eq 0) {
  $OutputExe = Join-Path $BuildRoot "chatgpt2codex-Setup.exe"
}
$OutputExe = [System.IO.Path]::GetFullPath($OutputExe)

function Get-ToolPath([string[]]$Names) {
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  throw "Missing required command: $($Names -join ' or ')"
}

function Invoke-Checked([string]$FilePath, [string[]]$ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
  }
}

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-windows-app.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "Windows app package build failed."
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("chatgpt2codex-installer-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$zip = Join-Path $tempDir "payload.zip"
$stub = Join-Path $tempDir "setup-stub.exe"

try {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $PackageDir,
    $zip,
    [System.IO.Compression.CompressionLevel]::Fastest,
    $false
  )

  $CscCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )
  $Csc = $CscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $Csc) {
    throw "csc.exe was not found; cannot build the installer executable."
  }

  $SetupSource = Join-Path $Root "windows\ChatGPTToCodexSetup.cs"
  $IconPath = Join-Path $PackageDir "chatgpt2codex.ico"
  if (-not (Test-Path -LiteralPath $IconPath)) {
    throw "Windows icon was not generated: $IconPath"
  }
  Invoke-Checked $Csc @(
    "/nologo",
    "/target:winexe",
    "/win32icon:$IconPath",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Management.dll",
    "/reference:Microsoft.CSharp.dll",
    "/out:$stub",
    $SetupSource
  )

  $marker = [System.Text.Encoding]::ASCII.GetBytes("CHATGPT2CODEX_SETUP_PAYLOAD_V1")
  $payload = [System.IO.File]::ReadAllBytes($zip)
  $lengthBytes = [System.BitConverter]::GetBytes([Int64]$payload.Length)

  if (Test-Path -LiteralPath $OutputExe) {
    Remove-Item -LiteralPath $OutputExe -Force
  }
  [System.IO.File]::Copy($stub, $OutputExe)
  $stream = [System.IO.File]::Open($OutputExe, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
  try {
    $stream.Write($payload, 0, $payload.Length)
    $stream.Write($marker, 0, $marker.Length)
    $stream.Write($lengthBytes, 0, $lengthBytes.Length)
  } finally {
    $stream.Close()
  }
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Windows installer ready:"
Write-Host "  $OutputExe"
Write-Host "Double-click this one file to install and launch ChatGPT To Codex."
