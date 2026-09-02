/**
 * Background worker skeleton (Architecture.md: separate worker process).
 *
 * Stage 1 has no asynchronous business work by design: the outbox arrives at
 * Stage 5 and reminders/escalation at Stage 3, and baseline capture keeps all
 * improvement automation off (DEC-007 / IC-S1-004). This process establishes
 * the boundary: configuration validation, database connectivity, a heartbeat,
 * and clean shutdown - so later stages add job handlers, not infrastructure.
 *
 * Logs are structured and PII-free (REQ-SEC-023): identifiers and counts
 * only, never employee data.
 */
import { loadRootEnvFile, getConfig } from '@exit/config';

loadRootEnvFile(import.meta.dirname);

const {
  getPrisma,
  renderApprovedDocument,
  renderApprovedForm,
  appendAudit,
  runStage3Sweep,
  processOutbox,
  runDueSchedules,
  revokeExpiredRoles,
  scheduledDirectorySyncIfEnabled,
} = await import('@exit/db');
const { randomUUID } = await import('node:crypto');

const HEARTBEAT_MS = 60_000;
const MAX_RENDER_ATTEMPTS = 3;

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), source: 'worker', event, ...fields }));
}

const config = getConfig(); // fail-closed guards run before anything else
const prisma = getPrisma();

let running = true;

async function heartbeat(): Promise<void> {
  try {
    // Connectivity probe. Directive 6.3: enabled automation flags are the
    // intended operating state, reported as information - never a false
    // alarm. Production live-send safety stays with the fail-closed config
    // guards and the pilot activation gates, not this log line.
    const enabled = await prisma.featureFlag.findMany({
      where: { enabled: true },
      select: { key: true },
    });
    log('heartbeat', {
      env: config.NODE_ENV,
      emailMode: config.EMAIL_MODE,
      enabledAutomationFlags: enabled.length,
      enabledFlagKeys: enabled.map((f) => f.key).join(','),
    });
  } catch (e) {
    log('heartbeat_error', { message: e instanceof Error ? e.message : 'unknown' });
  }
}

/**
 * Stage 2 sweeps (Directive 2 section J). All operations are idempotent
 * updateMany claims with bounded retries; correlation IDs only, no PII, and
 * the worker never sends email.
 */
