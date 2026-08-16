/**
 * Directive 6.3 K/R/T/U integration: derived email actions, automatic
 * sending through the capture provider, no-login acknowledgement tokens and
 * HR-recorded evidence. Runs the REAL automation path end-to-end - the same
 * flow production would use, pointed at the safe capture provider (AG).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  confirmBenefits,
  deriveActionsForCase,
  listRequiredActions,
} from '../src/services/derivedActionService.ts';
import { setCaseRecipient } from '../src/services/notificationService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import {
  expireActionTokens,
  getActionByToken,
  recordManualEvidence,
  redeemActionToken,
} from '../src/services/ackTokenService.ts';
import { runStage3Sweep } from '../src/services/workflowSweepService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

async function activeCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, created.caseId);
  return created.caseId;
}

function recordsOf(caseId: string) {
  return prisma.notificationRecord.findMany({
    where: { caseId },
    orderBy: { createdAt: 'asc' },
  });
}

/** Extract the raw ack-link tokens from a captured email body. */
function tokensFromBody(body: string): string[] {
  return [...body.matchAll(/\/ack\/([A-Za-z0-9_-]{43})/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('D63 Officer', 'HR_OFFICER');
  manager = await createUser('D63 Manager', 'HR_MANAGER');
  lineMgr = await createUser('D63 Line Manager', 'LINE_MANAGER');
});

describe('deterministic derivation at activation (B/C; AC 5-7, 11-12)', () => {
  it('derives IT + Finance email actions, assets from issued items, survey and benefits rows', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-001' });
    const actions = await prisma.caseRequiredAction.findMany({ where: { caseId } });
    const keys = actions.map((a) => a.actionKey);
    expect(keys).toContain('EMAIL:IT_ACCESS_REMOVAL');
    expect(keys).toContain('EMAIL:FINANCE_OFFBOARDING');
    expect(keys).toContain('SURVEY:INVITATION');
    expect(keys).toContain('BENEFITS:CONFIRMATION');
    // Asset actions come strictly from issued assets (AC 11-12).
    const issued = await prisma.issuedAsset.count({
      where: { employeeSourceId: 'EMP-TEST-001', active: true },
    });
    expect(actions.filter((a) => a.actionKey.startsWith('ASSET:')).length).toBe(issued);
    // Every derivation carries provenance (C).
    for (const a of actions) {
      expect(a.ruleKey).toMatch(/^RULE_/);
      expect(a.rulesVersion).toBeTruthy();
      expect(a.sourceFields).toBeTruthy();
    }
    // IT + Finance records were auto-created (AC 5-6) with SYSTEM audit.
    const records = await recordsOf(caseId);
    const types = records.map((r) => r.notificationType);
    expect(types).toContain('IT_ACCESS_REMOVAL');
    expect(types).toContain('FINANCE_OFFBOARDING');
    expect(records.every((r) => r.origin === 'DERIVED')).toBe(true);
    const audited = await prisma.auditEvent.count({
      where: { caseId, eventType: 'DERIVED_ACTIONS_COMPUTED' },
    });
    expect(audited).toBeGreaterThan(0);
    // Benefits are UNKNOWN -> no provider notification, but an actionable
    // exception (V; AC 7).
    expect(types).not.toContain('SAGICOR_GROUP_HEALTH_REMOVAL');
    const benefitsException = await prisma.caseException.findFirst({
      where: { caseId, exceptionType: 'BENEFITS_APPLICABILITY_UNKNOWN', status: 'OPEN' },
    });
    expect(benefitsException).not.toBeNull();
    // Re-derivation is idempotent: no duplicate actions or records.
    await deriveActionsForCase(caseId, new Date());
    expect(await prisma.caseRequiredAction.count({ where: { caseId } })).toBe(actions.length);
    expect((await recordsOf(caseId)).length).toBe(records.length);
  });

  it('confirming benefits YES prepares the provider notification; NO never does (V; AC 7, 20)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-002' });
    await confirmBenefits(officer.actor, caseId, {
      groupHealth: 'YES',
      groupLife: 'NO',
      otherProvider: 'NO',
    });
    const records = await recordsOf(caseId);
    const types = records.map((r) => r.notificationType);
    expect(types).toContain('SAGICOR_GROUP_HEALTH_REMOVAL');
    expect(types).not.toContain('NCB_GROUP_LIFE_REMOVAL');
    // The uncertainty exception clears once everything is resolved.
    const open = await prisma.caseException.findFirst({
      where: { caseId, exceptionType: 'BENEFITS_APPLICABILITY_UNKNOWN', status: 'OPEN' },
    });
    expect(open).toBeNull();
    // External providers default to HR review - never auto-released (S).
    const sagicor = records.find((r) => r.notificationType === 'SAGICOR_GROUP_HEALTH_REMOVAL')!;
    expect(sagicor.status).toBe('PENDING_APPROVAL');
  });
});

