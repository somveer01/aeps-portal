# Opens an SSH tunnel to the production Postgres so a DB tool (DBeaver ...) can connect to localhost:55432.
# Keep this window open while you work; close it (or press Ctrl+C) to close the tunnel.
#   powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1
# Reads DEPLOY_HOST / DEPLOY_KEY / DEPLOY_USER from .deploy.env (git-ignored). Needs your current IP allowed for SSH
# in the AWS security group. The db container's internal address is looked up each time (it can change).
param([int]$LocalPort = 55432)

$root = Split-Path $PSScriptRoot -Parent
$cfg = @{ DEPLOY_USER = 'ubuntu' }
Get-Content (Join-Path $root '.deploy.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"') }
}
$target = "$($cfg.DEPLOY_USER)@$($cfg.DEPLOY_HOST)"
$sshArgs = @('-i', $cfg.DEPLOY_KEY, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30')

# The command travels base64-encoded so no quoting layer (PowerShell -> ssh -> bash -> sg) can mangle it.
$remote = "sg docker -c ""docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' fintech-db-1"" < /dev/null"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
$ip = (ssh @sshArgs $target "echo $b64 | base64 -d | bash" 2>$null | Select-Object -First 1)
if (-not $ip -or $ip -notmatch '^\d+\.\d+\.\d+\.\d+$') { Write-Host "Could not read the db container address (is your IP allowed for SSH in the security group?)" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Tunnel open: localhost:$LocalPort -> ${ip}:5432 (via $($cfg.DEPLOY_HOST))" -ForegroundColor Green
Write-Host "DBeaver: Host localhost | Port $LocalPort | Database fintech_aeps | User aeps | SSH tab OFF"
Write-Host "Password: ssh -i `"$($cfg.DEPLOY_KEY)`" $target `"grep ^PGPASSWORD= ~/fintech/.env`""
Write-Host "Keep this window open. Ctrl+C closes the tunnel."
ssh @sshArgs -N -L "${LocalPort}:${ip}:5432" -o ExitOnForwardFailure=yes $target
