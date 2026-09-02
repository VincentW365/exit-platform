<#
.SYNOPSIS
  Host-side LAN access diagnostic for the Exit Platform (internal UAT).

.DESCRIPTION
  Collects everything on THIS workstation that decides whether another
  workstation can reach the app, and reports it as PASS / WARN / FAIL lines
  rather than raw command output. Read-only: it changes nothing.

  Run unelevated for everything except firewall RULE contents; those need an
  elevated shell and are reported as WARN with the exact script to run.

  Never prints secrets: from .env it reads only WEB_HOST, WEB_PORT and
  APP_BASE_URL.

.EXAMPLE
  pwsh -File scripts/diagnose-lan-access.ps1
  powershell -ExecutionPolicy Bypass -File scripts/diagnose-lan-access.ps1
#>
[CmdletBinding()]
param(
  [int] $Port = 0,
  [string] $EnvFile = ''
)

$ErrorActionPreference = 'Continue'
# $PSScriptRoot is empty inside param() defaults under Windows PowerShell 5.1
# when the script is started with -File, so the default is resolved here.
if (-not $EnvFile) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $EnvFile = Join-Path (Split-Path -Parent $scriptDir) '.env'
}
$script:Results = New-Object System.Collections.Generic.List[object]
function Report([string] $Level, [string] $Check, [string] $Detail) {
  $script:Results.Add([pscustomobject]@{ Level = $Level; Check = $Check; Detail = $Detail })
}
function Section([string] $Title) { Write-Host ""; Write-Host "--- $Title" -ForegroundColor Cyan }

# --- configuration (only the three non-secret keys) --------------------------
Section "Configuration"
$cfg = @{ WEB_HOST = '0.0.0.0'; WEB_PORT = '3000'; APP_BASE_URL = 'http://localhost:3000' }
if (Test-Path -LiteralPath $EnvFile) {
  foreach ($line in [System.IO.File]::ReadAllLines($EnvFile)) {
    if ($line -match '^\s*(WEB_HOST|WEB_PORT|APP_BASE_URL)\s*=\s*(.*?)\s*$') { $cfg[$matches[1]] = $matches[2] }
  }
  Report 'PASS' 'Configuration file' ".env read (only WEB_HOST, WEB_PORT, APP_BASE_URL are used; nothing else is printed)"
} else {
  Report 'WARN' 'Configuration file' "no .env at $EnvFile - using defaults"
}
if ($Port -eq 0) { $Port = [int]$cfg.WEB_PORT }
$isLoopbackHost = $cfg.WEB_HOST -match '^(127\.|localhost$|::1$|\[::1\]$)'
if ($isLoopbackHost) {
  Report 'FAIL' 'WEB_HOST' "$($cfg.WEB_HOST) - LAN ACCESS DISABLED: the server is bound to loopback only"
} else {
  Report 'PASS' 'WEB_HOST' "$($cfg.WEB_HOST) - accepts non-loopback connections"
}
Report 'PASS' 'WEB_PORT' "$Port"
$baseHost = ''
try { $baseHost = ([uri]$cfg.APP_BASE_URL).Host } catch { $baseHost = $cfg.APP_BASE_URL }
if ($baseHost -match '^(localhost|127\.)') {
  Report 'WARN' 'APP_BASE_URL' "$($cfg.APP_BASE_URL) - resolves to localhost; links in captured email will dead-end on another workstation"
} else {
  Report 'PASS' 'APP_BASE_URL' "$($cfg.APP_BASE_URL)"
}

