[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [string]$LanHostIp,

  [Parameter(Mandatory)]
  [string]$HomeSubnet,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$allowRuleName = "TanLlm-Household-Allow"
$blockRuleName = "TanLlm-Public-Block"

function ConvertTo-Ipv4Address([string]$Value) {
  [System.Net.IPAddress]$address = $null

  if (
    ![System.Net.IPAddress]::TryParse($Value, [ref]$address) -or
    $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork
  ) {
    throw "Invalid IPv4 address: $Value"
  }

  return $address
}

function Test-PrivateIpv4([System.Net.IPAddress]$Address) {
  $bytes = $Address.GetAddressBytes()

  return (
    $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
  )
}

function Test-AddressInSubnet(
  [System.Net.IPAddress]$Address,
  [System.Net.IPAddress]$Network,
  [int]$PrefixLength
) {
  $addressBytes = $Address.GetAddressBytes()
  $networkBytes = $Network.GetAddressBytes()
  $fullBytes = [Math]::Floor($PrefixLength / 8)
  $remainingBits = $PrefixLength % 8

  for ($index = 0; $index -lt $fullBytes; $index++) {
    if ($addressBytes[$index] -ne $networkBytes[$index]) {
      return $false
    }
  }

  if ($remainingBits -eq 0) {
    return $true
  }

  $mask = (0xff -shl (8 - $remainingBits)) -band 0xff
  return (
    ($addressBytes[$fullBytes] -band $mask) -eq
    ($networkBytes[$fullBytes] -band $mask)
  )
}

$lanAddress = ConvertTo-Ipv4Address $LanHostIp
$subnetParts = $HomeSubnet.Split("/")

if ($subnetParts.Count -ne 2) {
  throw "HomeSubnet must use IPv4 CIDR notation, for example 192.168.1.0/24."
}

$networkAddress = ConvertTo-Ipv4Address $subnetParts[0]
$prefixLength = 0

if (
  ![int]::TryParse($subnetParts[1], [ref]$prefixLength) -or
  $prefixLength -lt 8 -or
  $prefixLength -gt 32
) {
  throw "HomeSubnet must have a prefix length from 8 through 32."
}

if (!(Test-PrivateIpv4 $lanAddress) -or !(Test-PrivateIpv4 $networkAddress)) {
  throw "The LAN address and subnet must use private IPv4 address space."
}

if (!(Test-AddressInSubnet $lanAddress $networkAddress $prefixLength)) {
  throw "$LanHostIp is not inside $HomeSubnet."
}

$interfaceAddress = Get-NetIPAddress `
  -AddressFamily IPv4 `
  -IPAddress $LanHostIp `
  -ErrorAction Stop |
  Where-Object AddressState -eq "Preferred" |
  Select-Object -First 1

if (!$interfaceAddress) {
  throw "$LanHostIp is not assigned to an active Windows network adapter."
}

$networkProfile = Get-NetConnectionProfile `
  -InterfaceIndex $interfaceAddress.InterfaceIndex `
  -ErrorAction Stop |
  Select-Object -First 1

if (!$networkProfile -or $networkProfile.NetworkCategory -ne "Private") {
  throw "The selected network adapter must use the Windows Private profile."
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$administrator = [System.Security.Principal.WindowsBuiltInRole]::Administrator

if (!$principal.IsInRole($administrator)) {
  throw "Run this script from PowerShell as Administrator."
}

if (
  !$PSCmdlet.ShouldProcess(
    "$($interfaceAddress.InterfaceAlias) $LanHostIp`:$Port",
    "Replace the Tan LLM household firewall rules"
  )
) {
  return
}

Get-NetFirewallRule `
  -Name @($allowRuleName, $blockRuleName) `
  -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

New-NetFirewallRule `
  -Name $allowRuleName `
  -DisplayName "Tan LLM - Allow household LAN" `
  -Group "Tan LLM" `
  -Description "Allows the Tan LLM web entry point from the trusted home subnet." `
  -Enabled True `
  -Profile Private `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalAddress $LanHostIp `
  -LocalPort $Port `
  -RemoteAddress $HomeSubnet `
  -InterfaceAlias $interfaceAddress.InterfaceAlias `
  -EdgeTraversalPolicy Block | Out-Null

New-NetFirewallRule `
  -Name $blockRuleName `
  -DisplayName "Tan LLM - Block public networks" `
  -Group "Tan LLM" `
  -Description "Blocks the Tan LLM web port when the adapter uses the Public profile." `
  -Enabled True `
  -Profile Public `
  -Direction Inbound `
  -Action Block `
  -Protocol TCP `
  -LocalAddress $LanHostIp `
  -LocalPort $Port `
  -RemoteAddress Any `
  -InterfaceAlias $interfaceAddress.InterfaceAlias `
  -EdgeTraversalPolicy Block | Out-Null

Get-NetFirewallRule -Name @($allowRuleName, $blockRuleName) |
  Select-Object Name, DisplayName, Enabled, Profile, Direction, Action
