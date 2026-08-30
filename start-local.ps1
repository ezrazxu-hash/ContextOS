$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$BackendPort = 18000
$StudioPort = 5173
$LogDir = Join-Path $RepoRoot "logs"
$BackendLog = Join-Path $LogDir "backend-runtime.log"
$BackendErr = Join-Path $LogDir "backend-runtime.err.log"
$StudioLog = Join-Path $LogDir "studio-dev.log"
$StudioErr = Join-Path $LogDir "studio-dev.err.log"
$BackendEnv = Join-Path $RepoRoot "backend/.env"

function Get-ListeningPids([int[]]$Ports) {
    $pattern = ($Ports | ForEach-Object { ":$_" }) -join "|"
    netstat -ano |
        Select-String $pattern |
        Where-Object { $_.Line -match "\sLISTENING\s+(\d+)$" } |
        ForEach-Object { [int]$Matches[1] } |
        Sort-Object -Unique
}

function Format-Pids([int[]]$Pids) {
    if ($Pids.Count -eq 0) {
        return "not listening"
    }
    return ($Pids | Sort-Object -Unique) -join ","
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

function Quote-ForChildPowerShell([string]$Value) {
    return "'" + ($Value -replace "'", "''") + "'"
}

function Start-DetachedPowerShell([string]$Command) {
    return Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden `
        -PassThru
}

Stop-Ports @($BackendPort, $StudioPort)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Import-DotEnv $BackendEnv

$backendCommand = @"
Set-Location -LiteralPath $(Quote-ForChildPowerShell $RepoRoot)
`$env:PYTHONPATH = 'backend/src'
python -m contextos.api --host 127.0.0.1 --port $BackendPort 1> $(Quote-ForChildPowerShell $BackendLog) 2> $(Quote-ForChildPowerShell $BackendErr)
"@
$backend = Start-DetachedPowerShell $backendCommand

$studioCommand = @"
Set-Location -LiteralPath $(Quote-ForChildPowerShell $RepoRoot)
`$env:CONTEXTOS_STUDIO_API_BASE_URL = 'http://localhost:$BackendPort'
`$env:CONTEXTOS_STUDIO_SSE_BASE_URL = 'http://localhost:$BackendPort'
`$env:CONTEXTOS_STUDIO_WS_BASE_URL = ''
`$env:CONTEXTOS_STUDIO_PORT = '$StudioPort'
npm --prefix studio run dev:real 1> $(Quote-ForChildPowerShell $StudioLog) 2> $(Quote-ForChildPowerShell $StudioErr)
"@
$studio = Start-DetachedPowerShell $studioCommand

Wait-HttpOk "http://127.0.0.1:$BackendPort/health"
Wait-HttpOk "http://127.0.0.1:$StudioPort/__contextos/config.json"

$BackendPids = Format-Pids (Get-ListeningPids @($BackendPort))
$StudioPids = Format-Pids (Get-ListeningPids @($StudioPort))

Write-Output "Backend: http://127.0.0.1:$BackendPort PID $BackendPids"
Write-Output "Studio:  http://localhost:$StudioPort PID $StudioPids"
Write-Output "Logs:    $LogDir"