# --- listener ----------------------------------------------------------------
Section "Listener on TCP $Port"
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
  Report 'FAIL' 'Listener' "nothing is listening on TCP $Port - start the app (pnpm dev)"
} else {
  foreach ($l in $listeners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($l.OwningProcess)" -ErrorAction SilentlyContinue
    $exe = if ($proc) { $proc.Name } else { 'unknown' }
    $isExit = $proc -and $proc.CommandLine -match 'Exit Platform'
    $lvl = if ($l.LocalAddress -in '0.0.0.0', '::') { 'PASS' } elseif ($l.LocalAddress -match '^127\.|^::1$') { 'FAIL' } else { 'WARN' }
    $note = if ($l.LocalAddress -eq '0.0.0.0') { 'all IPv4 interfaces' } elseif ($l.LocalAddress -eq '::') { 'all IPv6 interfaces' } elseif ($lvl -eq 'FAIL') { 'LOOPBACK ONLY - not reachable from other workstations' } else { 'one specific address only' }
    $owner = if ($isExit) { 'this Exit Platform checkout' } else { 'NOT this project - another application holds the port' }
    Report $lvl 'Bind address' "$($l.LocalAddress):$($l.LocalPort) ($note) PID=$($l.OwningProcess) $exe - $owner"
  }
}

