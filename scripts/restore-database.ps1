[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory)]
  [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "backups")
)
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$resolvedParent = [System.IO.Path]::GetDirectoryName($resolvedBackup)

if (
  ![string]::Equals(
    $resolvedParent,
    $backupDirectory,
    [System.StringComparison]::OrdinalIgnoreCase
  )
) {
  throw "The backup must be a file directly inside $backupDirectory."
}

if (!$PSCmdlet.ShouldProcess("/data/tan-llm.db", "Restore $resolvedBackup")) {
  return
}

$backupName = [System.IO.Path]::GetFileName($resolvedBackup)
$containerPath = "/backups/$backupName"
$restartServices = $false

Push-Location $projectRoot

try {
  & (Join-Path $PSScriptRoot "backup-database.ps1")
  $restartServices = $true
  docker compose stop web api

  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the web and API services."
  }

  docker compose run --rm --no-deps api node apps/api/dist/database/maintenance-cli.js restore $containerPath

  if ($LASTEXITCODE -ne 0) {
    throw "Database restore failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($restartServices) {
    docker compose up -d api web

    if ($LASTEXITCODE -ne 0) {
      Write-Error "The database operation finished, but the application did not restart successfully."
    }
  }

  Pop-Location
}
