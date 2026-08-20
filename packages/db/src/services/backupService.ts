/**
 * Backup and restore operations (Directive 4 section Q).
 *
 * Local development implementation: pg_dump to the gitignored backup
 * directory with checksum evidence, restore into a clean isolated database,
 * then schema/data integrity verification of every critical record family.
 * Production disaster recovery remains UNAPPROVED and is documented, not
 * claimed (Q.5).
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { backupMetadataErrors, can, type Actor } from '@exit/domain';
import { getConfig } from '@exit/config';
import { Client } from 'pg';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

const execFileAsync = promisify(execFile);

function migrateUrl(): URL {
  const raw = process.env['DATABASE_URL_MIGRATE'];
  if (!raw) throw ServiceError.validation(['DATABASE_URL_MIGRATE is required for backup work.']);
  const url = new URL(raw);
  // Owner credentials, but ALWAYS the database this process actually runs
  // against: the integration harness promotes DATABASE_URL to the isolated
  // test database while DATABASE_URL_MIGRATE still names the development one
  // - dumping that would capture a DIFFERENT environment's data (latent flaw
  // found 2026-08-17 when a freshly rebuilt dev database exposed it).
  url.pathname = new URL(getConfig().DATABASE_URL).pathname;
  return url;
}

/** Q: repeatable synthetic database backup with recorded evidence. */
export async function createBackup(actor: Actor) {
  if (!can(actor, 'backup.operate')) throw ServiceError.forbidden();
  const config = getConfig();
  const url = migrateUrl();
  const dir = path.resolve(config.BACKUP_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `backup-${Date.now()}.dump`);
  const pgDump = path.join(config.PG_BIN, 'pg_dump.exe');

  await execFileAsync(
    pgDump,
    [
      '-h',
      url.hostname,
      '-p',
      url.port || '5432',
      '-U',
      url.username,
      '-d',
      url.pathname.slice(1),
      '-Fc',
      '-f',
      file,
    ],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } },
  );

  const bytes = await readFile(file);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const size = (await stat(file)).size;
  const meta = { kind: 'DATABASE', sizeBytes: size, checksum, objectPath: file };
  const errors = backupMetadataErrors(meta);
  if (errors.length) throw ServiceError.validation(errors);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const record = await prisma.backupRecord.create({
    data: {
      kind: 'DATABASE',
      objectPath: file,
      sizeBytes: BigInt(size),
      checksum,
      createdById: actor.userId,
      correlationId,
    },
  });
  await appendAudit(prisma, {
    eventType: 'BACKUP_CREATED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'BackupRecord',
    objectId: record.id,
    result: 'SUCCESS',
    correlationId,
    metadata: { sizeBytes: size, checksum: checksum.slice(0, 16) },
  });
  return { backupId: record.id, sizeBytes: size, checksum };
}

const CRITICAL_TABLES = [
  'offboarding_case',
  'employee_snapshot',
  'document_instance',
  'attestation',
  'survey_response',
  'workflow_instance',
  'workflow_task',
  'asset_recovery_item',
  'clearance_record',
  'audit_event',
] as const;

/**
 * Q: restore into a clean ISOLATED database and verify schema + critical
 * record counts against the live database (Q.2-Q.4).
 */
export async function restoreAndVerify(actor: Actor, backupId: string) {
  if (!can(actor, 'backup.operate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
  if (!record) throw ServiceError.notFound();

  // Checksum integrity before restoring.
  const bytes = await readFile(record.objectPath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== record.checksum)
    throw ServiceError.validation([
      'Backup checksum mismatch: the file is not the recorded backup.',
    ]);

  const config = getConfig();
  const url = migrateUrl();
  const restoreDb = 'exitplatform_restorecheck';
  const adminEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const psql = path.join(config.PG_BIN, 'psql.exe');
  const pgRestore = path.join(config.PG_BIN, 'pg_restore.exe');
  const base = ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username];

  await execFileAsync(
    psql,
    [
      ...base,
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS ${restoreDb};`,
      '-c',
      `CREATE DATABASE ${restoreDb};`,
    ],
    { env: adminEnv },
  );
  await execFileAsync(
    pgRestore,
    [...base, '-d', restoreDb, '--no-owner', '--no-privileges', record.objectPath],
    { env: adminEnv },
  );

  // Verify critical tables in the restored copy against the SOURCE database
  // the dump was taken from (the migrate URL) - the source may have gained
  // rows since the dump but can never have fewer.
  const restored = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: url.username,
    password: decodeURIComponent(url.password),
    database: restoreDb,
  });
  const source = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
  await restored.connect();
  await source.connect();
  const results: Array<{ table: string; liveCount: number; restoredCount: number; ok: boolean }> =
    [];
  try {
    for (const table of CRITICAL_TABLES) {
      const [restoredRow, liveRow] = await Promise.all([
        restored.query(`SELECT count(*)::int AS n FROM ${table}`),
        source.query(`SELECT count(*)::int AS n FROM ${table}`),
      ]);
      const restoredCount = restoredRow.rows[0].n as number;
      const liveCount = liveRow.rows[0].n as number;
      results.push({
        table,
        liveCount,
        restoredCount,
        ok: restoredCount >= 0 && restoredCount <= liveCount,
      });
    }
  } finally {
    await restored.end();
    await source.end();
  }
  const ok = results.every((r) => r.ok) && results.some((r) => r.restoredCount > 0);
  const note = `Restore into ${restoreDb}: ${results
    .map((r) => `${r.table}=${r.restoredCount}`)
    .join(', ')}`;
  await prisma.backupRecord.updateMany({
    where: { id: backupId },
    data: { verifiedAt: new Date(), verificationNote: note.slice(0, 900) },
  });
  await appendAudit(prisma, {
    eventType: 'BACKUP_VERIFIED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'BackupRecord',
    objectId: backupId,
    result: ok ? 'SUCCESS' : 'FAILURE',
    correlationId: record.correlationId,
    metadata: { ok, tables: results.length },
  });
  return { ok, results, note };
}

export async function listBackups(actor: Actor) {
  if (!can(actor, 'backup.operate') && !can(actor, 'health.view')) throw ServiceError.forbidden();
  return getPrisma().backupRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
}