# --- interfaces, addresses, gateways, metrics --------------------------------
Section "Network interfaces"
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue
$ipIfaces = Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue
$liveAddresses = @()
foreach ($a in (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' })) {
  $ad = $adapters | Where-Object ifIndex -eq $a.InterfaceIndex
  $ii = $ipIfaces | Where-Object ifIndex -eq $a.InterfaceIndex
  $gw = (Get-NetRoute -InterfaceIndex $a.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
  $status = if ($ad) { $ad.Status } else { 'unknown' }
  $metric = if ($ii) { $ii.InterfaceMetric } else { '?' }
  $desc = "$($a.InterfaceAlias) $($a.IPAddress)/$($a.PrefixLength) gw=$gw ifMetric=$metric adapter=$status addressState=$($a.AddressState)"
  if ($status -eq 'Up' -and $a.AddressState -eq 'Preferred') {
    Report 'PASS' 'Reachable address' "$desc -> http://$($a.IPAddress):$Port"
    $liveAddresses += $a.IPAddress
  } else {
    Report 'FAIL' 'Dead address' "$desc - adapter not connected or address deprecated: NOBODY can reach this URL; do not give it to a tester"
  }
}
if ($liveAddresses.Count -eq 0) { Report 'FAIL' 'Reachable address' 'no connected interface with a preferred IPv4 address - the host is not on any network' }

# --- routing -----------------------------------------------------------------
Section "Routing"
$defaults = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
foreach ($r in $defaults) {
  $ii = $ipIfaces | Where-Object ifIndex -eq $r.ifIndex
  $ad = $adapters | Where-Object ifIndex -eq $r.ifIndex
  $eff = $r.RouteMetric + $(if ($ii) { $ii.InterfaceMetric } else { 0 })
  $state = if ($ad) { $ad.Status } else { '?' }
  Report 'PASS' 'Default route' "via $($r.NextHop) on $($r.InterfaceAlias) effectiveMetric=$eff adapter=$state"
}
$liveDefaults = @($defaults | Where-Object { ($adapters | Where-Object ifIndex -eq $_.ifIndex).Status -eq 'Up' })
if ($defaults.Count -gt 1 -and $liveDefaults.Count -gt 1) {
  Report 'WARN' 'Multiple default gateways' "$($liveDefaults.Count) connected interfaces each have a default route; outbound traffic to OTHER subnets leaves via the lowest effective metric. Replies to a directly connected subnet always use that subnet's interface (strong host model), so this is not an asymmetry for same-subnet testers."
} elseif ($defaults.Count -gt 1) {
  Report 'PASS' 'Multiple default gateways' "$($defaults.Count) default routes exist but only $($liveDefaults.Count) is on a connected adapter - the other is a stale lease, harmless but misleading"
} else {
  Report 'PASS' 'Default gateways' 'exactly one'
}
$weak = $ipIfaces | Where-Object { $_.WeakHostSend -eq 'Enabled' -or $_.WeakHostReceive -eq 'Enabled' }
if ($weak) { Report 'WARN' 'Host model' "weak-host enabled on $(($weak | ForEach-Object InterfaceAlias) -join ', ') - replies may leave via the wrong NIC" } else { Report 'PASS' 'Host model' 'strong host (replies leave via the interface that owns the address)' }
foreach ($ip in $liveAddresses) {
  # The directly connected subnet is the address's own prefix - computed from
  # the mask rather than looked up, so multicast/broadcast routes on the same
  # interface can never be mistaken for it.
  $addr = Get-NetIPAddress -IPAddress $ip -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($addr) {
    $prefix = [int]$addr.PrefixLength
    # Byte-wise, because Windows PowerShell 5.1 promotes 32-bit bitwise math
    # to signed integers and quietly produces 0.0.0.0.
    $ipBytes = [System.Net.IPAddress]::Parse($ip).GetAddressBytes()
    $netBytes = New-Object byte[] 4
    for ($i = 0; $i -lt 4; $i++) {
      $bits = [Math]::Max(0, [Math]::Min(8, $prefix - ($i * 8)))
      $maskByte = if ($bits -eq 0) { 0 } else { (0xFF -shl (8 - $bits)) -band 0xFF }
      $netBytes[$i] = [byte]($ipBytes[$i] -band $maskByte)
    }
    $network = ([System.Net.IPAddress]::new($netBytes)).ToString()
    $hosts = if ($prefix -ge 31) { 'point-to-point' } else { "$([math]::Pow(2, 32 - $prefix) - 2) usable addresses" }
    Report 'PASS' 'Connected subnet' "$ip is on $network/$prefix ($hosts) - testers with an address in that range need no router; anyone else must be routed through the gateway"
  }
}

# --- network profile ---------------------------------------------------------
Section "Windows network profile"
foreach ($p in (Get-NetConnectionProfile -ErrorAction SilentlyContinue)) {
  $ad = $adapters | Where-Object ifIndex -eq $p.InterfaceIndex
  $state = if ($ad) { $ad.Status } else { '?' }
  $lvl = if ($p.NetworkCategory -eq 'Public') { 'WARN' } else { 'PASS' }
  Report $lvl 'Profile' "$($p.InterfaceAlias) = $($p.NetworkCategory) (adapter $state) - a firewall rule must include this profile"
}

# --- Windows Firewall ---------------------------------------------------------
Section "Windows Firewall"
foreach ($fp in (Get-NetFirewallProfile -ErrorAction SilentlyContinue)) {
  $inbound = if ($fp.DefaultInboundAction -eq 'NotConfigured') { 'Block (default)' } else { $fp.DefaultInboundAction }
  Report 'PASS' 'Firewall profile' "$($fp.Name): enabled=$($fp.Enabled) defaultInbound=$inbound blockedPacketLogging=$($fp.LogBlocked)"
}
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$ruleErr = $null
try {
  $portFilters = Get-NetFirewallPortFilter -ErrorAction Stop | Where-Object { $_.Protocol -eq 'TCP' -and ($_.LocalPort -eq "$Port" -or $_.LocalPort -eq 'Any') }
  $rules = @($portFilters | Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.Direction -eq 'Inbound' })
  $specific = @($rules | Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -eq "$Port" })
  if ($specific.Count -eq 0) {
    Report 'FAIL' 'Firewall rule' "no inbound rule names TCP $Port - Windows blocks other workstations by default. Run scripts/firewall-lan-diagnostic.ps1 elevated."
  }
  foreach ($r in $specific) {
    $addr = ($r | Get-NetFirewallAddressFilter).RemoteAddress -join ','
    $ifc = ($r | Get-NetFirewallInterfaceTypeFilter).InterfaceType
    $lvl = 'PASS'; $why = @()
    if ($r.Action -eq 'Block') { $lvl = 'FAIL'; $why += 'explicit BLOCK' }
    if ($r.Enabled -ne 'True') { $lvl = 'WARN'; $why += 'disabled' }
    if ($r.Profile -ne 'Any' -and $r.Profile -notmatch 'Domain') { $lvl = 'FAIL'; $why += "profile '$($r.Profile)' excludes Domain, which both NICs use" }
    if ($addr -ne 'Any') { $why += "remote scope $addr - must be the tester's CURRENT address" }
    if ($ifc -ne 'Any') { $why += "interface type restricted to $ifc" }
    $flags = if ($why.Count) { ' [' + ($why -join '; ') + ']' } else { '' }
    Report $lvl 'Firewall rule' "'$($r.DisplayName)' action=$($r.Action) enabled=$($r.Enabled) profile=$($r.Profile) remote=$addr$flags"
  }
} catch { $ruleErr = $_.Exception.Message }
if ($ruleErr) {
  if ($isAdmin) { Report 'WARN' 'Firewall rule' "could not read rules: $ruleErr" }
  else { Report 'WARN' 'Firewall rule' "rule contents need an ELEVATED shell. Run: scripts/firewall-lan-diagnostic.ps1 -Action Inspect (as administrator)" }
}

