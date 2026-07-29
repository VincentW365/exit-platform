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

const { getPrisma, renderApprovedDocument, renderApprovedForm, appendAudit } =
  await import('@exit/db');
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
    // Connectivity probe plus a safety assertion: in Stage 1 every automation
    // flag must remain disabled; a flipped flag is loudly reported.
    const enabledFlags = await prisma.featureFlag.count({ where: { enabled: true } });
    log('heartbeat', {
      env: config.NODE_ENV,
      emailMode: config.EMAIL_MODE,
      enabledAutomationFlags: enabledFlags,
      stage1AutomationExpected: 0,
    });
    if (enabledFlags > 0) {
      log('warning', {
        message: 'automation flags enabled while Stage 1 baseline capture is active',
        enabledAutomationFlags: enabledFlags,
      });
    }
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

log('started', { env: config.NODE_ENV, heartbeatMs: HEARTBEAT_MS });
await heartbeat();
await stage2Sweep();
const timer = setInterval(() => {
  void heartbeat();
  void stage2Sweep();
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
