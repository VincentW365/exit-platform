/**
 * Start the web app for local development, on the address configuration
 * says - and SAY where it can be reached (owner directive, 2026-09-02).
 *
 *   pnpm dev            listen per WEB_HOST / WEB_PORT (default 0.0.0.0:3000)
 *   pnpm dev:local      loopback only, whatever .env says
 *
 * Why a launcher rather than `next dev` directly: the port and host have to
 * come from the repository .env so that restarting never needs a code change,
 * but `next dev` reads its port at CLI-parse time, before next.config.ts
 * loads that file. So this loads the .env first, then hands Next the exact
 * host and port, and prints the LAN address a tester on another workstation
 * should use - read from the live interfaces each start, because a DHCP
 * lease can change between days and a stale address in a document is worse
 * than none.
 *
 * Node reports every address a machine HOLDS, including one left on a
 * disconnected Wi-Fi radio by an old DHCP lease - which the host itself can
 * still reach, and nobody else can. On Windows the banner therefore asks the
 * OS which adapters are actually connected and marks the rest as dead, so a
 * dead address is never handed to a tester. That was the LAN failure of
 * 2026-09-02, and it is the reason this file asks the OS instead of trusting
 * the address list.
 *
 * Nothing here touches authentication, sessions or the database. The
 * database stays loopback-only by its own configuration; other workstations
 * reach data only through this application.
 */
import { execFileSync, spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { getConfig, isLoopbackHost, loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const loopbackOnly = process.argv.includes('--local');
const config = getConfig(); // fail-closed guards run before anything listens
const host = loopbackOnly ? '127.0.0.1' : config.WEB_HOST;
const port = config.WEB_PORT;
const exposed = !isLoopbackHost(host);

interface Nic {
  iface: string;
  address: string;
  /** null when the OS could not be asked (non-Windows). */
  connected: boolean | null;
  profile: string | null;
}

/**
 * What Windows knows that Node does not: whether each adapter is actually
 * connected, whether the address is still valid, and which firewall profile
 * the network is on. One short PowerShell call; anything that goes wrong
 * degrades to "unknown" rather than to a guess.
 */
function windowsAdapterFacts(): Map<
  string,
  { connected: boolean; preferred: boolean; profile: string | null }
> {
  const out = new Map<string, { connected: boolean; preferred: boolean; profile: string | null }>();
  if (process.platform !== 'win32') return out;
  const script = [
    '$a = Get-NetAdapter | Select-Object ifIndex, Status, Name;',
    '$p = Get-NetConnectionProfile | Select-Object InterfaceIndex, NetworkCategory;',
    'Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object {',
    '  $ad = $a | Where-Object ifIndex -eq $_.InterfaceIndex;',
    '  $pr = $p | Where-Object InterfaceIndex -eq $_.InterfaceIndex;',
    '  "$($_.IPAddress)|$($ad.Status)|$($_.AddressState)|$($pr.NetworkCategory)"',
    '}',
  ].join(' ');
  try {
    const text = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      },
    );
    for (const line of text.split(/\r?\n/)) {
      const [ip, status, state, profile] = line.trim().split('|');
      if (!ip) continue;
      out.set(ip, {
        connected: status === 'Up',
        preferred: state === 'Preferred',
        profile: profile && profile !== '' ? profile : null,
      });
    }
  } catch {
    // Fall through: the banner will say the OS could not be asked.
  }
  return out;
}

interface FirewallVerdict {
  level: 'ok' | 'warn' | 'fail' | 'unknown';
  text: string;
}

/**
 * Whether Windows Firewall will let another computer reach this port - read
 * from the rule registry, which a standard user can read.
 *
 * Two kinds of rule decide it: rules naming the PORT, and rules naming the
 * PROGRAM that owns the port. The second kind is how Windows records a
 * cancelled or dismissed "Windows Security Alert" for a new listening
 * program - as an explicit inbound Block for that executable - and a Block
 * beats every Allow. That rule is invisible to a port-only check, and it
 * was the reason no other computer could connect on 2026-09-08. The banner
 * therefore says so at startup rather than leaving it to be discovered.
 */