# --- local HTTP health checks --------------------------------------------------
Section "Local HTTP checks (from this host - NOT a second-machine test)"
$targets = @('127.0.0.1') + $liveAddresses
foreach ($t in $targets) {
  try {
    $r = Invoke-WebRequest -Uri "http://${t}:$Port/api/health/lan" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
    $body = $r.Content | ConvertFrom-Json
    Report 'PASS' 'HTTP health' "http://${t}:$Port/api/health/lan -> $($r.StatusCode) app=$($body.app) env=$($body.environment) commit=$($body.commit)"
  } catch {
    try {
      $r2 = Invoke-WebRequest -Uri "http://${t}:$Port/signin" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
      Report 'WARN' 'HTTP health' "http://${t}:$Port/signin -> $($r2.StatusCode) but /api/health/lan failed (older build?)"
    } catch { Report 'FAIL' 'HTTP health' "http://${t}:$Port -> $($_.Exception.Message.Split([Environment]::NewLine)[0])" }
  }
}
Report 'WARN' 'Second-workstation test' 'not performed here - a request from this host to its own address proves nothing about the LAN. Run docs/operations/Test-ExitPlatformLAN.ps1 on the tester workstation.'

# --- endpoint security (read-only) ------------------------------------------
Section "Endpoint security (read-only)"
$s1 = Get-Service -ErrorAction SilentlyContinue | Where-Object Name -match 'Sentinel'
if ($s1) {
  foreach ($s in $s1) { Report 'WARN' 'SentinelOne' "$($s.Name) status=$($s.Status) - can enforce its own Firewall Control policy independently of Windows Firewall; if the tester's TCP test fails while a Windows Any-remote rule exists and no DROP is logged, this is the likely blocker" }
} else { Report 'PASS' 'SentinelOne' 'not installed' }
foreach ($fw in (Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue)) { Report 'WARN' 'Third-party firewall' $fw.displayName }

# --- report --------------------------------------------------------------------
Write-Host ""
Write-Host "==================== LAN ACCESS DIAGNOSTIC ====================" -ForegroundColor White
foreach ($r in $script:Results) {
  $color = switch ($r.Level) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } }
  Write-Host ("{0,-4} {1,-24} {2}" -f $r.Level, $r.Check, $r.Detail) -ForegroundColor $color
}
$fails = @($script:Results | Where-Object Level -eq 'FAIL').Count
$warns = @($script:Results | Where-Object Level -eq 'WARN').Count
Write-Host ""
Write-Host "Give testers ONLY these URLs: $(($liveAddresses | ForEach-Object { "http://${_}:$Port" }) -join '  ')" -ForegroundColor White
Write-Host "Result: $fails FAIL, $warns WARN" -ForegroundColor $(if ($fails) { 'Red' } elseif ($warns) { 'Yellow' } else { 'Green' })
exit $(if ($fails) { 1 } else { 0 })
