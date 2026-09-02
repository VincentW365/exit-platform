<#
.SYNOPSIS
  Windows Firewall diagnostic for Exit Platform LAN access (TCP 3010).

.DESCRIPTION
  Nothing here changes firewall configuration unless you name the action
  explicitly. Every change is recorded to a state file first, and Revert
  puts everything back exactly as it was.

    -Action Inspect            read-only: every inbound rule touching the port,
                               with the mistakes that make a rule useless
                               flagged (Private-only on a Domain machine,
                               stale tester address, explicit Block, disabled).
    -Action EnableDiagnostics  TEMPORARY: one clearly named Allow rule for the
                               port, Domain profile, ANY remote address, plus
                               blocked-packet logging. For a diagnosis window
                               only. Prints the revert command.
    -Action Revert             remove the temporary rule, restore logging to
                               what it was, delete the state file.
    -Action CreateScopedRule   the permanent, narrow rule: Domain profile,
                               one tester address (-TesterIp).

  Elevation is required for every action except Inspect (which reports what
  it cannot read without it).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Inspect
  # elevated:
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action EnableDiagnostics
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Revert
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action CreateScopedRule -TesterIp 192.168.236.42
#>
[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'EnableDiagnostics', 'Revert', 'CreateScopedRule')]
  [string] $Action = 'Inspect',
  [int] $Port = 3010,
  [string] $TesterIp = ''
)

$ErrorActionPreference = 'Stop'
$DiagRuleName = "Exit Platform DIAG TCP $Port (TEMPORARY - any remote, Domain)"
$ScopedRuleName = "Exit Platform UAT TCP $Port"
$StateDir = Join-Path $env:LOCALAPPDATA 'ExitPlatform'
$StateFile = Join-Path $StateDir 'lan-firewall-state.json'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Say([string] $level, [string] $text) {
  $color = switch ($level) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } default { 'Gray' } }
  Write-Host ("{0,-4} {1}" -f $level, $text) -ForegroundColor $color
}
function RequireAdmin { if (-not $isAdmin) { throw "'$Action' changes firewall configuration and needs an ELEVATED PowerShell (Run as administrator)." } }

function Inspect {
  Write-Host "Inbound rules touching TCP $Port" -ForegroundColor Cyan
  $profiles = Get-NetConnectionProfile | ForEach-Object { "$($_.InterfaceAlias)=$($_.NetworkCategory)" }
  Say 'INFO' "network profiles: $($profiles -join ', ')"
  try {
    $filters = Get-NetFirewallPortFilter | Where-Object { $_.Protocol -eq 'TCP' -and $_.LocalPort -eq "$Port" }
    $rules = @($filters | Get-NetFirewallRule | Where-Object Direction -eq 'Inbound')
  } catch {
    if (-not $isAdmin) { Say 'WARN' "rule contents cannot be read without elevation - re-run this action as administrator"; return }
    throw
  }
  if ($rules.Count -eq 0) { Say 'FAIL' "no inbound rule names TCP $Port. Windows blocks other workstations by default. Use -Action CreateScopedRule -TesterIp <address>."; return }
  foreach ($r in $rules) {
    $remote = ($r | Get-NetFirewallAddressFilter).RemoteAddress -join ','
    $iface = ($r | Get-NetFirewallInterfaceTypeFilter).InterfaceType
    $problems = @()
    if ($r.Action -eq 'Block') { $problems += 'EXPLICIT BLOCK - wins over any Allow' }
    if ($r.Enabled -ne 'True') { $problems += 'disabled' }
    if ($r.Profile -ne 'Any' -and $r.Profile -notmatch 'Domain') { $problems += "profile '$($r.Profile)' never applies here (this machine's networks are Domain)" }
    if ($remote -ne 'Any') { $problems += "remote scope '$remote' - verify it is the tester's CURRENT address (ipconfig on their machine); a changed DHCP lease makes it stale" }
    if ($iface -ne 'Any') { $problems += "interface type '$iface' only" }
    if ($r.DisplayName -eq $DiagRuleName) { $problems += 'TEMPORARY diagnostic rule - remove with -Action Revert when done' }
    $level = if ($problems -match 'BLOCK|never applies|disabled') { 'FAIL' } elseif ($problems.Count) { 'WARN' } else { 'PASS' }
    Say $level "'$($r.DisplayName)' action=$($r.Action) enabled=$($r.Enabled) profile=$($r.Profile) remote=$remote$(if ($problems.Count) { ' -> ' + ($problems -join '; ') })"
  }
  $log = Get-NetFirewallProfile -Name Domain
  Say 'INFO' "Domain profile blocked-packet logging: $($log.LogBlocked) ($($log.LogFileName))"
  if (Test-Path $StateFile) { Say 'WARN' "a diagnostic session is still open (state file $StateFile) - run -Action Revert when the test is finished" }
}

