[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = Join-Path $projectRoot "backups"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$backupName = "tan-llm-$timestamp.db"
$containerPath = "/backups/$backupName"

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

Push-Location $projectRoot

try {
  docker compose exec -T api node apps/api/dist/database/maintenance-cli.js backup $containerPath

  if ($LASTEXITCODE -ne 0) {
    throw "Database backup failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$backup = Get-Item -LiteralPath (Join-Path $backupDirectory $backupName)
Write-Output "Backup created: $($backup.FullName) ($($backup.Length) bytes)"
