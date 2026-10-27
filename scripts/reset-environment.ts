/**
 * One-command environment reset (facilitator-only, development machines only).
 *
 *   pnpm exec tsx scripts/reset-environment.ts status
 *   pnpm exec tsx scripts/reset-environment.ts connect-live
 *   pnpm exec tsx scripts/reset-environment.ts purge-live --yes
 *   pnpm exec tsx scripts/reset-environment.ts uat --yes
 *   pnpm exec tsx scripts/reset-environment.ts fresh --yes
 *
 * Modes:
 *   status      Read-only: counts of cases, directory records, live-data
 *               presence and the current directory mode. Never changes state.
 *   connect-live Sets live mode and scheduled reconciliation and runs one
 *               read-only synchronization, touching nothing else. Run it after
 *               every synthetic rebuild (DEC-071: the directory is never left
 *               disconnected).
 *   purge-live  Removes real (live BambooHR) directory data WITHOUT touching
 *               cases: anonymizes the live cache, deletes the local alias
 *               mapping if present, lowers the live banner and returns the
 *               directory to synthetic (fixture) mode.
 *   uat         Full rebuild for UAT: drops and recreates the development
 *               database, applies migrations + least-privilege grants, seeds
 *               the synthetic baseline and the stakeholder UAT dataset
 *               (OFF-2026-0001..). Real directory data is gone afterwards by
 *               construction; run a live sync again if realistic UAT needs it.
 *   fresh       Production-readiness rebuild: same as `uat` but WITHOUT any
 *               demo cases - clean schema, dev accounts, templates, workflows
 *               and reference data only. This is the "start fresh" state.
 *
 * Flag: `--synthetic` (with `uat` or `fresh`) skips the live BambooHR
 * reconnect and leaves the fixture directory in place. Use it before running
 * the automated end-to-end suite, which searches for fixture employees by
 * first name and cannot tell them apart from real colleagues.
 *
 * Safety: refuses to run when NODE_ENV=production, when ALLOW_DEV_LOGIN is
 * not "true", or when the database host is not local. Destructive modes
 * require an explicit --yes. The append-only audit protections are never
 * weakened: history is cleared only by rebuilding the whole development
 * database as the schema owner, never by row deletion in a live schema.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const ROOT = path.resolve(import.meta.dirname, '..');
const MAPPING_PATH = path.join(ROOT, 'uat-local-real-person-mapping.json');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function fail(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function run(command: string): void {
  console.log(`> ${command}`);
  execSync(command, { cwd: ROOT, stdio: 'inherit' });
}

function guardEnvironment(): { migrateUrl: URL; devDbName: string } {
  if (process.env.NODE_ENV === 'production') fail('NODE_ENV is production.');
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    fail('ALLOW_DEV_LOGIN is not "true" - this does not look like a development environment.');
  }
  const raw = process.env.DATABASE_URL_MIGRATE;
  if (!raw) fail('DATABASE_URL_MIGRATE is not set.');
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    fail(`database host "${url.hostname}" is not local - this tool never touches shared servers.`);
  }
  const devDbName = url.pathname.replace(/^\//, '');
  if (!devDbName || devDbName === 'postgres') fail(`unexpected database name "${devDbName}".`);
  return { migrateUrl: url, devDbName };
}

async function status(): Promise<void> {
  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();
  const [cases, directory, users, live] = await Promise.all([
    prisma.offboardingCase.count(),
    prisma.employeeSourceRecord.count(),
    prisma.user.count(),
    db.liveDirectoryPresence(),
  ]);
  const mode = (await db.getSystemConfigValue('bamboohr.mode')) ?? 'fixture';
  console.log('Environment status:');
  console.log(`  cases:                  ${cases}`);
  console.log(`  directory records:      ${directory}`);
  console.log(`  user accounts:          ${users}`);
  console.log(`  directory mode:         ${mode}`);
  console.log(`  live records present:   ${live.present ? `yes (${live.records})` : 'no'}`);
  await prisma.$disconnect();
}

async function purgeLive(): Promise<void> {
  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();
  const admin = await prisma.user.findFirst({
    where: { roleAssignments: { some: { role: 'HR_MANAGER', revokedAt: null } }, isActive: true },
  });
  if (!admin) fail('no active HR_MANAGER account exists.');
  const actor = { userId: admin.id, roles: ['HR_MANAGER'] as never };
  if (existsSync(MAPPING_PATH)) {
    // Legacy alias-flow artifact (retired by DEC-043) - always cleaned up.
    unlinkSync(MAPPING_PATH);
    console.log('Legacy local alias mapping file deleted.');
  }
  const result = await db.purgeLiveDirectory(actor);
  console.log(
    `Live directory purged: ${result.anonymized} record(s) anonymized (${result.referencedKept} case-referenced kept as PURGED markers).`,
  );
  await db.setSystemConfig(
    actor,
    'bamboohr.mode',
    'fixture',
    'Environment reset: live data purge.',
  );
  console.log('Directory mode returned to fixture (synthetic). Live banner lowered.');
  await prisma.$disconnect();
}

async function rebuild(withUatDataset: boolean, migrateUrl: URL, devDbName: string): Promise<void> {
  // 1. Local alias mapping and any real data go first, so nothing real can
  //    survive the rebuild even if a later step fails.
  if (existsSync(MAPPING_PATH)) {
    unlinkSync(MAPPING_PATH);
    console.log('Local alias mapping file deleted.');
  }

  // 2. Drop and recreate the development database as the schema owner.
  // pg is a dependency of @exit/db, not the workspace root - resolve it from
  // there (pnpm keeps package dependencies isolated).
  const { createRequire } = await import('node:module');
  const requireFromDb = createRequire(path.join(ROOT, 'packages', 'db', 'package.json'));
  type PgClientCtor = new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
  const { Client } = requireFromDb('pg') as { Client: PgClientCtor };
  const maintenanceUrl = new URL(migrateUrl.href);
  maintenanceUrl.pathname = '/postgres';
  const client = new Client({ connectionString: maintenanceUrl.href });
  await client.connect();
  try {
    console.log(`Dropping and recreating database "${devDbName}"...`);
    await client.query(`DROP DATABASE IF EXISTS "${devDbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${devDbName}"`);
  } finally {
    await client.end();
  }

  // 3. Migrations, least-privilege grants, synthetic baseline seed.
  run('pnpm --filter @exit/db run migrate:deploy');
  const grantsSql = readFileSync(path.join(ROOT, 'scripts', 'db', 'grants.sql'), 'utf8');
  const dbClient = new Client({ connectionString: migrateUrl.href });
  await dbClient.connect();
  try {
    console.log('Applying least-privilege grants...');
    await dbClient.query(grantsSql);
  } finally {
    await dbClient.end();
  }
  run('pnpm db:seed');

  // 4. Optional stakeholder UAT dataset.
  if (withUatDataset) {
    run('pnpm exec tsx scripts/uat-stakeholder-seed.ts');
    console.log('');
    console.log('UAT dataset restored. For the completed-case artifacts (scenarios 7/9),');
    console.log('run the documented prep step against a running dev server:');
    console.log('  pnpm exec playwright test e2e/uat-scenarios.spec.ts -g "UAT-1"');
  } else {
    console.log('');
    console.log('Fresh baseline ready: accounts, templates, workflows and reference data');
    console.log('only - zero cases. This is the production-readiness starting state.');
  }

  // 5. Owner request (2026-08-16): the app should always carry the real
  //    organization data. When the read-only BambooHR credential is
  //    configured locally, a rebuild reconnects live mode, runs the initial
  //    sync and leaves the scheduled sync on (worker refreshes it on the
  //    configured interval). Without a credential this is skipped and the
  //    synthetic fixture directory applies.
  //    `--synthetic` opts out: the automated end-to-end suite searches for
  //    fixture employees by first name, and 374 real colleagues would shadow
  //    them, so verification runs rebuild without the live connection.
  const synthetic = process.argv.includes('--synthetic');
  if (synthetic) {
    console.log('');
    console.log('--synthetic: the live directory was NOT reconnected (fixture employees only).');
    // The app should always HAVE a directory, live or synthetic: manager
    // routing and the departure notice both read it. Without this sync the
    // cache holds only employees a case happened to touch.
    try {
      const db = await import('../packages/db/src/index.ts');
      const admin = await db.getPrisma().user.findFirst({
        where: {
          roleAssignments: { some: { role: 'HR_MANAGER', revokedAt: null } },
          isActive: true,
        },
      });
      if (admin) {
        const actor = { userId: admin.id, roles: ['HR_MANAGER'] as never };
        // DEC-071: a configured credential now means "live" by default, so a
        // synthetic rebuild must say "fixture" out loud. Reconnect afterwards
        // with `connect-live` - the owner never wants the directory left off.
        await db.setSystemConfig(
          actor,
          'bamboohr.mode',
          'fixture',
          'Synthetic rebuild for automated tests: fixture directory until connect-live runs.',
        );
        const sync = await db.syncEmployees(actor);
        console.log(
          `Synthetic directory loaded: ${sync.created} created, ${sync.updated} updated.`,
        );
        console.log('Reconnect the live directory afterwards: reset-environment.ts connect-live');
      }
    } catch (e) {
      console.log(
        `WARNING: synthetic directory sync failed (${e instanceof Error ? e.message : 'unknown'}).`,
      );
    }
  } else if (
    (process.env.BAMBOOHR_API_KEY || process.env.BAMBOOHR_API_KEY_REF) &&
    process.env.BAMBOOHR_SUBDOMAIN
  ) {
    console.log('');
    console.log('Reconnecting the live BambooHR directory...');
    try {
      const db = await import('../packages/db/src/index.ts');
      const admin = await db.getPrisma().user.findFirst({
        where: {
          roleAssignments: { some: { role: 'HR_MANAGER', revokedAt: null } },
          isActive: true,
        },
      });
      if (!admin) throw new Error('no active HR_MANAGER account exists after seeding');
      const actor = { userId: admin.id, roles: ['HR_MANAGER'] as never };
      const reason = 'Environment rebuild: the live directory stays connected (owner request).';
      await db.setSystemConfig(actor, 'bamboohr.mode', 'live', reason);
      await db.setSystemConfig(actor, 'bamboohr.scheduledSync', true, reason);
      const sync = await db.syncEmployees(actor);
      console.log(
        `Live directory connected: ${sync.created} created, ${sync.updated} updated ` +
          '(read-only; case snapshots are never written).',
      );
    } catch (e) {
      console.log(
        `WARNING: live directory reconnect failed (${e instanceof Error ? e.message : 'unknown'}).`,
      );
      console.log('Live mode + scheduled sync remain configured; the worker retries, or run a');
      console.log('sync manually from Administration > System.');
    }
  } else {
    console.log('');
    console.log('No BambooHR credential in .env.local - synthetic fixture directory applies.');
  }

  console.log('');
  console.log('NOTE: restart the dev server and worker so they reconnect cleanly.');
}

/**
 * DEC-071: connect the live BambooHR directory WITHOUT touching cases or the
 * schema - the step that follows every synthetic rebuild, and the one to run
 * whenever the owner finds the directory disconnected. Read-only mirror;
 * prints counts, never a name.
 */
