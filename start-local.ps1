$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$BackendPort = 18000
$StudioPort = 5173
$BackendLog = Join-Path $RepoRoot "backend-runtime.log"
$BackendErr = Join-Path $RepoRoot "backend-runtime.err.log"
$StudioLog = Join-Path $RepoRoot "studio-dev.log"
$StudioErr = Join-Path $RepoRoot "studio-dev.err.log"
$BackendEnv = Join-Path $RepoRoot "backend/.env"

function Get-ListeningPids([int[]]$Ports) {
    $pattern = ($Ports | ForEach-Object { ":$_" }) -join "|"
    netstat -ano |
        Select-String $pattern |
        Where-Object { $_.Line -match "\sLISTENING\s+(\d+)$" } |
        ForEach-Object { [int]$Matches[1] } |
        Sort-Object -Unique
}

function Stop-Ports([int[]]$Ports) {
    $pids = Get-ListeningPids $Ports
    foreach ($processId in $pids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

function Wait-HttpOk([string]$Url) {
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Timed out waiting for $Url"
}

function Import-DotEnv([string]$Path) {
    if (!(Test-Path $Path)) {
        return
    }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#") -or !$line.Contains("=")) {
            return
        }
        $name, $value = $line.Split("=", 2)
        [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), "Process")
    }
}

Stop-Ports @($BackendPort, $StudioPort)

Import-DotEnv $BackendEnv
$env:PYTHONPATH = "backend/src"
$backend = Start-Process `
    -FilePath "python" `
    -ArgumentList @("-m", "contextos.api", "--host", "127.0.0.1", "--port", "$BackendPort") `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $BackendLog `
    -RedirectStandardError $BackendErr `
    -PassThru
Remove-Item Env:\PYTHONPATH -ErrorAction SilentlyContinue

$env:CONTEXTOS_STUDIO_API_BASE_URL = "http://localhost:$BackendPort"
$env:CONTEXTOS_STUDIO_SSE_BASE_URL = "http://localhost:$BackendPort"
$env:CONTEXTOS_STUDIO_WS_BASE_URL = ""
$env:CONTEXTOS_STUDIO_PORT = "$StudioPort"
$studio = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", "npm --prefix studio run dev:real") `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StudioLog `
    -RedirectStandardError $StudioErr `
    -PassThru
Remove-Item Env:\CONTEXTOS_STUDIO_API_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\CONTEXTOS_STUDIO_SSE_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\CONTEXTOS_STUDIO_WS_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\CONTEXTOS_STUDIO_PORT -ErrorAction SilentlyContinue

Wait-HttpOk "http://127.0.0.1:$BackendPort/health"
Wait-HttpOk "http://127.0.0.1:$StudioPort/__contextos/config.json"

Write-Output "Backend: http://127.0.0.1:$BackendPort PID $($backend.Id)"
Write-Output "Studio:  http://localhost:$StudioPort PID $($studio.Id)"
Write-Output "Logs:    backend-runtime.log, backend-runtime.err.log, studio-dev.log, studio-dev.err.log"
