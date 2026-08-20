/**
 * Aggregated operational health (Directive 4 sections M, U.7, V).
 *
 * Everything reported here is PII-free and secret-free: components, states,
 * counts, ages and stable codes only.
 */
import { getConfig } from '@exit/config';
import { maskDestination } from '@exit/domain';
import { ServiceError } from '../errors.ts';
import { getPrisma } from '../client.ts';
import { getEmailProvider } from './emailProviders.ts';
import { getBambooAdapter } from './bamboohrService.ts';
import { getScanner } from './scannerService.ts';
import { getStorage } from '../storage.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export interface ComponentHealth {
  component: string;
  ok: boolean;
  detail: string;
}

export async function collectHealth(): Promise<{
  ok: boolean;
  components: ComponentHealth[];
  metrics: Record<string, number | string | null>;
}> {
  const prisma = getPrisma();
  const config = getConfig();
  const components: ComponentHealth[] = [];
  const now = Date.now();

  // Database + migration status.
  let dbOk = false;
  let migration: string | null = null;
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
    );
    migration = rows[0]?.migration_name ?? null;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  components.push({
    component: 'database',
    ok: dbOk,
    detail: dbOk ? `connected; latest migration ${migration}` : 'unreachable',
  });

  // Providers.
  const email = getEmailProvider();
  const emailHealth = await email.health();
  components.push({ component: `email (${email.mode})`, ...emailHealth });
  // Rehearsal mode diverts every outgoing message. A diversion nobody can see
  // is worse than no diversion, so it is reported as a system condition -
  // NOT as a failure, because a rehearsal is a legitimate state to be in.
  const { currentTestMode } = await import('./outboxService.ts');
  const testMode = await currentTestMode();
  components.push({
    component: 'email rehearsal mode',
    ok: true,
    detail: testMode.enabled
      ? `ON - every message is diverted to ${maskDestination(testMode.redirectTo)} and marked as a test`
      : 'off - messages go to their real recipients',
  });
  // A directory configured for live mode without credentials in this process
  // is exactly what the health dashboard exists to report, so the failure
  // becomes a DOWN component rather than a crashed page. The adapter reports
  // the configuration CATEGORY only - never the credential itself.
  try {
    const bamboo = await getBambooAdapter();
    const bambooHealth = await bamboo.health();
    components.push({ component: `bamboohr (${bamboo.mode})`, ...bambooHealth });
  } catch (e) {
    components.push({
      component: 'bamboohr (live)',
      ok: false,
      detail:
        e instanceof ServiceError && e.details.length > 0
          ? e.details.join('; ')
          : 'directory adapter unavailable',
    });
  }
  const scanner = getScanner();
  const scannerHealth = await scanner.health();
  components.push({ component: `scanner (${scanner.mode})`, ...scannerHealth });
  const storage = getStorage();
  const storageHealth = (await storage.health?.()) ?? { ok: true, detail: storage.name };
  components.push({ component: `storage (${storage.name})`, ...storageHealth });
  components.push({
    component: `identity (${config.IDENTITY_MODE})`,
    ok: config.IDENTITY_MODE === 'dev' ? !config.isProduction : true,
    detail:
      config.IDENTITY_MODE === 'dev'
        ? 'development identity (forbidden in production)'
        : 'oidc boundary configured',
  });

  // Worker heartbeat (written by the worker each cycle).
  const heartbeat = (await getSystemConfigValue('worker.lastHeartbeat')) as string | null;
  const heartbeatAgeS = heartbeat ? Math.round((now - new Date(heartbeat).getTime()) / 1000) : null;
  components.push({
    component: 'worker',
    ok: heartbeatAgeS !== null && heartbeatAgeS < 180,
    detail:
      heartbeatAgeS === null ? 'no heartbeat recorded' : `last heartbeat ${heartbeatAgeS}s ago`,
  });

  // Operational metrics (V).
  const [
    outboxPending,
    outboxDead,
    oldestPending,
    failedRenders,
    overdueAccess,
    lastBackup,
    openCritical,
  ] = dbOk
    ? await Promise.all([
        prisma.notificationOutbox.count({
          where: { status: { in: ['PENDING', 'FAILED_RETRYABLE'] } },
        }),
        prisma.notificationOutbox.count({
          where: { status: { in: ['DEAD_LETTER', 'FAILED_PERMANENT'] }, resolvedAt: null },
        }),
        prisma.notificationOutbox.findFirst({
          where: { status: { in: ['PENDING', 'FAILED_RETRYABLE'] } },
          orderBy: { scheduledAt: 'asc' },
          select: { scheduledAt: true },
        }),
        prisma.renderJob.count({ where: { status: 'FAILED' } }),
        prisma.workflowTask.count({
          where: {
            taskKind: 'ACCESS_REVOCATION',
            status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] },
            dueAt: { lt: new Date() },
          },
        }),
        prisma.backupRecord.findFirst({ orderBy: { createdAt: 'desc' } }),
        prisma.caseException.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
      ])
    : [0, 0, null, 0, 0, null, 0];

  const metrics: Record<string, number | string | null> = {
    outboxDepth: outboxPending,
    outboxOldestAgeMinutes: oldestPending
      ? Math.round((now - oldestPending.scheduledAt.getTime()) / 60_000)
      : null,
    deadLetterCount: outboxDead,
    failedPdfRenders: failedRenders,
    overdueAccessTasks: overdueAccess,
    backupAgeHours: lastBackup
      ? Math.round((now - lastBackup.createdAt.getTime()) / 3_600_000)
      : null,
    openCriticalExceptions: openCritical,
    latestMigration: migration,
  };

  return {
    ok: components.every((c) => c.ok || c.component.startsWith('bamboohr')),
    components,
    metrics,
  };
}

/** Liveness: process + database only (secret- and PII-free). */
export async function livenessCheck(): Promise<{ ok: boolean }> {
  try {
    await getPrisma().$queryRawUnsafe('SELECT 1');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Readiness: database + required-provider configuration (U.7). */
export async function readinessCheck(): Promise<{ ok: boolean; failing: string[] }> {
  const health = await collectHealth();
  const config = getConfig();
  const failing: string[] = [];
  for (const c of health.components) {
    if (c.component === 'database' && !c.ok) failing.push('database');
    if (config.isProduction) {
      if (c.component.startsWith('email') && !c.ok && config.EMAIL_MODE !== 'disabled')
        failing.push('email');
      if (c.component.startsWith('scanner') && !c.ok) failing.push('scanner');
      if (c.component.startsWith('storage') && !c.ok) failing.push('storage');
      if (c.component.startsWith('identity') && !c.ok) failing.push('identity');
    }
  }
  return { ok: failing.length === 0, failing };
}