function windowsFirewallVerdict(exe: string, port: number): FirewallVerdict {
  if (process.platform !== 'win32')
    return { level: 'unknown', text: 'Windows Firewall: not applicable on this OS' };
  const script = [
    "$k='HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules';",
    "(Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Value }",
  ].join(' ');
  let text: string;
  try {
    text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return {
      level: 'unknown',
      text: 'Windows Firewall: rules could not be read - run scripts/diagnose-lan-access.ps1',
    };
  }
  const exeLower = exe.toLowerCase();
  const blocks: string[] = [];
  const allows: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.includes('Dir=In')) continue;
    const f = new Map<string, string>();
    for (const tok of raw.split('|')) {
      const eq = tok.indexOf('=');
      if (eq < 0) continue;
      const k = tok.slice(0, eq);
      const v = tok.slice(eq + 1);
      f.set(k, f.has(k) ? `${f.get(k)},${v}` : v);
    }
    if (f.get('Active') !== 'TRUE') continue;
    const app = (f.get('App') ?? '')
      .replace(/%SystemRoot%/i, process.env.SystemRoot ?? '')
      .toLowerCase();
    const byPort = f.get('LPort') === String(port);
    const byApp = app !== '' && app === exeLower;
    if (!byPort && !byApp) continue;
    const profile = f.get('Profile') ?? 'Any';
    const proto =
      f.get('Protocol') === '6'
        ? 'TCP'
        : f.get('Protocol') === '17'
          ? 'UDP'
          : (f.get('Protocol') ?? '?');
    const name = f.get('Name')?.startsWith('@') ? '(system rule)' : (f.get('Name') ?? '(unnamed)');
    if (f.get('Action') === 'Block') blocks.push(`'${name}' ${proto} ${profile}`);
    else if (
      f.get('Action') === 'Allow' &&
      proto === 'TCP' &&
      (profile === 'Any' || profile.includes('Domain'))
    )
      allows.push(`'${name}' scope ${f.get('RA4') ?? 'Any'}`);
  }
  const exeName = path.basename(exe);
  if (blocks.length > 0) {
    return {
      level: 'fail',
      text:
        `Windows Firewall BLOCKS ${exeName} inbound: ${blocks.join('; ')} - a Block beats every Allow.\n` +
        '     This is a dismissed "Windows Security Alert". Fix (administrator): scripts/firewall-lan-diagnostic.ps1 -Action Fix',
    };
  }
  if (allows.length === 0) {
    return {
      level: 'warn',
      text: `No Windows Firewall Allow for TCP ${port} on the Domain profile - other computers are blocked by default. Fix (administrator): scripts/firewall-lan-diagnostic.ps1 -Action Fix`,
    };
  }
  return {
    level: 'ok',
    text: `Windows Firewall admits TCP ${port} on Domain via ${allows.join(', ')}`,
  };
}

/** Every non-loopback IPv4 address this machine holds, with the OS's view of it. */
function lanAddresses(): Nic[] {
  const facts = windowsAdapterFacts();
  const nics: Nic[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Link-local means "no address was assigned"; nobody can dial it.
      if (a.address.startsWith('169.254.')) continue;
      const f = facts.get(a.address);
      nics.push({
        iface: name,
        address: a.address,
        connected: f ? f.connected && f.preferred : null,
        profile: f?.profile ?? null,
      });
    }
  }
  return nics;
}

const line = (s = '') => console.log(s);
const pad = (label: string) => `  ${label.padEnd(17)}`;
line();
line('EXIT PLATFORM - INTERNAL UAT');
line();
line(`${pad('Listening:')}${host}:${port}`);
line(`${pad('This machine:')}http://localhost:${port}`);