describe('automatic sending + acknowledgement tokens (R/T/U; AC 13-17)', () => {
  it('routine internal emails send with ZERO HR clicks; tokens confirm without login', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-003' });
    const now = new Date();
    // AUTO_SEND released the internal records without any human actor.
    const it_ = (await recordsOf(caseId)).find((r) => r.notificationType === 'IT_ACCESS_REMOVAL')!;
    expect(['APPROVED', 'SENT']).toContain(it_.status);
    const autoApproved = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'NOTIFICATION_AUTO_APPROVED', objectId: it_.id },
    });
    expect(autoApproved).not.toBeNull();
    expect(autoApproved!.actorType).toBe('SYSTEM');

    // Dispatch through the capture provider (the REAL automation flow - AG).
    await processOutbox(now);
    const sent = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: it_.id } });
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).not.toBeNull();
    // Delivery is never completion (AC 17).
    expect(sent.completionConfirmedAt).toBeNull();

    // The captured email carries the secure links; the DB has only hashes.
    const capture = await prisma.notificationCapture.findFirst({
      where: { recordId: it_.id },
      orderBy: { capturedAt: 'desc' },
    });
    expect(capture).not.toBeNull();
    const rawTokens = tokensFromBody(capture!.body);
    expect(rawTokens.length).toBeGreaterThanOrEqual(1);
    for (const raw of rawTokens) {
      expect(capture!.body).toContain(raw);
      const stored = await prisma.actionToken.findMany({
        where: { notificationRecordId: it_.id },
      });
      expect(JSON.stringify(stored)).not.toContain(raw); // hash-only storage
    }

    // Acknowledge + confirm completion through the public token path.
    const ackView = await getActionByToken(rawTokens[0]!);
    expect(ackView).not.toBeNull();
    const first = await redeemActionToken(rawTokens[0]!, 'Received by IT service desk.');
    expect(first?.ok).toBe(true);
    // Replay dies instantly (single-use, hash nulled).
    expect(await redeemActionToken(rawTokens[0]!)).toBeNull();
    if (rawTokens.length > 1) {
      const second = await redeemActionToken(rawTokens[1]!, 'All access removed.');
      expect(second?.ok).toBe(true);
      const done = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: it_.id } });
      expect(done.status).toBe('CONFIRMED_COMPLETE');
      expect(done.completionConfirmedAt).not.toBeNull();
    }
  });

  it('no duplicate dispatch across repeated derivations and outbox passes (AC 15)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-004' });
    await deriveActionsForCase(caseId, new Date());
    await processOutbox(new Date());
    await deriveActionsForCase(caseId, new Date());
    await processOutbox(new Date());
    const fin = (await recordsOf(caseId)).filter(
      (r) => r.notificationType === 'FINANCE_OFFBOARDING',
    );
    expect(fin.length).toBe(1);
    const outboxRows = await prisma.notificationOutbox.count({
      where: { notificationRecordId: fin[0]!.id },
    });
    expect(outboxRows).toBe(1);
    expect(await prisma.notificationCapture.count({ where: { recordId: fin[0]!.id } })).toBe(1);
  });

  it('HR-recorded evidence (confirmed by phone) completes without any token (T)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-005' });
    await processOutbox(new Date());
    const fin = (await recordsOf(caseId)).find(
      (r) => r.notificationType === 'FINANCE_OFFBOARDING',
    )!;
    expect(
      (await prisma.notificationRecord.findUniqueOrThrow({ where: { id: fin.id } })).status,
    ).toBe('SENT');
    await recordManualEvidence(officer.actor, fin.id, {
      kind: 'COMPLETED',
      channel: 'PHONE',
      note: 'Finance confirmed the offboarding workpaper is complete.',
    });
    const done = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: fin.id } });
    expect(done.status).toBe('CONFIRMED_COMPLETE');
    expect(done.acknowledgedVia).toBe('HR_RECORDED');
  });

  it('expired tokens die instantly and are audited (T)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-008' });
    await processOutbox(new Date());
    const it_ = (await recordsOf(caseId)).find((r) => r.notificationType === 'IT_ACCESS_REMOVAL')!;
    const capture = await prisma.notificationCapture.findFirstOrThrow({
      where: { recordId: it_.id },
    });
    const raw = tokensFromBody(capture.body)[0]!;
    // A year from now every token has expired.
    const expired = await expireActionTokens(new Date(Date.now() + 365 * 86_400_000));
    expect(expired).toBeGreaterThan(0);
    expect(await getActionByToken(raw)).toBeNull();
    expect(await redeemActionToken(raw)).toBeNull();
  });

  it('sent-but-unconfirmed IT actions escalate at the deadline (U.6)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-010' });
    await processOutbox(new Date());
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    // Sweep past the effective separation instant: unconfirmed = CRITICAL.
    await runStage3Sweep(new Date(c.effectiveSeparationAt!.getTime() + 60_000));
    const itRecord = (await recordsOf(caseId)).find(
      (r) => r.notificationType === 'IT_ACCESS_REMOVAL',
    )!;
    const exception = await prisma.caseException.findFirst({
      where: {
        caseId,
        exceptionType: 'ACKNOWLEDGEMENT_OVERDUE',
        status: 'OPEN',
        refId: itRecord.id,
      },
    });
    expect(exception).not.toBeNull();
    expect(exception!.severity).toBe('CRITICAL');
  });
});

