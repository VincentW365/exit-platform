<#
.SYNOPSIS
  Windows Firewall diagnostic and fix for Exit Platform LAN access (TCP 3010).

.DESCRIPTION
  Nothing here changes firewall configuration unless you name the action.
  Every change is recorded to a state file BEFORE it is made, and every
  change has an undo.

    -Action Inspect      read-only, works WITHOUT elevation (reads the rule
                         registry directly). Finds two kinds of rule:
                           * rules naming the port, and
                           * rules naming the PROGRAM that owns the port -
                             the "Query User" Block rules Windows creates when
                             the Security Alert popup for a new listening
                             program is cancelled, dismissed, or shown to an
                             account that cannot approve it.
                         A Block rule beats every Allow rule, so an Allow for
                         the port cannot work while a program Block exists.

    -Action Fix          ELEVATED. Removes the program Block rules for the
                         listening executable (recorded first), creates one
                         narrow Allow rule: TCP <port>, Domain profile, remote
                         scope LocalSubnet (this machine's own subnets, kept
                         current by Windows) or -TesterIp. Prints the one
                         remote test to run next.

    -Action UndoFix      ELEVATED. Recreates the removed Block rules exactly
                         and removes the Allow rule.

    -Action DiagnosticSession
                         ELEVATED, for when TCP still fails AFTER Fix. Adds a
                         TEMPORARY any-remote Allow for the port and a
                         TEMPORARY ICMPv4 echo Allow, turns on blocked-packet
                         logging, waits while you test from another machine,
                         reads the log, classifies the result (Windows
                         Firewall vs never-reached-Windows), then REVERTS
                         everything itself. Nothing broad is left behind.

    -Action Revert       ELEVATED. Removes the temporary rules and restores
                         logging, in case a session was interrupted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Inspect
  # as an administrator:
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Fix
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Fix -TesterIp 10.88.122.97
  powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action DiagnosticSession
#>
[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'Fix', 'UndoFix', 'DiagnosticSession', 'Revert')]
  [string] $Action = 'Inspect',
  [int] $Port = 3010,
  [string] $TesterIp = ''
)

$ErrorActionPreference = 'Stop'
$AllowRuleName = "Exit Platform UAT TCP $Port"
$DiagRuleName = "Exit Platform DIAG TCP $Port (TEMPORARY - any remote, Domain)"
$DiagIcmpName = "Exit Platform DIAG ICMPv4 echo (TEMPORARY - any remote, Domain)"
$StateDir = Join-Path $env:LOCALAPPDATA 'ExitPlatform'
$SessionState = Join-Path $StateDir 'lan-firewall-session.json'
$FixState = Join-Path $StateDir 'lan-firewall-fix.json'
$RulesKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Say([string] $level, [string] $text) {
  $color = switch ($level) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } 'DO' { 'Cyan' } default { 'Gray' } }
  Write-Host ("{0,-4} {1}" -f $level, $text) -ForegroundColor $color
}
function RequireAdmin {
  if (-not $isAdmin) {
    throw "'$Action' changes Windows Firewall and needs an ELEVATED PowerShell. This account is not a local administrator, so the prompt will ask for an administrator's credentials (IT)."
  }
}

# --- who owns the port, and which program is that ---------------------------
function ListenerExe {
  $l = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $l) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($l.OwningProcess)" -ErrorAction SilentlyContinue
  if ($p -and $p.ExecutablePath) { return $p.ExecutablePath }
  return $null
}

# --- rules straight from the registry: readable without elevation ----------
function ParseRule([string] $name, [string] $value) {
  $f = @{}
  foreach ($tok in ($value -split '\|')) {
    if ($tok -match '^([^=]+)=(.*)$') {
      $k = $matches[1]; $v = $matches[2]
      if ($f.ContainsKey($k)) { $f[$k] = "$($f[$k]),$v" } else { $f[$k] = $v }
    }
  }
  [pscustomobject]@{
    Name = $name
    DisplayName = if ($f['Name'] -and $f['Name'] -notmatch '^@') { $f['Name'] } else { $name }
    Action = $f['Action']; Active = ($f['Active'] -eq 'TRUE'); Dir = $f['Dir']
    Protocol = $f['Protocol']; LPort = $f['LPort']
    Profile = if ($f['Profile']) { $f['Profile'] } else { 'Any' }
    App = if ($f['App']) { [Environment]::ExpandEnvironmentVariables($f['App']) } else { '' }
    RA4 = if ($f['RA4']) { $f['RA4'] } else { 'Any' }
  }
}
function RelevantRules([string] $exe) {
  $props = (Get-ItemProperty $RulesKey -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }
  $out = @()
  foreach ($p in $props) {
    $r = ParseRule $p.Name $p.Value
    if ($r.Dir -ne 'In') { continue }
    $byPort = $r.LPort -eq "$Port"
    $byApp = $exe -and $r.App -and ($r.App.ToLower() -eq $exe.ToLower())
    if ($byPort -or $byApp) { $out += $r | Add-Member -NotePropertyName Match -NotePropertyValue $(if ($byPort) { 'port' } else { 'program' }) -PassThru }
  }
  return $out
}

