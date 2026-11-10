/**
 * What a hosted site's HR Manager can check without the host's logs or
 * settings (DEC-073): whether the database schema matches this build, and
 * whether the background worker is alive. Names, counts and ages only.
 * Nothing here throws: a database that cannot be read is reported as such.
 */
import { getPrisma } from '../client.ts';
import { EXPECTED_LATEST_MIGRATION, schemaState, type SchemaState } from '../schemaVersion.ts';
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

export async function siteSupportStatus(
  now: Date = new Date(),
): Promise<{ schema: DatabaseSchemaStatus; worker: WorkerStatus }> {
  const [schema, worker] = await Promise.all([databaseSchemaStatus(), workerStatus(now)]);
  return { schema, worker };
}
