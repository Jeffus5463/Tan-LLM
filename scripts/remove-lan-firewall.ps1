[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$administrator = [System.Security.Principal.WindowsBuiltInRole]::Administrator

if (!$principal.IsInRole($administrator)) {
  throw "Run this script from PowerShell as Administrator."
}

$rules = @(
  Get-NetFirewallRule `
    -Name @("TanLlm-Household-Allow", "TanLlm-Public-Block") `
    -ErrorAction SilentlyContinue
)

if ($rules.Count -eq 0) {
  Write-Output "No Tan LLM firewall rules were found."
  return
}

if ($PSCmdlet.ShouldProcess("Tan LLM", "Remove household firewall rules")) {
  $rules | Remove-NetFirewallRule
  Write-Output "Tan LLM firewall rules removed."
}
