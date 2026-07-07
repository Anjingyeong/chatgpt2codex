$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$source = Join-Path $scriptDir "ChatGPTToCodexLauncher.cs"
$out = Join-Path $root "ChatGPT To Codex.exe"
$iconPng = Join-Path $root "assets\chatgpt2codex-icon.png"
$iconIco = Join-Path $root "assets\chatgpt2codex-icon.ico"

if (-not (Test-Path $source)) {
    throw "Launcher source not found: $source"
}

if ((Test-Path $iconPng) -and -not (Test-Path $iconIco)) {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile($iconPng)
    try {
        $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
        try {
            $stream = [System.IO.File]::Create($iconIco)
            try { $icon.Save($stream) } finally { $stream.Dispose() }
        } finally {
            $icon.Dispose()
        }
    } finally {
        $bitmap.Dispose()
    }
}

$refs = @("System.Windows.Forms.dll", "System.Drawing.dll")
$compilerOptions = "/target:winexe"
if (Test-Path $iconIco) {
    $compilerOptions = "$compilerOptions /win32icon:`"$iconIco`""
}

Add-Type `
    -TypeDefinition (Get-Content -Raw $source) `
    -ReferencedAssemblies $refs `
    -OutputAssembly $out `
    -OutputType WindowsApplication `
    -CompilerOptions $compilerOptions

Write-Host "[chatgpt2codex] built $out"