describe('recipient handling (O/P; AC 8, 20)', () => {
  it('a missing recipient is an actionable exception; HR enters one for this case only', async () => {
    // Suspend the IT recipient so derivation cannot resolve it.
    await prisma.recipientConfig.updateMany({
      where: { recipientClass: 'IT_OFFBOARDING' },
      data: { active: false },
    });
    try {
      const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-006' });
      const it_ = (await recordsOf(caseId)).find(
        (r) => r.notificationType === 'IT_ACCESS_REMOVAL',
      )!;
      // Never silently skipped (AC 8): the record exists and HR is prompted.
      const exception = await prisma.caseException.findFirst({
        where: { caseId, exceptionType: 'RECIPIENT_MISSING', refId: it_.id, status: 'OPEN' },
      });
      expect(exception).not.toBeNull();
      // The unapproved/unresolved recipient is never contacted (AC 20).
      await processOutbox(new Date());
      expect(await prisma.notificationCapture.count({ where: { recordId: it_.id } })).toBe(0);

      // Officer enters a case-only recipient - no HR-Manager approval needed
      // (correction 6) - and the AUTO_SEND record releases + dispatches.
      await setCaseRecipient(officer.actor, it_.id, {
        recipientName: 'IT Service Desk',
        organization: "Bert's Auto Parts IT",
        email: 'it-desk@example.invalid',
        saveForFuture: false,
      });
      const resolved = await prisma.caseException.findFirst({
        where: { caseId, exceptionType: 'RECIPIENT_MISSING', refId: it_.id },
      });
      expect(resolved!.status).toBe('RESOLVED');
      await processOutbox(new Date());
      const after = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: it_.id } });
      expect(after.status).toBe('SENT');
      expect(after.caseRecipientMask).toBeTruthy();
      // The raw address never lands in plain text on the record.
      expect(after.caseRecipientCiphertext).not.toContain('it-desk@example.invalid');
    } finally {
      await prisma.recipientConfig.updateMany({
        where: { recipientClass: 'IT_OFFBOARDING' },
        data: { active: true },
      });
    }
  });

  it('required actions panel is exception-first (X/Y; correction 8)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-007' });
    const view = await listRequiredActions(officer.actor, caseId);
    // Benefits are UNKNOWN -> exactly the uncertainty needs attention;
    // routine automation does NOT appear as attention items.
    expect(view.summary.counts.attention).toBeGreaterThanOrEqual(1);
    expect(view.summary.attention.some((r) => r.key === 'BENEFITS:CONFIRMATION')).toBe(true);
    expect(view.summary.automatic.length).toBeGreaterThanOrEqual(1);
    // Business language only - no enum-style labels in the panel rows.
    for (const row of [...view.summary.attention, ...view.summary.automatic]) {
      expect(row.label).not.toMatch(/_[A-Z]/);
    }
  });
});
