param(
    [string]$Workspace = $env:WORKSPACE,
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 7979 }),
    [string]$PublicHostname = $env:PUBLIC_HOSTNAME,
    [string]$ActiveProjectRoot = $env:CHATGPT2CODEX_ACTIVE_PROJECT_ROOT,
    [string]$ActiveProjectPreset = $(if ($env:CHATGPT2CODEX_ACTIVE_PROJECT_PRESET) { $env:CHATGPT2CODEX_ACTIVE_PROJECT_PRESET } else { "full-write" }),
    [switch]$ExposeWeb,
    [switch]$RotateOwnerToken
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-DevelopmentSourceRoot([string]$RuntimeRoot) {
    try {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $RuntimeRoot "..\..\.."))
        $expectedRuntime = [System.IO.Path]::GetFullPath((Join-Path $candidate "build\windows\chatgpt2codex"))
        $sourceLauncher = Join-Path $candidate "start-chatgpt.ps1"
        $sourceDir = Join-Path $candidate "src"
        $packageJson = Join-Path $candidate "package.json"
        if (
            [System.IO.Path]::GetFullPath($RuntimeRoot).Equals($expectedRuntime, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $sourceLauncher) -and
            (Test-Path -LiteralPath $sourceDir) -and
            (Test-Path -LiteralPath $packageJson)
        ) {
            return $candidate
        }
    } catch {
    }
    return $null
}

$developmentSourceRoot = Resolve-DevelopmentSourceRoot $Root
if ($developmentSourceRoot) {
    $sourceLauncher = Join-Path $developmentSourceRoot "start-chatgpt.ps1"
    Write-Host "[chatgpt2codex] development package detected; delegating to source checkout: $developmentSourceRoot"
    $env:PATH = "$Root\bin;$env:PATH"
    & $sourceLauncher @PSBoundParameters
    if ($?) { exit 0 }
    exit 1
}

$machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$nodePath = Join-Path $env:ProgramFiles "nodejs"
$cloudflaredPath = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe"
$env:PATH = "$Root\bin;$nodePath;$cloudflaredPath;$env:USERPROFILE\.local\bin;$machinePath;$userPath;$env:PATH"

if (-not $Workspace) {
    $Workspace = Join-Path $HOME "workspace"
}
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
$Workspace = [System.IO.Path]::GetFullPath($Workspace)

$cloudflaredName = $env:CLOUDFLARED_TUNNEL_NAME
$cloudflaredToken = $env:CLOUDFLARED_TUNNEL_TOKEN
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "chatgpt2codex"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$cfOut = Join-Path $tempRoot "cloudflared.out.log"
$cfErr = Join-Path $tempRoot "cloudflared.err.log"
$srvOut = Join-Path $tempRoot "server.out.log"
$srvErr = Join-Path $tempRoot "server.err.log"

function Need-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing command: $Name"
    }
}

function Test-SourceBuildRequired([string]$SourceRoot) {
    $cliPath = Join-Path $SourceRoot "dist\cli.js"
    if (-not (Test-Path -LiteralPath $cliPath)) {
        return $true
    }

    $sourceDir = Join-Path $SourceRoot "src"
    if (-not (Test-Path -LiteralPath $sourceDir)) {
        return $false
    }

    $distStamp = (Get-Item -LiteralPath $cliPath).LastWriteTimeUtc
    $watchFiles = @(
        (Join-Path $SourceRoot "package.json"),
        (Join-Path $SourceRoot "package-lock.json"),
        (Join-Path $SourceRoot "tsconfig.json")
    )
    foreach ($file in $watchFiles) {
        if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).LastWriteTimeUtc -gt $distStamp) {
            return $true
        }
    }

    foreach ($file in Get-ChildItem -LiteralPath $sourceDir -Recurse -File -ErrorAction SilentlyContinue) {
        if ($file.LastWriteTimeUtc -gt $distStamp) {
            return $true
        }
    }
    return $false
}

function Quote-Arg([string]$Value) {
    if ($Value -match '^[A-Za-z0-9_\-.:/\\=]+$') {
        return $Value
    }
    return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function Start-LoggedProcess([string]$File, [string[]]$ArgumentList, [string]$Stdout, [string]$Stderr) {
    Remove-Item -Force -ErrorAction SilentlyContinue $Stdout, $Stderr
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $File
    $psi.Arguments = (($ArgumentList | ForEach-Object { Quote-Arg $_ }) -join " ")
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $psi
    $process.Start() | Out-Null
    Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -MessageData $Stdout -Action {
        if ($EventArgs.Data) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data }
    } | Out-Null
    Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -MessageData $Stderr -Action {
        if ($EventArgs.Data) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data }
    } | Out-Null
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return $process
}

