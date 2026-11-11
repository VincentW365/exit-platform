/**
 * What a hosted site's HR Manager can check without the host's logs or
 * settings (DEC-073): whether the database schema matches this build, and
 * whether the background worker is alive. Names, counts and ages only.
 * Nothing here throws: a database that cannot be read is reported as such.
 */
import { getConfig, uploadBodyLimitMb } from '@exit/config';
import { getPrisma } from '../client.ts';
import { EXPECTED_LATEST_MIGRATION, schemaState, type SchemaState } from '../schemaVersion.ts';
import { dataKeyFingerprint, tryDecryptValue } from '../secretBox.ts';
import { bambooCredentialStatus } from './bambooCredentialService.ts';
import { seededRecipientFor } from './recipientService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export interface DatabaseSchemaStatus {
  reachable: boolean;
  expected: string;
  /** The newest finished migration, or null when none is recorded or the table is missing. */
  applied: string | null;
  state: SchemaState;
}

export async function databaseSchemaStatus(): Promise<DatabaseSchemaStatus> {
  const prisma = getPrisma();
  let reachable = false;
  let applied: string | null = null;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    reachable = true;
    // Name order is time order (the names begin with a timestamp), and it
    // holds even when migrations were applied out of sequence.
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1',
    );
    applied = rows[0]?.migration_name ?? null;
  } catch {
    // Unreachable, or no migrations table yet: both read as unknown below.
  }
  return {
    reachable,
    expected: EXPECTED_LATEST_MIGRATION,
    applied,
    state: reachable ? schemaState(applied) : 'unknown',
  };
}

/** One line for the health dashboard's "database schema" component. */
export function describeSchemaState(s: DatabaseSchemaStatus): string {
  switch (s.state) {
    case 'current':
      return `current (${s.expected})`;
    case 'ahead':
      return `newer than this build: database has ${s.applied}, build expects ${s.expected}`;
    case 'behind':
      return `BEHIND this build: database has ${s.applied}, build expects ${s.expected} - run the migrations (prisma migrate deploy)`;
    default:
      return s.reachable
        ? 'no migration recorded - run the migrations (prisma migrate deploy)'
        : 'unreachable';
  }
}

/** The worker is alive while its heartbeat is under three minutes old. */
export const WORKER_HEARTBEAT_MAX_AGE_S = 180;

export interface WorkerStatus {
  lastHeartbeatAt: Date | null;
  ageSeconds: number | null;
  alive: boolean;
}

export async function workerStatus(now: Date = new Date()): Promise<WorkerStatus> {
  let at: Date | null = null;
  try {
    const raw = await getSystemConfigValue('worker.lastHeartbeat');
    at = typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null;
  } catch {
    // No settings table yet: the worker has certainly not written to it.
  }
  const ageSeconds = at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000)) : null;
  return {
    lastHeartbeatAt: at,
    ageSeconds,
    alive: ageSeconds !== null && ageSeconds < WORKER_HEARTBEAT_MAX_AGE_S,
  };
}

export interface DataKeyStatus {
  /** Eight hex characters: compare between the seeding machine and the site. */
  fingerprint: string;
  savedAddresses: number;
  unreadableAddresses: number;
  /** Unreadable rows the seed wrote: the System page can repair these. */
  repairableAddresses: number;
  bambooCredential: 'readable' | 'unreadable' | 'none';
  state: 'current' | 'changed' | 'none';
}

/**
 * Whether this site's data key reads what was saved (owner report,
 * 2026-11-10). Every saved value is tried in memory and discarded: nothing
 * decrypted leaves this function.
 */
export async function dataKeyStatus(): Promise<DataKeyStatus> {
  const fingerprint = dataKeyFingerprint();
  let savedAddresses = 0;
  let unreadableAddresses = 0;
  let repairableAddresses = 0;
  let bambooCredential: DataKeyStatus['bambooCredential'] = 'none';
  try {
    const rows = await getPrisma().recipientConfig.findMany({
      select: {
        destinationCiphertext: true,
        recipientClass: true,
        environment: true,
        changeReason: true,
        destinationMask: true,
      },
    });
    savedAddresses = rows.length;
    const unreadable = rows.filter((r) => tryDecryptValue(r.destinationCiphertext) === null);
    unreadableAddresses = unreadable.length;
    repairableAddresses = unreadable.filter((r) => seededRecipientFor(r) !== null).length;
    const credential = await bambooCredentialStatus();
    bambooCredential =
      credential.source === 'app'
        ? credential.status === 'configured'
          ? 'readable'
          : 'unreadable'
        : 'none';
  } catch {
    // No tables yet: nothing saved to read.
  }
  const state =
    unreadableAddresses > 0 || bambooCredential === 'unreadable'
      ? 'changed'
      : savedAddresses === 0 && bambooCredential === 'none'
        ? 'none'
        : 'current';
  return {
    fingerprint,
    savedAddresses,
    unreadableAddresses,
    repairableAddresses,
    bambooCredential,
    state,
  };
}

export interface UploadLimitStatus {
  /** MAX_UPLOAD_MB as this process runs. */
  configuredMb: number;
  /** The request-body limit the web app was built with, or null when the build did not say. */
  builtBodyLimitMb: number | null;
  /** What the build must accept for a file of configuredMb to arrive whole. */
  requiredBodyLimitMb: number;
  /**
   * The MAX_UPLOAD_MB the build was made for: configuredMb when the build is
   * large enough, otherwise what the build's limit implies (0 when the build
   * never set a limit and kept Next's 1 MB).
   */
  effectiveMb: number;
  state: 'ok' | 'build-too-small' | 'unknown';
}

/**
 * Whether the files the configuration accepts also reach the application
 * (DEC-075). Next.js refuses a server action's request body above a limit
 * fixed when the web app was built; next.config.ts sizes it from MAX_UPLOAD_MB
 * at build time and inlines the value, which the System page passes in here.
 * A host that raises MAX_UPLOAD_MB on a build made with a smaller value gets a
 * plain statement of what gets through, instead of a reference per upload.
 */
export function uploadLimitStatus(builtBodyLimitMb: number | null): UploadLimitStatus {
  const configuredMb = getConfig().MAX_UPLOAD_MB;
  const requiredBodyLimitMb = uploadBodyLimitMb(configuredMb);
  const built =
    builtBodyLimitMb !== null && Number.isFinite(builtBodyLimitMb) && builtBodyLimitMb > 0
      ? builtBodyLimitMb
      : null;
  if (built === null) {
    return {
      configuredMb,
      builtBodyLimitMb: null,
      requiredBodyLimitMb,
      effectiveMb: configuredMb,
      state: 'unknown',
    };
  }
  const tooSmall = built < requiredBodyLimitMb;
  return {
    configuredMb,
    builtBodyLimitMb: built,
    requiredBodyLimitMb,
    effectiveMb: tooSmall
      ? Math.max(0, built - (requiredBodyLimitMb - configuredMb))
      : configuredMb,
    state: tooSmall ? 'build-too-small' : 'ok',
  };
}

export async function siteSupportStatus(
  options: { now?: Date; builtBodyLimitMb?: number | null } = {},
): Promise<{
  schema: DatabaseSchemaStatus;
  worker: WorkerStatus;
  dataKey: DataKeyStatus;
  uploads: UploadLimitStatus;
}> {
  const [schema, worker, dataKey] = await Promise.all([
    databaseSchemaStatus(),
    workerStatus(options.now ?? new Date()),
    dataKeyStatus(),
  ]);
  return { schema, worker, dataKey, uploads: uploadLimitStatus(options.builtBodyLimitMb ?? null) };
}
