# Starts Mosquitto with the project config file.
# Run from the repo root: .\broker\start.ps1

$mosquitto = "C:\Program Files\mosquitto\mosquitto.exe"
$conf = Join-Path $PSScriptRoot "mosquitto.conf"

if (-not (Test-Path $mosquitto)) {
    Write-Error "Mosquitto not found at $mosquitto. See MOSQUITTO_SETUP.md for install instructions."
    exit 1
}

Write-Host "Starting Mosquitto broker on port 1883..."
& $mosquitto -c $conf -v
