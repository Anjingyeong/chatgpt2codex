$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Launcher = Join-Path $Root "start-chatgpt.ps1"

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    $messages = ($errors | ForEach-Object { $_.Message }) -join "`n"
    throw "start-chatgpt.ps1 has PowerShell parse errors:`n$messages"
}

$functions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)

foreach ($name in @("Resolve-DevelopmentSourceRoot", "Test-SourceBuildRequired")) {
    $fn = $functions | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if (-not $fn) {
        throw "Launcher helper not found: $name"
    }
    Invoke-Expression $fn.Extent.Text
}

$devRuntime = Join-Path $Root "build\windows\chatgpt2codex"
$resolved = Resolve-DevelopmentSourceRoot $devRuntime
if (-not $resolved -or -not $resolved.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Development runtime did not resolve back to source root. resolved=$resolved expected=$Root"
}

$unrelatedRuntime = Join-Path ([System.IO.Path]::GetTempPath()) "chatgpt2codex-installed-runtime"
if (Resolve-DevelopmentSourceRoot $unrelatedRuntime) {
    throw "An unrelated packaged runtime must not be treated as a source-checkout development package."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("chatgpt2codex-launcher-test-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "src"), (Join-Path $tempRoot "dist") | Out-Null
    Set-Content -LiteralPath (Join-Path $tempRoot "package.json") -Value "{}"
    Set-Content -LiteralPath (Join-Path $tempRoot "package-lock.json") -Value "{}"
    Set-Content -LiteralPath (Join-Path $tempRoot "tsconfig.json") -Value "{}"
    Set-Content -LiteralPath (Join-Path $tempRoot "src\a.ts") -Value "export const a = 1;"
    Set-Content -LiteralPath (Join-Path $tempRoot "dist\cli.js") -Value "// built"

    $now = [datetime]::UtcNow
    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "dist\cli.js"), $now)
    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "src\a.ts"), $now.AddSeconds(-10))
    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "package.json"), $now.AddSeconds(-10))
    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "package-lock.json"), $now.AddSeconds(-10))
    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "tsconfig.json"), $now.AddSeconds(-10))

    if (Test-SourceBuildRequired $tempRoot) {
        throw "Fresh dist/cli.js was incorrectly marked stale."
    }

    [System.IO.File]::SetLastWriteTimeUtc((Join-Path $tempRoot "src\a.ts"), $now.AddSeconds(10))
    if (-not (Test-SourceBuildRequired $tempRoot)) {
        throw "A newer source file did not mark dist/cli.js stale."
    }

    Remove-Item -LiteralPath (Join-Path $tempRoot "dist\cli.js") -Force
    if (-not (Test-SourceBuildRequired $tempRoot)) {
        throw "Missing dist/cli.js did not require a build."
    }
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$packagedLauncher = Join-Path $Root "build\windows\chatgpt2codex\start-chatgpt.ps1"
if (Test-Path -LiteralPath $packagedLauncher) {
    $sourceHash = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash
    $packagedHash = (Get-FileHash -LiteralPath $packagedLauncher -Algorithm SHA256).Hash
    if ($sourceHash -ne $packagedHash) {
        throw "Existing Windows development package launcher is stale. Re-sync start-chatgpt.ps1."
    }
}

Write-Host "Windows development launcher tests passed."