function Test-PortBusy([int]$PortToCheck) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $PortToCheck)
        $listener.Start()
        return $false
    } catch {
        return $true
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Wait-HttpOk([string]$Url, [int]$Tries, [string]$Label) {
    for ($i = 0; $i -lt $Tries; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $Url
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        } catch {
        }
        Start-Sleep -Seconds 1
    }
    throw "$Label did not become ready: $Url"
}

function Resolve-HostWithCloudflareDoh([string]$HostName) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return @() }

    try {
        $queryUrl = "https://cloudflare-dns.com/dns-query?name=$([System.Uri]::EscapeDataString($HostName))&type=A"
        $jsonText = & curl.exe --silent --show-error --resolve "cloudflare-dns.com:443:1.1.1.1" -H "accept: application/dns-json" --max-time 8 $queryUrl
        if ($LASTEXITCODE -ne 0) { return @() }
        $json = ($jsonText -join "`n") | ConvertFrom-Json
        return @($json.Answer | Where-Object { $_.type -eq 1 -and $_.data } | ForEach-Object { [string]$_.data })
    } catch {
        return @()
    }
}

function Test-HttpOkWithCurlResolve([string]$Url) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $false }

    try {
        $uri = [System.Uri]::new($Url)
        if ($uri.Scheme -ne "https") { return $false }
        $ips = Resolve-HostWithCloudflareDoh $uri.Host
        foreach ($ip in $ips) {
            $resolve = "$($uri.Host):443:$ip"
            $output = & curl.exe --silent --show-error --resolve $resolve --connect-timeout 5 --max-time 10 --write-out "`nHTTP_STATUS:%{http_code}" $Url
            $text = ($output -join "`n")
            $statusMatch = [regex]::Match($text, "HTTP_STATUS:(\d+)")
            $status = if ($statusMatch.Success) { [int]$statusMatch.Groups[1].Value } else { 0 }
            if ($LASTEXITCODE -eq 0 -and $status -ge 200 -and $status -lt 300) {
                return $true
            }
        }
    } catch {
    }
    return $false
}

function Wait-PublicHttpOk([string]$Url, [int]$Tries, [string]$Label) {
    for ($i = 0; $i -lt $Tries; $i++) {
        $standardError = $null
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        } catch {
            $standardError = $_.Exception.Message
        }
        if ($standardError -and ($i % 5 -eq 0) -and
            (Test-HttpOkWithCurlResolve $Url)) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "$Label did not become ready: $Url"
}

function Get-QuickTunnelUrl {
    $text = ""
    foreach ($path in @($cfOut, $cfErr)) {
        if (Test-Path $path) {
            $text += "`n" + (Get-Content -Raw -ErrorAction SilentlyContinue $path)
        }
    }
    $matches = [regex]::Matches($text, 'https://[A-Za-z0-9.-]+\.trycloudflare\.com')
    if ($matches.Count -gt 0) {
        return $matches[0].Value
    }
    return $null
}

function Wait-QuickTunnelUrl([System.Diagnostics.Process]$Process, [int]$Tries) {
    for ($i = 0; $i -lt $Tries; $i++) {
        $url = Get-QuickTunnelUrl
        if ($url) { return $url }
        if ($Process.HasExited) {
            throw "cloudflared exited early. See $cfOut and $cfErr"
        }
        Start-Sleep -Seconds 1
    }
    throw "Quick Tunnel URL did not appear. See $cfOut and $cfErr"
}

function Start-QuickTunnelWithRetry([int]$Attempts) {
    $lastError = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        if ($attempt -gt 1) {
            Write-Host "[chatgpt2codex] retrying public tunnel ($attempt/$Attempts)..."
            Start-Sleep -Seconds ([Math]::Min(10, 2 * $attempt))
        }

        $process = Start-LoggedProcess "cloudflared" @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port") $cfOut $cfErr
        try {
            $url = Wait-QuickTunnelUrl $process 45
            return [pscustomobject]@{ Process = $process; Url = $url }
        } catch {
            $lastError = $_
            Stop-Child $process
        }
    }

    if ($lastError) { throw $lastError }
    throw "Quick Tunnel URL did not appear. See $cfOut and $cfErr"
}

