<#
.SYNOPSIS
  Exit Platform - LAN reachability test for the HR tester's workstation.

.DESCRIPTION
  Copy this file to the tester's computer and run it. It needs nothing but
  Windows PowerShell (already on every Windows PC). It works out which of the
  host's addresses is on your own network, tests whether the Exit Platform
  can be reached, and writes a small report you can send back.

  It changes nothing on your computer and sends nothing anywhere except to
  the Exit Platform host on the company network.

.EXAMPLE
  Right-click the file -> "Run with PowerShell"
  or:  powershell -ExecutionPolicy Bypass -File .\Test-ExitPlatformLAN.ps1
#>
[CmdletBinding()]
param(
  # The host's known addresses. The script prefers whichever is on your
  # own subnet. Add or replace addresses if the host changes.
  [string[]] $HostAddresses = @('192.168.236.10', '10.88.122.134'),
  [int] $Port = 3010,
  [string] $ReportDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = [ordered]@{
  ranAt = (Get-Date).ToString('s'); computer = $env:COMPUTERNAME; port = $Port
  tester = @{}; candidates = @(); verdict = ''; layer = ''; evidence = @()
}
function Note([string] $s) { $report.evidence += $s; Write-Host "  $s" }

Write-Host ""
Write-Host "Exit Platform - LAN reachability test" -ForegroundColor White
Write-Host "-------------------------------------"

# --- 1. where am I? ------------------------------------------------------------
$cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
if (-not $cfg) { $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Address } | Select-Object -First 1 }
if (-not $cfg) {
  $report.verdict = 'FAIL - this computer has no active network connection'
  $report.layer = 'Layer 3/4 - tester workstation is not on a network'
  Write-Host $report.verdict -ForegroundColor Red
} else {
  $myIp = $cfg.IPv4Address.IPAddress
  $myPrefix = [int]$cfg.IPv4Address.PrefixLength
  $myGw = if ($cfg.IPv4DefaultGateway) { $cfg.IPv4DefaultGateway.NextHop } else { '' }
  $report.tester = @{ interface = $cfg.InterfaceAlias; ip = $myIp; prefix = $myPrefix; gateway = $myGw }
  Note "You are on $($cfg.InterfaceAlias): $myIp/$myPrefix, gateway $myGw"

  # --- 2. which host address is on MY subnet? -----------------------------
  # Byte-wise comparison: Windows PowerShell 5.1 promotes 32-bit bitwise
  # maths to signed integers and gets subnet checks silently wrong.
  function SameSubnet([string] $a, [string] $b, [int] $prefix) {
    $ba = [System.Net.IPAddress]::Parse($a).GetAddressBytes()
    $bb = [System.Net.IPAddress]::Parse($b).GetAddressBytes()
    for ($i = 0; $i -lt 4; $i++) {
      $bits = [Math]::Max(0, [Math]::Min(8, $prefix - ($i * 8)))
      $m = if ($bits -eq 0) { 0 } else { (0xFF -shl (8 - $bits)) -band 0xFF }
      if (($ba[$i] -band $m) -ne ($bb[$i] -band $m)) { return $false }
    }
    return $true
  }
  $ordered = @()
  foreach ($h in $HostAddresses) {
    $ordered += [pscustomobject]@{ address = $h; sameSubnet = (SameSubnet $myIp $h $myPrefix) }
  }
  $ordered = $ordered | Sort-Object { -not $_.sameSubnet }   # same-subnet first
  $direct = @($ordered | Where-Object sameSubnet)
  if ($direct.Count) { Note "Host address on YOUR subnet: $($direct[0].address) (no router needed)" }
  else { Note "No host address is on your subnet; traffic must go through your gateway $myGw" }

  # --- 3. test each candidate: TCP, then HTTP, then the app itself ----------
  $winner = $null
  foreach ($c in $ordered) {
    $entry = [ordered]@{ address = $c.address; sameSubnet = $c.sameSubnet; tcp = $false; http = $null; health = $null; error = '' }
    Write-Host ""
    Write-Host "Testing http://$($c.address):$Port ..." -ForegroundColor Cyan
    # TCP with a real timeout (Test-NetConnection can hang for a long time).
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $async = $client.BeginConnect($c.address, $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(5000) -and $client.Connected) { $entry.tcp = $true }
      $client.Close()
    } catch { $entry.error = $_.Exception.Message.Split([Environment]::NewLine)[0] }
    Note "TCP $($c.address):$Port -> $(if ($entry.tcp) { 'CONNECTED' } else { 'no connection' }) $($entry.error)"
    if ($entry.tcp) {
      try {
        $r = Invoke-WebRequest -Uri "http://$($c.address):$Port/signin" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $entry.http = [int]$r.StatusCode
        Note "HTTP /signin -> $($entry.http)"
      } catch { $entry.http = -1; $entry.error = $_.Exception.Message.Split([Environment]::NewLine)[0]; Note "HTTP /signin -> FAILED: $($entry.error)" }
      try {
        $h = Invoke-WebRequest -Uri "http://$($c.address):$Port/api/health/lan" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $j = $h.Content | ConvertFrom-Json
        $entry.health = @{ status = $j.status; app = $j.app; environment = $j.environment; commit = $j.commit; serverTime = $j.serverTime }
        Note "App health -> $($j.app) $($j.status) env=$($j.environment) commit=$($j.commit)"
      } catch { Note "App health endpoint -> not available ($($_.Exception.Message.Split([Environment]::NewLine)[0]))" }
      if (-not $winner -and $entry.http -eq 200) { $winner = $c.address }
    }
    $report.candidates += $entry
  }

  # --- 4. verdict + layer ------------------------------------------------------
  $anyTcp = @($report.candidates | Where-Object tcp).Count -gt 0
  if ($winner) {
    $report.verdict = "PASS - Exit Platform reachable at http://${winner}:$Port"
    $report.layer = 'none - open that address in your browser and sign in'
  } elseif ($anyTcp) {
    $report.verdict = 'FAIL - the computer connects, but the application did not answer correctly'
    $report.layer = 'Layer 6 - HTTP/application on the host (send this report to the host owner)'
  } else {
    $report.verdict = 'FAIL - TCP connection never reached the application'
    $report.layer = if ($direct.Count) { 'Layer 2/5 - same subnet, so the host itself refused it: Windows Firewall rule scope or endpoint security on the host' } else { 'Layer 3/4 - different subnet: routing, VLAN, Wi-Fi client isolation, or the host firewall' }
    # routing evidence, only when it matters
    foreach ($c in $ordered) {
      $tr = & tracert.exe -d -h 5 -w 800 $c.address 2>&1 | Select-Object -Skip 1 | Select-Object -First 7
      Note "tracert $($c.address): " + (($tr | ForEach-Object { $_.ToString().Trim() }) -join ' | ')
    }
    $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.NextHop) via $($_.InterfaceAlias)" }
    Note "Your default gateways: $($routes -join '; ')"
  }
}

# --- 5. print + save -------------------------------------------------------------
Write-Host ""
$color = if ($report.verdict -like 'PASS*') { 'Green' } else { 'Red' }
Write-Host $report.verdict -ForegroundColor $color
Write-Host "Where it stopped: $($report.layer)"
$json = Join-Path $ReportDir "ExitPlatformLAN-$stamp.json"
$txt = Join-Path $ReportDir "ExitPlatformLAN-$stamp.txt"
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $json -Encoding UTF8
@($report.verdict, "Layer: $($report.layer)", "Computer: $($report.computer) at $($report.ranAt)", '') + $report.evidence | Set-Content -LiteralPath $txt -Encoding UTF8
Write-Host ""
Write-Host "Report saved - please send BOTH files to the host owner:" -ForegroundColor White
Write-Host "  $json"
Write-Host "  $txt"
Write-Host ""
Write-Host "Press Enter to close."; [void](Read-Host)