function EnableDiagnostics {
  RequireAdmin
  if (Test-Path $StateFile) { throw "A diagnostic session is already open ($StateFile). Run -Action Revert first." }
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $domain = Get-NetFirewallProfile -Name Domain
  $state = [ordered]@{
    createdAt = (Get-Date).ToString('s'); port = $Port; ruleName = $DiagRuleName
    original = @{ LogBlocked = [string]$domain.LogBlocked; LogFileName = $domain.LogFileName; LogMaxSizeKilobytes = $domain.LogMaxSizeKilobytes }
  }
  # Record BEFORE changing anything, so a crash between steps still leaves a revert path.
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile -Encoding UTF8
  New-NetFirewallRule -DisplayName $DiagRuleName -Description 'TEMPORARY diagnostic rule. Remove with scripts/firewall-lan-diagnostic.ps1 -Action Revert.' `
    -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Domain -Action Allow -RemoteAddress Any | Out-Null
  Set-NetFirewallProfile -Name Domain -LogBlocked True
  Say 'WARN' "TEMPORARY rule created: '$DiagRuleName' (Domain profile, ANY remote address)."
  Say 'WARN' "Blocked-packet logging ON for the Domain profile: $($domain.LogFileName)"
  Say 'INFO' "Original settings recorded in $StateFile"
  Say 'INFO' "Now run Test-ExitPlatformLAN.ps1 on the tester workstation, then:"
  Say 'INFO' "  Get-Content `"$($domain.LogFileName -replace '%systemroot%', $env:SystemRoot)`" -Tail 300 | Select-String ' $Port '"
  Say 'INFO' "A DROP line naming the tester's address = Windows Firewall. NO line while the tester still fails = the packet never reached Windows (network, VLAN, isolation, or SentinelOne)."
  Say 'FAIL' "DO NOT LEAVE THIS RULE IN PLACE. Finish with: -Action Revert"
}

function Revert {
  RequireAdmin
  $removed = 0
  foreach ($r in @(Get-NetFirewallRule -DisplayName $DiagRuleName -ErrorAction SilentlyContinue)) { $r | Remove-NetFirewallRule; $removed++ }
  Say 'PASS' "temporary rule(s) removed: $removed"
  if (Test-Path $StateFile) {
    $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    $orig = $state.original
    Set-NetFirewallProfile -Name Domain -LogBlocked ([bool]::Parse($orig.LogBlocked -replace 'True','true' -replace 'False','false'))
    Say 'PASS' "Domain blocked-packet logging restored to $($orig.LogBlocked)"
    Remove-Item -LiteralPath $StateFile -Force
    Say 'PASS' "state file removed"
  } else { Say 'INFO' 'no state file - logging left as-is' }
  Inspect
}

function CreateScopedRule {
  RequireAdmin
  if (-not $TesterIp -or $TesterIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "-TesterIp <the tester's current IPv4 address> is required (from ipconfig on their machine)." }
  $existing = Get-NetFirewallRule -DisplayName $ScopedRuleName -ErrorAction SilentlyContinue
  if ($existing) { $existing | Remove-NetFirewallRule; Say 'INFO' "replaced previous '$ScopedRuleName'" }
  New-NetFirewallRule -DisplayName $ScopedRuleName -Description "Exit Platform internal UAT. Tester $TesterIp only. Remove after the session." `
    -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Domain -Action Allow -RemoteAddress $TesterIp | Out-Null
  Say 'PASS' "'$ScopedRuleName': TCP $Port, Domain profile, remote $TesterIp only"
  Say 'INFO' "Remove after UAT: Remove-NetFirewallRule -DisplayName '$ScopedRuleName'"
  Inspect
}

switch ($Action) {
  'Inspect' { Inspect }
  'EnableDiagnostics' { EnableDiagnostics }
  'Revert' { Revert }
  'CreateScopedRule' { CreateScopedRule }
}
