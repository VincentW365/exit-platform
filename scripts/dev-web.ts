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
 * Nothing here touches authentication, sessions or the database. The
 * database stays loopback-only by its own configuration; other workstations
 * reach data only through this application.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { getConfig, isLoopbackHost, loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const loopbackOnly = process.argv.includes('--local');
const config = getConfig(); // fail-closed guards run before anything listens
const host = loopbackOnly ? '127.0.0.1' : config.WEB_HOST;
const port = config.WEB_PORT;
const exposed = !isLoopbackHost(host);

/** Every non-loopback IPv4 address this machine currently holds. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Link-local means "no address was assigned"; nobody can dial it.
      if (a.address.startsWith('169.254.')) continue;
      out.push(`${a.address}  (${name})`);
    }
  }
  return out;
}

const line = (s = '') => console.log(s);
line();
line('Employee Offboarding Platform - web');
line(`  Listening on   http://${host}:${port}`);
line(`  This machine   http://localhost:${port}`);
if (exposed) {
  const lan = lanAddresses();
  if (lan.length === 0) {
    line('  LAN            no network address assigned right now');
  } else {
    for (const a of lan) {
      const [ip, iface] = a.split('  ');
      line(`  LAN            http://${ip}:${port}  ${iface}`);
    }
  }
  line();
  line('  Other workstations on the same network can open the LAN address above');
  line('  once Windows Firewall allows inbound TCP on this port for the Private/');
  line('  Domain profile. See docs/operations/LanAccessForInternalUAT.md.');
  line('  The addresses above are allowed through the dev-origin guard automatically.');
  if (config.devLoginEnabled) {
    line();
    line('  WARNING: the development role switcher is ON and reachable from the');
    line('  network. Anyone who can open this address can sign in as any role');
    line("  without a password. Scope the firewall rule to the tester's address");
    line('  and stop the server when the session ends.');
  }
  if (config.appBaseUrlIsLoopback) {
    line();
    line(`  WARNING: APP_BASE_URL is ${config.APP_BASE_URL}. Links in captured email`);
    line('  (checklist, acknowledgement) point at "localhost", which on another');
    line('  workstation is THAT machine. For LAN testing set APP_BASE_URL to the');
    line('  LAN address above and restart.');
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
