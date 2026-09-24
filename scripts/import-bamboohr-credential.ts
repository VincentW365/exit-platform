/**
 * Borrow the BambooHR directory credential from another project on this
 * machine (DEC-071, owner request 2026-09-23).
 *
 * The credential is never committed to this repository. On a machine that
 * already runs another BambooHR-connected application - the HR onboarding app,
 * for instance - this finds that project's env file, copies the key and the
 * company subdomain into THIS project's gitignored `.env.local`, and then
 * connects the live directory (skip with --no-connect). Values are never printed,
 * logged or echoed: the output names files and variables only.
 *
 *   pnpm setup:bamboohr                       search sibling projects, then connect
 *   pnpm setup:bamboohr -- --from <path>      use this project folder or env file
 *   pnpm setup:bamboohr -- --replace          overwrite a credential already here
 *
 * Options: --from <dir|file>, --replace, --no-connect, --target <file>
 * (--target exists for tests; it defaults to this repository's .env.local).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Names other projects commonly use, most specific first. */
const KEY_NAMES = [
  'BAMBOOHR_API_KEY',
  'BAMBOO_HR_API_KEY',
  'BAMBOO_API_KEY',
  'BAMBOOHR_KEY',
  'BAMBOOHR_TOKEN',
  'BAMBOO_TOKEN',
];
const SUBDOMAIN_NAMES = [
  'BAMBOOHR_SUBDOMAIN',
  'BAMBOO_HR_SUBDOMAIN',
  'BAMBOO_SUBDOMAIN',
  'BAMBOOHR_COMPANY_DOMAIN',
  'BAMBOO_COMPANY_DOMAIN',
  'BAMBOOHR_COMPANY',
  'BAMBOOHR_DOMAIN',
  'BAMBOO_DOMAIN',
];
const ENV_FILE_NAMES = [
  '.env.local',
  '.env',
  '.env.production.local',
  '.env.production',
  '.env.development.local',
  '.env.development',
];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo']);

function fail(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** KEY=value pairs of a dotenv file; quotes stripped, comments ignored. */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out.set(m[1]!.toUpperCase(), value.trim());
  }
  return out;
}

/**
 * The company subdomain, however the other project wrote it: `acme`,
 * `acme.bamboohr.com`, `https://acme.bamboohr.com/...` or the API gateway URL
 * `https://api.bamboohr.com/api/gateway.php/acme/...`.
 */
export function normaliseSubdomain(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const gateway = /gateway\.php\/([a-z0-9][a-z0-9-]*)/i.exec(v);
  if (gateway) return gateway[1]!.toLowerCase();
  const host = v.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]!;
  const sub = host.toLowerCase().endsWith('.bamboohr.com') ? host.split('.')[0]! : host;
  return /^[a-z0-9][a-z0-9-]*$/i.test(sub) ? sub.toLowerCase() : null;
}

interface Found {
  file: string;
  keyName: string;
  subdomainName: string;
  key: string;
  subdomain: string;
}

function readCredential(file: string): Found | null {
  let vars: Map<string, string>;
  try {
    vars = parseEnv(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const keyName = KEY_NAMES.find((n) => (vars.get(n) ?? '').length >= 20);
  const subdomainName = SUBDOMAIN_NAMES.find((n) => normaliseSubdomain(vars.get(n) ?? ''));
  if (!keyName || !subdomainName) return null;
  return {
    file,
    keyName,
    subdomainName,
    key: vars.get(keyName)!,
    subdomain: normaliseSubdomain(vars.get(subdomainName)!)!,
  };
}

/** Env files in a project folder and its immediate sub-folders (monorepo apps). */
function envFilesUnder(dir: string, depth = 2): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of ENV_FILE_NAMES) {
    if (entries.includes(name)) files.push(path.join(dir, name));
  }
  if (depth > 0) {
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const child = path.join(dir, name);
      try {
        if (statSync(child).isDirectory()) files.push(...envFilesUnder(child, depth - 1));
      } catch {
        // unreadable folder - skip
      }
    }
  }
  return files;
}

function discover(from: string | undefined): Found[] {
  if (from) {
    const p = path.resolve(from);
    if (!existsSync(p)) fail(`${p} does not exist.`);
    const files = statSync(p).isDirectory() ? envFilesUnder(p) : [p];
    return files.map(readCredential).filter((f): f is Found => f !== null);
  }
  // Sibling projects: the folders next to this repository, a level deeper for
  // the usual "project/app" layout. This repository itself is skipped.
  const parent = path.dirname(ROOT);
  const found: Found[] = [];
  for (const name of readdirSync(parent)) {
    const dir = path.join(parent, name);
    if (dir === ROOT || SKIP_DIRS.has(name)) continue;
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of envFilesUnder(dir)) {
      const f = readCredential(file);
      if (f) found.push(f);
    }
  }
  return found;
}

/** Set KEY=value lines in a dotenv file, replacing existing ones in place. */
function upsertEnv(file: string, values: Record<string, string>): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && pending.has(m[1]!)) {
      const v = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === '') next.pop();
  if (pending.size) {
    next.push(
      '',
      '# BambooHR read-only directory credential (imported by setup:bamboohr, DEC-071)',
    );
    for (const [k, v] of pending) next.push(`${k}=${v}`);
  }
  writeFileSync(file, `${next.join('\n')}\n`, { encoding: 'utf8' });
}

function main(): void {
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENVIRONMENT === 'production') {
    fail('production reads the credential from its secret manager, never from a copied file.');
  }
  const target = path.resolve(arg('--target') ?? path.join(ROOT, '.env.local'));
  const replace = process.argv.includes('--replace');
  const connect = !process.argv.includes('--no-connect');

  const existing = existsSync(target) ? readCredential(target) : null;
  if (existing && !replace) {
    console.log(`A BambooHR credential is already configured in ${target}; leaving it as it is.`);
    console.log('Use --replace to take the other project’s credential instead.');
  } else {
    const found = discover(arg('--from'));
    const distinct = new Map(found.map((f) => [`${f.subdomain}\u0000${f.key}`, f]));
    if (distinct.size === 0) {
      fail(
        'no BambooHR credential found in the projects next to this one. Pass the onboarding ' +
          'project with --from <folder>, or put BAMBOOHR_API_KEY and BAMBOOHR_SUBDOMAIN in ' +
          '.env.local by hand.',
      );
    }
    if (distinct.size > 1) {
      console.error('More than one different BambooHR credential was found:');
      for (const f of distinct.values()) console.error(`  ${f.file}`);
      fail('choose one with --from <folder or file>.');
    }
    const chosen = [...distinct.values()][0]!;
    upsertEnv(target, { BAMBOOHR_API_KEY: chosen.key, BAMBOOHR_SUBDOMAIN: chosen.subdomain });
    console.log(`Imported the BambooHR credential from ${chosen.file}`);
    console.log(
      `  ${chosen.keyName} -> BAMBOOHR_API_KEY, ${chosen.subdomainName} -> BAMBOOHR_SUBDOMAIN`,
    );
    console.log(`  written to ${target} (gitignored; the value is not shown).`);
  }

  if (!connect || arg('--target')) return;
  console.log('');
  console.log('Connecting the live directory (read-only)...');
  execSync('pnpm exec tsx scripts/reset-environment.ts connect-live', {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

main();