function Stop-Child([System.Diagnostics.Process]$Process) {
    if ($Process -and -not $Process.HasExited) {
        try { $Process.Kill($true) } catch { try { $Process.Kill() } catch {} }
    }
}

function Test-PathUnder([string]$Value, [string]$Parent) {
    if (-not $Value -or -not $Parent) { return $false }
    try {
        $fullValue = [System.IO.Path]::GetFullPath($Value.Trim('"')).TrimEnd('\')
        $fullParent = [System.IO.Path]::GetFullPath($Parent.Trim('"')).TrimEnd('\')
        return $fullValue.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullValue.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Stop-StaleRuntimeProcesses([int]$PortToStop) {
    $currentPid = $PID
    $escapedRoot = [regex]::Escape($Root)
    $stopped = @()

    foreach ($proc in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
        $procPid = [int]$proc.ProcessId
        if ($procPid -eq $currentPid -or $procPid -le 0) { continue }

        $cmd = [string]$proc.CommandLine
        $exe = [string]$proc.ExecutablePath
        if (-not $cmd -and -not $exe) { continue }

        $isRuntimeProcess = (Test-PathUnder $exe $Root) -or ($cmd -match $escapedRoot)
        if (-not $isRuntimeProcess) { continue }

        $isSamePortServer = $cmd -match "dist[\\/]+cli\.js" -and
            $cmd -match "\bserve\b" -and
            $cmd -match "\b--port\s+$PortToStop\b"
        $isSamePortTunnel = $cmd -match "\bcloudflared(\.exe)?\b" -and
            ($cmd -match "127\.0\.0\.1:$PortToStop" -or $cmd -match "localhost:$PortToStop")
        $isLauncherScript = $cmd -match "start-chatgpt\.ps1" -and
            ($cmd -match "\b-Port\s+$PortToStop\b" -or $cmd -match $escapedRoot)

        if ($isSamePortServer -or $isSamePortTunnel -or $isLauncherScript) {
            try {
                Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue
                $stopped += "$($proc.Name)#$procPid"
            } catch {
            }
        }
    }

    if ($stopped.Count -gt 0) {
        Write-Host "[chatgpt2codex] stopped stale runtime process(es): $($stopped -join ', ')"
        Start-Sleep -Milliseconds 800
    }
}

Need-Command node
Set-Location $Root

if (Test-SourceBuildRequired $Root) {
    Need-Command npm
    if (Test-Path (Join-Path $Root "dist\cli.js")) {
        Write-Host "[chatgpt2codex] source is newer than dist/cli.js; rebuilding..."
    } else {
        Write-Host "[chatgpt2codex] dist/cli.js missing; building..."
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "TypeScript build failed."
    }
}

Stop-StaleRuntimeProcesses $Port
if (Test-PortBusy $Port) {
    throw "Port $Port is already in use. Set PORT or stop the other process."
}

$cli = Join-Path $Root "dist\cli.js"
if ($RotateOwnerToken -or $env:CHATGPT2CODEX_ROTATE_OWNER_TOKEN -eq "1") {
    Write-Host "[chatgpt2codex] generating owner token..."
    $tokenJsonText = node $cli owner-token --generate --workspace $Workspace
    if ($LASTEXITCODE -ne 0) {
        throw "Owner token generation failed."
    }
    $tokenResult = ($tokenJsonText -join "`n") | ConvertFrom-Json
    if (-not $tokenResult.ownerToken) {
        throw "Owner token generation did not return a token."
    }
    Write-Host ""
    Write-Host "chatgpt2codex init: generated a new HTTP owner token (shown once, never logged again):"
    Write-Host ""
    Write-Host "  $($tokenResult.ownerToken)"
    Write-Host ""
    Write-Host "Store this securely. It is required to approve ChatGPT/MCP connections."
}
$doctor = node $cli doctor 2>$null
if (($doctor -join "`n") -notmatch "owner token configured") {
    throw "Owner token is not configured. Open ChatGPT To Codex settings and generate or set an owner token first."
}

$cfProc = $null
$srvProc = $null
try {
    $useTunnel = $ExposeWeb -or $env:CHATGPT2CODEX_EXPOSE_WEB -eq "1" -or $PublicHostname -or $cloudflaredToken -or $cloudflaredName
    $idleShutdownMinutes = $env:CHATGPT2CODEX_IDLE_SHUTDOWN_MINUTES
    if ($useTunnel) {
        Need-Command cloudflared
        Write-Host "[chatgpt2codex] 1/3 starting public tunnel..."
        if ($cloudflaredToken -or $cloudflaredName) {
            if (-not $PublicHostname) {
                throw "PUBLIC_HOSTNAME is required with CLOUDFLARED_TUNNEL_TOKEN or CLOUDFLARED_TUNNEL_NAME."
            }
            $publicUrl = "https://$PublicHostname"
            if ($cloudflaredToken) {
                $cfProc = Start-LoggedProcess "cloudflared" @("tunnel", "--no-autoupdate", "run", "--token", $cloudflaredToken) $cfOut $cfErr
            } else {
                $cfProc = Start-LoggedProcess "cloudflared" @("tunnel", "--no-autoupdate", "run", "--url", "http://127.0.0.1:$Port", $cloudflaredName) $cfOut $cfErr
            }
        } elseif ($PublicHostname) {
            $publicUrl = "https://$PublicHostname"
            $cfProc = Start-LoggedProcess "cloudflared" @("tunnel", "--hostname", $PublicHostname, "--url", "http://127.0.0.1:$Port", "--no-autoupdate") $cfOut $cfErr
        } else {
            $quickTunnel = Start-QuickTunnelWithRetry 4
            $cfProc = $quickTunnel.Process
            $publicUrl = $quickTunnel.Url
        }
    } else {
        $publicUrl = "http://127.0.0.1:$Port"
        Write-Host "[chatgpt2codex] 1/2 loopback-only mode; no public tunnel."
    }

    Write-Host "[chatgpt2codex] 2/3 starting local HTTP/OAuth MCP server..."
    $serverArgs = @($cli, "serve", "--http", "--port", "$Port", "--public-url", $publicUrl, "--workspace", $Workspace)
    if ($idleShutdownMinutes) {
        $serverArgs += @("--idle-shutdown-minutes", "$idleShutdownMinutes")
    }
    if ($ActiveProjectRoot) {
        $serverArgs += @("--active-project-root", $ActiveProjectRoot, "--active-project-preset", $ActiveProjectPreset)
    }
    $srvProc = Start-LoggedProcess "node" $serverArgs $srvOut $srvErr
    Wait-HttpOk "http://127.0.0.1:$Port/healthz" 20 "local server"

    Write-Host ""
    Write-Host "[chatgpt2codex] connector URL ready:"
    Write-Host "   $publicUrl/mcp"
    Write-Host ""

    if ($useTunnel) {
        Write-Host "[chatgpt2codex] 3/3 checking public health..."
        try {
            Wait-PublicHttpOk "$publicUrl/healthz" 60 "public endpoint"
        } catch {
            Write-Host "[chatgpt2codex] public health check is still warming up: $($_.Exception.Message)"
            Write-Host "[chatgpt2codex] keeping the server and tunnel alive; retry health from the app or ChatGPT."
        }
    }

    Write-Host ""
    Write-Host "============================================================"
    Write-Host " ChatGPT To Codex is ready"
    Write-Host "============================================================"
    Write-Host " MCP URL:"
    Write-Host ""
    Write-Host "   $publicUrl/mcp"
    Write-Host ""
    Write-Host " Notes:"
    Write-Host "   - Keep this window or tray app running."
    Write-Host "   - Default mode is loopback-only and is not reachable from ChatGPT web."
    Write-Host "   - Enable ChatGPT web tunnel only while a public URL is needed."
    Write-Host "   - Web mode stays running unless CHATGPT2CODEX_IDLE_SHUTDOWN_MINUTES is set."
    if ($useTunnel -and -not $PublicHostname -and -not $cloudflaredToken -and -not $cloudflaredName) {
        Write-Host "   - This trycloudflare.com URL is temporary and changes when the tunnel restarts."
        Write-Host "   - For a ChatGPT app you keep using, configure PUBLIC_HOSTNAME with a named tunnel."
    }
    Write-Host "   - If the owner token appeared in a chat/screenshot, rotate it."
    Write-Host "============================================================"

    while ($true) {
        if ($srvProc.HasExited) {
            if ($srvProc.ExitCode -eq 0) {
                Write-Host "[chatgpt2codex] server stopped."
                break
            }
            throw "server exited. See $srvOut and $srvErr"
        }
        if ($useTunnel -and $cfProc.HasExited) { throw "cloudflared exited. See $cfOut and $cfErr" }
        Start-Sleep -Seconds 1
    }
} finally {
    Stop-Child $srvProc
    Stop-Child $cfProc
}
