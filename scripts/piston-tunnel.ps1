# Supervises the local Piston auth-proxy plus a Cloudflare quick tunnel, and
# keeps the live Worker's Piston URL in sync automatically.
#
# Quick tunnels always mint a brand-new trycloudflare.com hostname every time
# cloudflared (re)starts -- that's a Cloudflare limitation, not something this
# script can avoid. What it DOES do is make that a non-event: it watches
# cloudflared's own output for the new URL and POSTs it straight to the
# Worker's /internal/piston-url endpoint, so nobody has to manually
# `wrangler secret put PISTON_URL` again after a restart.
#
# It also starts scripts/piston-proxy.mjs (the shared-secret auth gate) and
# points cloudflared at THAT port instead of Piston's bare port, so the
# tunnel is never a public unauthenticated code-exec endpoint.
#
# Prerequisites:
#   - Docker Desktop running with the Piston container up on port 2000
#   - Node.js and cloudflared on PATH
#   - scripts/piston.local.json filled in (copy piston.local.example.json)
#   - The Worker has PISTON_ADMIN_TOKEN and PISTON_AUTH_TOKEN set to match
#     (wrangler secret put PISTON_ADMIN_TOKEN / PISTON_AUTH_TOKEN)
#
# Run this instead of the old bare `cloudflared tunnel --url ...` command.
# Leave the window open for the duration of the event; Ctrl+C stops both the
# tunnel and the proxy.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here "piston.local.json"

if (-not (Test-Path $cfgPath)) {
    Write-Error "Missing $cfgPath -- copy piston.local.example.json to piston.local.json and fill it in first."
    exit 1
}

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$proxyPort = if ($cfg.proxyPort) { $cfg.proxyPort } else { 2001 }
$workerUrl = ([string]$cfg.workerUrl).TrimEnd("/")
$adminToken = $cfg.adminToken

if (-not $adminToken -or -not $workerUrl) {
    Write-Error "piston.local.json needs both workerUrl and adminToken set."
    exit 1
}

Write-Host "Starting Piston auth-proxy on port $proxyPort (forwards to Piston on :$($cfg.pistonPort))..."
$proxyProc = Start-Process -FilePath "node" -ArgumentList @((Join-Path $here "piston-proxy.mjs")) -NoNewWindow -PassThru

try {
    while ($true) {
        Write-Host "`nStarting cloudflared tunnel -> http://localhost:$proxyPort ..."
        $lastUrl = $null
        & cloudflared tunnel --url "http://localhost:$proxyPort" 2>&1 | ForEach-Object {
            Write-Host $_
            if ($_ -match "https://[a-z0-9-]+\.trycloudflare\.com") {
                $newUrl = $Matches[0]
                if ($newUrl -ne $lastUrl) {
                    Write-Host ">> New tunnel URL: $newUrl -- updating Worker..."
                    try {
                        Invoke-RestMethod -Method Post -Uri "$workerUrl/internal/piston-url" `
                            -Headers @{ Authorization = "Bearer $adminToken" } `
                            -ContentType "application/json" `
                            -Body (@{ url = $newUrl } | ConvertTo-Json) | Out-Null
                        Write-Host ">> Worker updated."
                        $lastUrl = $newUrl
                    } catch {
                        Write-Warning ">> Failed to update Worker: $_"
                    }
                }
            }
        }
        Write-Warning "cloudflared exited -- restarting in 3s (Ctrl+C to stop everything)..."
        Start-Sleep -Seconds 3
    }
} finally {
    Write-Host "`nStopping Piston auth-proxy..."
    if ($proxyProc -and -not $proxyProc.HasExited) {
        Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
    }
}