const nics = exposed ? lanAddresses() : [];
const live = nics.filter((n) => n.connected !== false);
const dead = nics.filter((n) => n.connected === false);
if (exposed) {
  for (const n of live) {
    const unsure = n.connected === null ? '  (adapter state unknown on this OS)' : '';
    line(`${pad(`${n.iface} URL:`)}http://${n.address}:${port}${unsure}`);
  }
  for (const n of dead) {
    line(
      `${pad(`${n.iface}:`)}${n.address} is on a DISCONNECTED adapter - not reachable by anyone; do not give it out`,
    );
  }
  if (nics.length === 0) line(`${pad('LAN:')}no network address assigned right now`);
}
line(`${pad('APP_BASE_URL:')}${config.APP_BASE_URL}`);
const profiles = [...new Set(live.map((n) => n.profile).filter((p): p is string => !!p))];
line(`${pad('Network profile:')}${profiles.length ? profiles.join(', ') : 'unknown'}`);
line();

// --- readiness -------------------------------------------------------------
line('LAN readiness:');
if (!exposed) {
  line('  x  LAN ACCESS DISABLED - server is bound to loopback only.');
  line(`     Set WEB_HOST=0.0.0.0 in .env (or drop --local) to accept other workstations.`);
} else {
  line('  ok Server accepts non-loopback connections');
  line(`  ok Port ${port} will be listening (see "Ready" below)`);
  if (live.length === 0) {
    line(
      '  x  No connected network adapter holds a usable address - nobody can reach this machine',
    );
  } else if (live.some((n) => n.connected === null)) {
    line(
      '  !  Adapter state could not be read from the OS - confirm the URL above is on a connected adapter',
    );
  }
  if (dead.length > 0) {
    line(
      `  !  ${dead.length} address(es) above are dead (disconnected adapter) - use only the URL line(s)`,
    );
  }
  if (profiles.some((p) => p === 'Public')) {
    line(
      '  !  A network is on the Public profile - Windows Firewall rules for Private/Domain will not apply there',
    );
  }
  // The firewall verdict comes from the rule registry, which needs no
  // elevation - so the one thing that actually stopped every other computer
  // is a startup line, not a discovery.
  const fw = windowsFirewallVerdict(process.execPath, port);
  const mark = fw.level === 'ok' ? 'ok' : fw.level === 'fail' ? 'x ' : '! ';
  line(`  ${mark} ${fw.text}`);
  line(
    '  !  Second-workstation validation not yet completed: run docs/operations/Test-ExitPlatformLAN.ps1 on the tester PC',
  );
  if (config.appBaseUrlIsLoopback) {
    line(
      `  !  APP_BASE_URL is ${config.APP_BASE_URL} - links in captured email will dead-end on another workstation`,
    );
  } else {
    const baseHost = (() => {
      try {
        return new URL(config.APP_BASE_URL).hostname;
      } catch {
        return '';
      }
    })();
    if (baseHost && !live.some((n) => n.address === baseHost)) {
      line(
        `  !  APP_BASE_URL host ${baseHost} is not one of this machine's connected addresses - emailed links may dead-end`,
      );
    }
  }
  if (config.devLoginEnabled) {
    line(
      '  !  Development role switcher is ON and reachable from the network: no password. Scope the firewall',
    );
    line("     rule to the tester's address and stop the server when the session ends.");
  }
}
line();

// Run Next's CLI entry with THIS node, not the .bin shim: on Windows the
// shim is a .cmd that needs a shell, and a shell splits the repository path
// on the space in "Exit Platform". Node + the JS entry needs neither.
const webDir = path.resolve(import.meta.dirname, '../apps/web');
const nextCli = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(
  process.execPath,
  [nextCli, 'dev', '--hostname', host, '--port', String(port)],
  {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, HOSTNAME: host, PORT: String(port) },
  },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
