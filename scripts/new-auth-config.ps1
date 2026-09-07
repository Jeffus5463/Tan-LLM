[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$passwordModule = Join-Path $projectRoot "apps\api\dist\auth\password.js"

if (!(Test-Path -LiteralPath $passwordModule)) {
  throw "Build the API before generating credentials: npm.cmd run build --workspace @tan-llm/api"
}

$password = Read-Host "Choose the shared household password" -AsSecureString

try {
  $env:TAN_LLM_SETUP_PASSWORD = [System.Net.NetworkCredential]::new(
    "",
    $password
  ).Password

  node (Join-Path $PSScriptRoot "new-auth-config.mjs")

  if ($LASTEXITCODE -ne 0) {
    throw "Credential generation failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item Env:TAN_LLM_SETUP_PASSWORD -ErrorAction SilentlyContinue
  $password.Dispose()
}