function Inspect {
  Write-Host "Inbound Windows Firewall rules that decide TCP $Port" -ForegroundColor Cyan
  $profiles = Get-NetConnectionProfile | ForEach-Object { "$($_.InterfaceAlias)=$($_.NetworkCategory)" }
  Say 'INFO' "network profiles now: $($profiles -join ', ')"
  $exe = ListenerExe
  if ($exe) { Say 'INFO' "TCP $Port is owned by: $exe" } else { Say 'WARN' "nothing is listening on TCP $Port right now - program-based rules are matched against the last known path"; $exe = 'C:\Program Files\nodejs\node.exe' }
  $rules = @(RelevantRules $exe)
  $blocks = @($rules | Where-Object { $_.Active -and $_.Action -eq 'Block' })
  $allows = @($rules | Where-Object { $_.Active -and $_.Action -eq 'Allow' })
  foreach ($r in $rules) {
    $why = @()
    if ($r.Action -eq 'Block') { $why += 'EXPLICIT BLOCK - wins over every Allow' }
    if (-not $r.Active) { $why += 'disabled' }
    if ($r.Profile -ne 'Any' -and $r.Profile -notmatch 'Domain') { $why += "profile '$($r.Profile)' never applies here (this machine's networks are Domain)" }
    if ($r.RA4 -ne 'Any') { $why += "remote scope $($r.RA4)" }
    $lvl = if ($r.Action -eq 'Block' -and $r.Active) { 'FAIL' } elseif ($why.Count) { 'WARN' } else { 'PASS' }
    $what = if ($r.Match -eq 'port') { "port $Port" } else { "program $([IO.Path]::GetFileName($r.App))" }
    Say $lvl "[$what] '$($r.DisplayName)' action=$($r.Action) active=$($r.Active) profile=$($r.Profile) proto=$(if ($r.Protocol -eq '6') {'TCP'} elseif ($r.Protocol -eq '17') {'UDP'} else {$r.Protocol}) remote=$($r.RA4)$(if ($why.Count) { ' -> ' + ($why -join '; ') })"
  }
  Write-Host ""
  if ($blocks.Count -gt 0) {
    Say 'FAIL' "DIAGNOSIS: $($blocks.Count) active inbound BLOCK rule(s) cover this program. Windows creates 'Query User' Block rules when the Security Alert for a new listening program is cancelled, dismissed, or shown to an account that cannot approve it. No Allow rule can override them. This is why no other computer can connect."
    Say 'DO'   "FIX (elevated, administrator credentials): scripts/firewall-lan-diagnostic.ps1 -Action Fix"
  } elseif ($allows.Count -eq 0) {
    Say 'FAIL' "DIAGNOSIS: no inbound Allow rule admits TCP $Port and the Domain profile blocks inbound by default."
    Say 'DO'   "FIX (elevated): scripts/firewall-lan-diagnostic.ps1 -Action Fix"
  } else {
    $usable = @($allows | Where-Object { $_.Profile -eq 'Any' -or $_.Profile -match 'Domain' })
    if ($usable.Count -eq 0) { Say 'FAIL' "DIAGNOSIS: the only Allow rule(s) are on a profile this machine does not use."; Say 'DO' "FIX (elevated): -Action Fix" }
    else { Say 'PASS' "Windows Firewall admits TCP $Port on the Domain profile (scope: $(($usable | ForEach-Object RA4) -join ', ')). If a remote test still fails, run -Action DiagnosticSession (elevated) to prove whether packets reach Windows." }
  }
  if (Test-Path $SessionState) { Say 'WARN' "a diagnostic session is still open ($SessionState) - run -Action Revert" }
  if (Test-Path $FixState) { Say 'INFO' "a Fix has been applied ($FixState); -Action UndoFix restores the previous rules" }
}