async function stage2Sweep(): Promise<void> {
  const correlationId = randomUUID();
  try {
    // 1. PDF render retries (bounded).
    const jobs = await prisma.renderJob.findMany({
      where: { status: 'QUEUED', attempts: { lt: MAX_RENDER_ATTEMPTS } },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
    for (const job of jobs) {
      const claimed = await prisma.renderJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: { status: 'RUNNING', claimedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue; // another worker claimed it
      try {
        if (job.subjectType === 'DOCUMENT') {
          await renderApprovedDocument(job.subjectId, job.correlationId);
        } else {
          await renderApprovedForm(job.subjectId, job.correlationId);
        }
        await prisma.renderJob.updateMany({ where: { id: job.id }, data: { status: 'DONE' } });
        log('render_job_done', { jobId: job.id, subjectType: job.subjectType });
      } catch (e) {
        const failedFinally = job.attempts + 1 >= MAX_RENDER_ATTEMPTS;
        await prisma.renderJob.updateMany({
          where: { id: job.id },
          data: {
            status: failedFinally ? 'FAILED' : 'QUEUED',
            lastError: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
          },
        });
        log('render_job_retry', { jobId: job.id, attempts: job.attempts + 1, failedFinally });
      }
    }

    // 2. Survey expiry: sent invitations past their expiry become EXPIRED.
    const expired = await prisma.surveyInvitation.findMany({
      where: { status: 'MANUALLY_SENT', expiresAt: { lt: new Date() } },
      select: { id: true, caseId: true },
      take: 50,
    });
    for (const inv of expired) {
      const u = await prisma.surveyInvitation.updateMany({
        where: { id: inv.id, status: 'MANUALLY_SENT' },
        data: {
          status: 'EXPIRED',
          responseChannel: 'NOT_COMPLETED',
          tokenHash: null, // expired links stop working immediately
          rowVersion: { increment: 1 },
        },
      });
      if (u.count > 0) {
        await appendAudit(prisma, {
          eventType: 'SURVEY_EXPIRED',
          actorType: 'SYSTEM',
          objectType: 'SurveyInvitation',
          objectId: inv.id,
          caseId: inv.caseId,
          result: 'SUCCESS',
          correlationId,
        });
        log('survey_expired', { invitationId: inv.id });
      }
    }

    // 3. Due-state visibility: counts only (HR acts manually; no email exists).
    const [invitationsDue, remindersDue] = await Promise.all([
      prisma.surveyInvitation.count({
        where: { status: 'PENDING', invitationDueAt: { lte: new Date() } },
      }),
      prisma.surveyInvitation.count({
        where: {
          status: 'MANUALLY_SENT',
          OR: [
            { reminder1DueAt: { lte: new Date() }, reminder1SentAt: null },
            { reminder2DueAt: { lte: new Date() }, reminder2SentAt: null },
          ],
        },
      }),
    ]);
    if (invitationsDue + remindersDue > 0) {
      log('survey_due_states', { invitationsDue, remindersDue });
    }
  } catch (e) {
    log('sweep_error', { message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
  }
}

/**
 * Stage 3 sweep (Directive 3 sections N and Q): task release, dependency
 * resolution, due-state and SLA evaluation, exact-time access escalation,
 * notification/asset/handover due states and clearance-readiness recalc.
 * The implementation lives in @exit/db (workflowSweepService) so integration
 * tests can drive it with an injected clock; this process only schedules it.
 * The worker never sends email, never revokes live access, never updates
 * BambooHR, never touches payroll and never calls an external AI service.
 */
async function stage3Sweep(): Promise<void> {
  try {
    const r = await runStage3Sweep(new Date());
    if (
      r.released +
        r.overdueExceptions +
        r.accessEscalations +
        r.notificationOverdue +
        r.assetOverdue +
        r.handoverOverdue >
      0
    ) {
      log('stage3_sweep', { ...r });
    }
  } catch (e) {
    log('stage3_sweep_error', {
      message: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    });
  }
}

/**
 * Stage 4 sweep (Directive 4 sections B, E, O, V): transactional-outbox
 * processing, scheduled report runs, role-expiry revocation and a recorded
 * worker heartbeat for the health dashboard. The worker never sends live
 * email in development configuration - dispatch goes to the capture mailbox.
 */
async function stage4Sweep(): Promise<void> {
  try {
    const outbox = await processOutbox(new Date());
    const reports = await runDueSchedules(new Date());
    const expiredRoles = await revokeExpiredRoles(new Date());
    // Directive 5.1 D.2: prepared scheduled directory sync - a no-op unless
    // the bamboohr.scheduledSync configuration flag is explicitly enabled.
    const directorySync = await scheduledDirectorySyncIfEnabled();
    if (directorySync !== 'disabled' && directorySync !== 'fresh') {
      log('directory_scheduled_sync', { outcome: directorySync }); // counts only, never names
    }
    // PII-free heartbeat for readiness gates and the health dashboard.
    await prisma.systemConfig.upsert({
      where: { key: 'worker.lastHeartbeat' },
      create: {
        key: 'worker.lastHeartbeat',
        value: new Date().toISOString(),
        reason: 'worker heartbeat',
      },
      update: { value: new Date().toISOString() },
    });
    if (outbox.submitted + outbox.failed + outbox.deadLettered + reports + expiredRoles > 0) {
      log('stage4_sweep', { ...outbox, scheduledReports: reports, expiredRoles });
    }
  } catch (e) {
    log('stage4_sweep_error', {
      message: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    });
  }
}

// The worker builds every emailed link (checklist, acknowledgement) from
// APP_BASE_URL, so it states the value at startup: a "localhost" base while
// the web app is exposed to the network means links that dead-end on the
// tester's own machine (owner directive, 2026-09-02).
log('started', {
  env: config.NODE_ENV,
  heartbeatMs: HEARTBEAT_MS,
  appBaseUrl: config.APP_BASE_URL,
  webLanExposed: config.lanExposed,
  devLoginEnabled: config.devLoginEnabled,
});
if (config.lanExposed && config.appBaseUrlIsLoopback) {
  log('warning', {
    message:
      'APP_BASE_URL is a loopback address while WEB_HOST accepts network connections; ' +
      'links in captured email will not open from another workstation.',
  });
}
await heartbeat();
await stage2Sweep();
await stage3Sweep();
await stage4Sweep();
const timer = setInterval(() => {
  void heartbeat();
  void stage2Sweep();
  void stage3Sweep();
  void stage4Sweep();
}, HEARTBEAT_MS);

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  running = false;
  log('shutdown', { signal });
  clearInterval(timer);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