async function connectLive(): Promise<void> {
  if (
    !(process.env.BAMBOOHR_API_KEY || process.env.BAMBOOHR_API_KEY_REF) ||
    !process.env.BAMBOOHR_SUBDOMAIN
  ) {
    fail('no BambooHR credential in the root env file - nothing to connect to.');
  }
  const db = await import('../packages/db/src/index.ts');
  const admin = await db.getPrisma().user.findFirst({
    where: {
      roleAssignments: { some: { role: 'HR_MANAGER', revokedAt: null } },
      isActive: true,
    },
  });
  if (!admin) fail('no active HR_MANAGER account exists - seed the environment first.');
  const actor = { userId: admin.id, roles: ['HR_MANAGER'] as never };
  const reason = 'connect-live: the live directory is always connected (owner decision, DEC-071).';
  await db.setSystemConfig(actor, 'bamboohr.mode', 'live', reason);
  await db.setSystemConfig(actor, 'bamboohr.scheduledSync', true, reason);
  const sync = await db.syncEmployees(actor);
  const live = await db.liveDirectoryPresence();
  console.log(
    `Live directory connected: ${sync.created} created, ${sync.updated} updated; ` +
      `${live.records} live record(s) present (read-only; case snapshots are never written).`,
  );
  console.log('Scheduled reconciliation is on; the worker keeps the mirror current.');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const confirmed = process.argv.includes('--yes');
  const guard = guardEnvironment();

  if (mode === 'status') return status();
  if (mode === 'connect-live') return connectLive();
  if (mode === 'purge-live') {
    if (!confirmed) fail('purge-live changes data - re-run with --yes.');
    return purgeLive();
  }
  if (mode === 'uat' || mode === 'fresh') {
    if (!confirmed) fail(`${mode} DESTROYS the local development database - re-run with --yes.`);
    return rebuild(mode === 'uat', guard.migrateUrl, guard.devDbName);
  }
  console.log(
    'Usage: pnpm exec tsx scripts/reset-environment.ts status|connect-live|purge-live|uat|fresh [--yes] [--synthetic]',
  );
  process.exitCode = mode ? 1 : 0;
}

void main();