function Fix {
  RequireAdmin
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $exe = ListenerExe; if (-not $exe) { $exe = 'C:\Program Files\nodejs\node.exe' }
  $rules = @(RelevantRules $exe)
  $blocks = @($rules | Where-Object { $_.Active -and $_.Action -eq 'Block' })
  # Record what will be removed BEFORE touching anything, exactly as stored,
  # so UndoFix can put it back byte for byte.
  $raw = (Get-ItemProperty $RulesKey).PSObject.Properties | Where-Object { $blocks.Name -contains $_.Name } | ForEach-Object { @{ Name = $_.Name; Value = $_.Value } }
  $state = [ordered]@{ appliedAt = (Get-Date).ToString('s'); port = $Port; exe = $exe; allowRuleName = $AllowRuleName; removedBlockRules = $raw }
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $FixState -Encoding UTF8
  foreach ($b in $blocks) {
    Get-NetFirewallRule -Name $b.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Say 'PASS' "removed Block rule '$($b.DisplayName)' ($($b.Profile), $(if ($b.Protocol -eq '6') {'TCP'} else {'UDP'})) - recorded for UndoFix"
  }
  $scope = if ($TesterIp) { $TesterIp } else { 'LocalSubnet' }
  Get-NetFirewallRule -DisplayName $AllowRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $AllowRuleName -Description "Exit Platform internal UAT. Inbound TCP $Port from $scope, Domain profile only. Remove after UAT: Remove-NetFirewallRule -DisplayName '$AllowRuleName'" `
    -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Domain -Action Allow -RemoteAddress $scope | Out-Null
  Say 'PASS' "created '$AllowRuleName': inbound TCP $Port, Domain profile, remote scope $scope$(if ($scope -eq 'LocalSubnet') { " (this machine's own connected subnets, kept current by Windows - never the internet)" })"
  Write-Host ""
  Inspect
  Write-Host ""
  $live = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up' } | Select-Object -First 1
  Say 'DO' "Now, on ANOTHER computer:  Test-NetConnection $($live.IPAddress) -Port $Port -InformationLevel Detailed"
  Say 'INFO' "Undo everything this did: -Action UndoFix"
}

function UndoFix {
  RequireAdmin
  if (-not (Test-Path $FixState)) { throw "No Fix has been recorded ($FixState); nothing to undo." }
  $state = Get-Content -LiteralPath $FixState -Raw | ConvertFrom-Json
  Get-NetFirewallRule -DisplayName $state.allowRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Say 'PASS' "removed '$($state.allowRuleName)'"
  foreach ($r in $state.removedBlockRules) {
    if (-not (Get-ItemProperty $RulesKey -Name $r.Name -ErrorAction SilentlyContinue)) {
      New-ItemProperty -Path $RulesKey -Name $r.Name -Value $r.Value -PropertyType String | Out-Null
      Say 'PASS' "restored Block rule $($r.Name)"
    }
  }
  # The firewall service re-reads the key when a rule is touched through the API; a no-op change forces it.
  Get-NetFirewallRule -Name $state.removedBlockRules[0].Name -ErrorAction SilentlyContinue | Set-NetFirewallRule -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $FixState -Force
  Inspect
}

function DiagnosticSession {
  RequireAdmin
  if (Test-Path $SessionState) { throw "A diagnostic session is already open ($SessionState). Run -Action Revert first." }
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $domain = Get-NetFirewallProfile -Name Domain
  $logFile = $domain.LogFileName -replace '%systemroot%', $env:SystemRoot
  $state = [ordered]@{ createdAt = (Get-Date).ToString('s'); port = $Port; rules = @($DiagRuleName, $DiagIcmpName)
    original = @{ LogBlocked = [string]$domain.LogBlocked; LogAllowed = [string]$domain.LogAllowed; LogFileName = $domain.LogFileName } }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SessionState -Encoding UTF8
  try {
    New-NetFirewallRule -DisplayName $DiagRuleName -Description 'TEMPORARY. Removed automatically at the end of the diagnostic session.' -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Domain -Action Allow -RemoteAddress Any | Out-Null
    New-NetFirewallRule -DisplayName $DiagIcmpName -Description 'TEMPORARY. Removed automatically at the end of the diagnostic session.' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Profile Domain -Action Allow -RemoteAddress Any | Out-Null
    Set-NetFirewallProfile -Name Domain -LogBlocked True -LogAllowed True
    $live = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up' } | Select-Object -First 1
    $mark = Get-Date
    Say 'WARN' "TEMPORARY rules active: TCP $Port from ANY (Domain) and ICMPv4 echo. Logging ON: $logFile"
    Write-Host ""
    Say 'DO' "On ANOTHER computer run:   Test-NetConnection $($live.IPAddress) -Port $Port -InformationLevel Detailed"
    Say 'DO' "then come back here and press Enter."
    [void](Read-Host)
    Start-Sleep -Seconds 2
    $lines = @()
    if (Test-Path $logFile) {
      $lines = Get-Content -LiteralPath $logFile -Tail 3000 | Where-Object { $_ -notmatch '^#' } | ForEach-Object {
        $f = $_ -split '\s+'
        if ($f.Count -ge 8) { [pscustomobject]@{ when = "$($f[0]) $($f[1])"; action = $f[2]; proto = $f[3]; src = $f[4]; dst = $f[5]; dport = $f[7]; raw = $_ } }
      } | Where-Object { ($_.dport -eq "$Port" -or $_.proto -eq 'ICMP') -and $_.src -notmatch '^(127\.|10\.88\.122\.134$|192\.168\.236\.)' -and $_.dst -notmatch '^127\.' }
    }
    Write-Host ""
    Write-Host "==== Evidence (since $($mark.ToString('HH:mm:ss'))) ====" -ForegroundColor White
    if ($lines.Count -eq 0) {
      Say 'FAIL' "NO packet from any other machine reached Windows on TCP $Port or ICMP while the any-remote rules were active."
      Say 'FAIL' "CLASSIFICATION: Case C - the packet never reached Windows Firewall. Not the application, not the Windows rule set."
      Say 'INFO' "Candidates, in order: SentinelOne Firewall Control on this host; a switch/AP/VLAN policy between the two machines; the remote machine on a different subnet with no route to $($live.IPAddress)."
    } else {
      $lines | Select-Object -First 12 | ForEach-Object { Say 'INFO' $_.raw }
      $drops = @($lines | Where-Object action -eq 'DROP'); $allows = @($lines | Where-Object action -eq 'ALLOW')
      if ($allows.Count -gt 0 -and $drops.Count -eq 0) { Say 'PASS' "CLASSIFICATION: Case A - packets reached Windows and were ALLOWED by the temporary rule. Windows Firewall configuration was the blocker; run -Action Fix for the permanent narrow rule." }
      elseif ($drops.Count -gt 0) { Say 'FAIL' "CLASSIFICATION: Case B - packets reached Windows and were DROPPED despite the temporary Allow. Another Windows rule or WFP policy wins - run -Action Inspect and look for Block rules; also 'netsh wfp show filters' (elevated) for third-party filters on port $Port." }
    }
    $report = Join-Path $StateDir "lan-diagnostic-session-$(Get-Date -Format yyyyMMdd-HHmmss).txt"
    @("Session $($mark.ToString('s')) port $Port host $($live.IPAddress)", '') + ($lines | ForEach-Object raw) | Set-Content -LiteralPath $report -Encoding UTF8
    Say 'INFO' "evidence saved: $report"
  } finally {
    Revert
  }
}

function Revert {
  RequireAdmin
  $removed = 0
  foreach ($n in @($DiagRuleName, $DiagIcmpName)) { foreach ($r in @(Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue)) { $r | Remove-NetFirewallRule; $removed++ } }
  Say 'PASS' "temporary rule(s) removed: $removed"
  if (Test-Path $SessionState) {
    $o = (Get-Content -LiteralPath $SessionState -Raw | ConvertFrom-Json).original
    Set-NetFirewallProfile -Name Domain -LogBlocked ([bool]::Parse($o.LogBlocked)) -LogAllowed ([bool]::Parse($o.LogAllowed))
    Say 'PASS' "Domain logging restored (blocked=$($o.LogBlocked), allowed=$($o.LogAllowed))"
    Remove-Item -LiteralPath $SessionState -Force
  }
  Say 'PASS' 'no temporary rule remains'
}

switch ($Action) {
  'Inspect' { Inspect }
  'Fix' { Fix }
  'UndoFix' { UndoFix }
  'DiagnosticSession' { DiagnosticSession }
  'Revert' { Revert }
}
