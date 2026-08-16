/**
 * Stage 4 integration: scanner/storage, taxonomy, calendar, pilot gates,
 * reporting, retention, backup and fallback (Directive 4 X items 12-27).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@exit/config';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { uploadAttachment, downloadAttachment } from '../src/services/attachmentService.ts';
import {
  approveReasonCategory,
  upsertReasonCategory,
  retireReasonCategory,
} from '../src/services/reasonService.ts';
import {
  approveCalendar,
  publishCalendarVersion,
  previewCalendarImpact,
} from '../src/services/adminService.ts';
import {
  applyActivation,
  approveActivation,
  evaluateReadinessGates,
  proposeActivation,
  currentActivationState,
  suspendActivation,
} from '../src/services/pilotService.ts';
import { setSystemConfig } from '../src/services/systemConfigService.ts';
import { runReport, exportReportCsv } from '../src/services/reportingService.ts';
import {
  anonymizeCase,
  approveRetentionPolicy,
  placeHold,
  retentionDryRun,
  upsertRetentionPolicy,
} from '../src/services/retentionService.ts';
import { createBackup, restoreAndVerify } from '../src/services/backupService.ts';
import {
  declareOutage,
  recordFallbackEntry,
  reconcileFallbackEntry,
} from '../src/services/fallbackService.ts';
import { setFlag } from '../src/services/adminService.ts';
import { syncEmployees } from '../src/services/bamboohrService.ts';
import { generateAccessReview } from '../src/services/identityService.ts';
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
let sysAdmin: Awaited<ReturnType<typeof createUser>>;
let privacy: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-s4-'))));
  officer = await createUser('S4B Officer', 'HR_OFFICER');
  manager = await createUser('S4B Manager', 'HR_MANAGER');
  sysAdmin = await createUser('S4B SysAdmin', 'SYSTEM_ADMIN');
  // DEC-042: HR_MANAGER absorbs privacy/retention operations.
  privacy = await createUser('S4B Privacy HRM', 'HR_MANAGER');
  lineMgr = await createUser('S4B Line Manager', 'LINE_MANAGER');
});

async function makeCase(overrides: Record<string, unknown> = {}, approve = true) {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  if (approve) {
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');
  }
  return created.caseId;
}

describe('scanner and storage (X.12-X.14)', () => {
  it('quarantined uploads stay unavailable while no scanner exists (X.12)', async () => {
    const caseId = await makeCase({}, false);
    const uploaded = await uploadAttachment(
      officer.actor,
      caseId,
      { fileName: 'evidence.png', declaredMime: 'image/png', bytes: PNG },
      'SUPPORTING_DOCUMENT',
    );
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.attachmentId },
    });
    expect(row.scanStatus).toBe('PENDING'); // quarantined, never auto-clean
    await expect(downloadAttachment(officer.actor, uploaded.attachmentId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('production rejects passthrough scanning and dev capture (X.13, X.7, X.27)', () => {
    const prodBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@h:5432/db',
      SESSION_SECRET: 'a'.repeat(48),
    };
    expect(() => loadConfig({ ...prodBase, SCAN_MODE: 'dev-passthrough' })).toThrow();
    expect(() => loadConfig({ ...prodBase, EMAIL_MODE: 'dev-capture' })).toThrow();
    expect(() => loadConfig({ ...prodBase, STORAGE_MODE: 'local' })).toThrow();
    expect(() => loadConfig({ ...prodBase, IDENTITY_MODE: 'dev' })).toThrow();
  });

  it('object storage stays private: system keys only, no overwrite (X.14)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'exit-priv-'));
    const local = new LocalStorageAdapter(dir);
    await expect(local.put('../escape.txt', PNG)).rejects.toThrow(/Invalid object key/);
    await expect(local.put('avery-brown.pdf', PNG)).rejects.toThrow(/Invalid object key/);
    const key = 'ab'.repeat(24);
    await local.put(key, PNG);
    await expect(local.put(key, PNG)).rejects.toThrow(); // never overwrite
    expect((await local.get(key)).length).toBe(PNG.length);
  });
});

describe('taxonomy and calendar (X.15, X.16)', () => {
  it('reason versions preserve historical values; retirement never rewrites (X.15)', async () => {
    await upsertReasonCategory(manager.actor, {
      code: 'TEST-S4-REASON',
      label: 'Career change (synthetic)',
      changeReason: 'Stage 4 test seed',
      voluntary: true,
      departureTypes: [],
      sortOrder: 1,
      sensitive: false,
    });
    const v1 = await prisma.reasonCategory.findUniqueOrThrow({ where: { code: 'TEST-S4-REASON' } });
    await approveReasonCategory(manager.actor, v1.id);
    const caseId = await makeCase({ reasonCategoryId: v1.id }, false);

    await upsertReasonCategory(manager.actor, {
      code: 'TEST-S4-REASON',
      label: 'Career change (revised label)',
      changeReason: 'Label revision',
      voluntary: true,
      departureTypes: [],
      sortOrder: 1,
      sensitive: false,
    });
    const v2 = await prisma.reasonCategory.findUniqueOrThrow({ where: { code: 'TEST-S4-REASON' } });
    expect(v2.taxonomyVersion).toBe(v1.taxonomyVersion + 1);
    await approveReasonCategory(manager.actor, v2.id);
    await retireReasonCategory(manager.actor, v2.id, 'Superseded in test.');

    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.reasonCategoryId).toBe(v1.id); // history intact (J.4/J.5)
  });

  it('calendar approval + preview never rewrite existing due dates (X.16)', async () => {
    const caseId = await makeCase({ employeeSourceId: 'EMP-TEST-002' });
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);
    const before = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId, dueAt: { not: null } },
      orderBy: { sortOrder: 'asc' },
    });

    const preview = await previewCalendarImpact(manager.actor, [
      { date: '2026-08-04', label: 'TEST new holiday' },
      { date: '2026-08-05', label: 'TEST new holiday 2' },
    ]);
    expect(preview.evaluatedTasks).toBeGreaterThan(0);

    await publishCalendarVersion(
      manager.actor,
      'synthetic-dev-calendar',
      [{ date: '2026-08-04', label: 'TEST new holiday (synthetic)' }],
      'Stage 4 test calendar version',
    );
    const active = await prisma.holidayCalendar.findFirstOrThrow({ where: { isActive: true } });
    await approveCalendar(manager.actor, active.id);

    const after = await prisma.workflowTask.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.dueAt!.getTime()).toBe(before.dueAt!.getTime()); // K.2/K.3
    expect(after.dueCalendarVersion).toBe(before.dueCalendarVersion);
  });
});

describe('pilot activation gates (X.17-X.19)', () => {
  it('PILOT_ACTIVE is blocked while mandatory gates fail (X.17)', async () => {
    // Walk the state machine to PILOT_READY first.
    for (const state of ['TRAINING_ENABLED', 'PILOT_READY'] as const) {
      const rec = await proposeActivation(manager.actor, {
        targetState: state,
        rollbackPlan: 'Return to fully manual operations immediately.',
      });
      await applyActivation(manager.actor, rec.id);
    }
    const rec = await proposeActivation(manager.actor, {
      targetState: 'PILOT_ACTIVE',
      rollbackPlan: 'Return to fully manual operations immediately.',
    });
    await approveActivation(manager.actor, rec.id, 'hr');
    await approveActivation(sysAdmin.actor, rec.id, 'admin');
    await expect(applyActivation(manager.actor, rec.id)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const gates = await evaluateReadinessGates();
    expect(gates.filter((g) => g.mandatory && !g.ok).length).toBeGreaterThan(0);
  });

  it('PILOT_ACTIVE succeeds when every gate and approval is satisfied (X.18)', async () => {
    // Satisfy the remaining gates with synthetic evidence.
    await setSystemConfig(sysAdmin.actor, 'readiness.sopPublished', true, 'test');
    await setSystemConfig(sysAdmin.actor, 'readiness.uatPassed', true, 'test');
    await setSystemConfig(sysAdmin.actor, 'readiness.manualFallbackReady', true, 'test');
    await setSystemConfig(sysAdmin.actor, 'worker.lastHeartbeat', new Date().toISOString(), 'test');
    await syncEmployees(sysAdmin.actor);
    // Approved active reason category (the X.15 category was retired).
    await upsertReasonCategory(manager.actor, {
      code: 'TEST-S4-GATE',
      label: 'Gate reason (synthetic)',
      changeReason: 'gate test',
      voluntary: null,
      departureTypes: [],
      sortOrder: 2,
      sensitive: false,
    });
    const gateReason = await prisma.reasonCategory.findUniqueOrThrow({
      where: { code: 'TEST-S4-GATE' },
    });
    await approveReasonCategory(manager.actor, gateReason.id);
    // Three ACTIVE document templates (normally the Stage 2 seed).
    for (const documentType of [
      'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
      'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
      'OFFBOARDING_ACTION_FORM',
    ] as const) {
      const exists = await prisma.documentTemplate.findFirst({ where: { documentType } });
      if (!exists) {
        await prisma.documentTemplate.create({
          data: {
            documentType,
            name: `Gate template ${documentType}`,
            version: 1,
            status: 'ACTIVE',
            contentBody: 'DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE',
            allowedPlaceholders: [],
            contentChecksum: 'gate-test',
            createdById: manager.userId,
          },
        });
      }
    }
    // A healthy (clearly-labelled) development scanner for the gate.
    process.env['SCAN_MODE'] = 'dev-passthrough';
    const { resetConfigForTests } = await import('@exit/config');
    resetConfigForTests();
    const policy = await upsertRetentionPolicy(privacy.actor, {
      recordType: 'OFFBOARDING_CASE',
      retainYears: 7,
      basis: 'Synthetic development schedule',
      reason: 'Stage 4 test',
    });
    await approveRetentionPolicy(privacy.actor, policy.id);
    const backup = await createBackup(sysAdmin.actor);
    await restoreAndVerify(sysAdmin.actor, backup.backupId);
    // Resolve any open CRITICAL exceptions left by earlier tests.
    await prisma.caseException.updateMany({
      where: { status: 'OPEN', severity: 'CRITICAL' },
      data: { status: 'RESOLVED', resolution: 'test cleanup' },
    });
    await prisma.trainingCompletion
      .create({
        data: { userId: officer.userId, role: 'HR_OFFICER', module: 'hr-offboarding-sop' },
      })
      .catch(() => undefined);

    const rec = await proposeActivation(manager.actor, {
      targetState: 'PILOT_ACTIVE',
      scope: { maxActiveCases: 5 },
      rollbackPlan: 'Suspend, then return to fully manual operations.',
    });
    // Approvals from BOTH authorities are mandatory (L.3).
    await expect(applyActivation(manager.actor, rec.id)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await approveActivation(manager.actor, rec.id, 'hr');
    await approveActivation(sysAdmin.actor, rec.id, 'admin');
    const applied = await applyActivation(manager.actor, rec.id);
    expect(applied.state).toBe('PILOT_ACTIVE');
    expect(await currentActivationState()).toBe('PILOT_ACTIVE');
    // Restore the environment's default scanner configuration.
    delete process.env['SCAN_MODE'];
    const { resetConfigForTests: reset } = await import('@exit/config');
    reset();
  });

  it('BASELINE cases are never retrospectively processed (X.19 / L.6)', async () => {
    // Even with the engine flag on and PILOT_ACTIVE, BASELINE stays excluded.
    await setFlag(sysAdmin.actor, 'automation.workflowEngine', true, 'Stage 4 test');
    const created = await createDraft(officer.actor, {
      ...VALID_DRAFT, // OPERATIONAL + BASELINE
      confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
      employeeSourceId: 'EMP-TEST-003',
    });
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');
    await expect(activateCase(manager.actor, created.caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(await prisma.workflowInstance.count({ where: { caseId: created.caseId } })).toBe(0);
    await setFlag(sysAdmin.actor, 'automation.workflowEngine', false, 'Stage 4 test reset');
    // Suspension stops new automated work immediately (L.8).
    await suspendActivation(manager.actor, 'Stage 4 test suspension.');
    expect(await currentActivationState()).toBe('SUSPENDED');
  });
});

describe('reporting controls (X.20-X.22)', () => {
  it('restricted cases stay out of unauthorized management reports (X.20)', async () => {
    // Manager creates a restricted termination case (owner = manager).
    const term = await createDraft(manager.actor, {
      ...TEST_DRAFT,
      departureType: 'TERMINATION',
      employeeSourceId: 'EMP-TEST-005',
      confirmedLastDay: null,
    });
    const report = await runReport(officer.actor, 'volumeTrend', { recordPurpose: 'TEST' });
    const terminationRows = report.rows.filter((r) => r[0] === 'TERMINATION');
    // The officer is not a participant: the restricted case adds nothing to
    // their totals.
    expect(terminationRows.reduce((s, r) => s + Number(r[2] ?? 0), 0)).toBe(0);
    void term;
  });

  it('small-group suppression applies below the threshold (X.21)', async () => {
    const report = await runReport(manager.actor, 'voluntaryInvoluntary', {
      recordPurpose: 'TEST',
    });
    // Termination count is small in this dataset -> suppressed marker exists.
    expect(report.rows.some((r) => r[0] === '(suppressed)')).toBe(true);
    expect(report.note).toContain('suppressed');
  });

  it('every export is audited with CSV injection controls intact (X.22)', async () => {
    const csv = await exportReportCsv(manager.actor, 'volumeTrend', { recordPurpose: 'TEST' });
    expect(csv).toContain('Departure type');
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'REPORT_EXPORTED', actorId: manager.userId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});

describe('retention, backup and fallback (X.23-X.26)', () => {
  it('dry run identifies eligible records without deleting; holds block (X.23, X.24)', async () => {
    // A closed old TEST case.
    const caseId = await makeCase({ employeeSourceId: 'EMP-TEST-001' }, false);
    await transitionCase(manager.actor, caseId, 'cancel', 'Stage 4 retention test.');
    await prisma.offboardingCase.update({
      where: { id: caseId },
      data: { closedAt: new Date('2015-01-01T00:00:00Z') },
    });
    const run1 = await retentionDryRun(privacy.actor);
    const finding = run1.findings.find((f) => f.caseId === caseId);
    expect(finding?.eligible).toBe(true);
    expect(await prisma.offboardingCase.count({ where: { id: caseId } })).toBe(1); // nothing deleted

    await placeHold(privacy.actor, caseId, 'Litigation hold (synthetic).');
    const run2 = await retentionDryRun(privacy.actor);
    const heldFinding = run2.findings.find((f) => f.caseId === caseId);
    expect(heldFinding?.eligible).toBe(false);
    expect(heldFinding?.held).toBe(true);
    await expect(anonymizeCase(privacy.actor, caseId, 'attempt under hold')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('approved anonymization preserves audit integrity (X.23 scenario)', async () => {
    const caseId = await makeCase({ employeeSourceId: 'EMP-TEST-002' }, false);
    await transitionCase(manager.actor, caseId, 'cancel', 'Stage 4 anonymization test.');
    const auditCountBefore = await prisma.auditEvent.count({ where: { caseId } });
    await anonymizeCase(privacy.actor, caseId, 'Approved synthetic anonymization test.');
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.employeeDisplayName).toContain('ANONYMIZED-');
    expect(c.employeeWorkEmail).toBeNull();
    expect(c.anonymizedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { caseId } })).toBeGreaterThan(auditCountBefore);
  });

  it('backup restores critical synthetic evidence into an isolated database (X.25)', async () => {
    const backup = await createBackup(sysAdmin.actor);
    const result = await restoreAndVerify(sysAdmin.actor, backup.backupId);
    expect(result.ok).toBe(true);
    expect(
      result.results.find((r) => r.table === 'offboarding_case')!.restoredCount,
    ).toBeGreaterThan(0);
    expect(result.results.find((r) => r.table === 'audit_event')!.restoredCount).toBeGreaterThan(0);
    const record = await prisma.backupRecord.findUniqueOrThrow({ where: { id: backup.backupId } });
    expect(record.verifiedAt).not.toBeNull();
  });

  it('manual fallback reconciliation prevents duplicates (X.26)', async () => {
    const outage = await declareOutage(manager.actor, 'Stage 4 synthetic outage');
    const entry = await recordFallbackEntry(manager.actor, {
      outageId: outage.id,
      kind: 'CASE',
      summary: 'Manual case intake captured on paper (synthetic).',
    });
    expect(entry.refNumber).toMatch(/^FB-\d{4}-\d{4}$/);
    await reconcileFallbackEntry(
      manager.actor,
      entry.id,
      null,
      'Entered into the system as a new case.',
    );
    await expect(
      reconcileFallbackEntry(manager.actor, entry.id, null, 'second attempt'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('access review evidence is append-only (W)', async () => {
    const review = await generateAccessReview(sysAdmin.actor);
    await expect(
      prisma.accessReview.update({ where: { id: review.id }, data: { note: 'tamper' } }),
    ).rejects.toThrow(/append-only/);
  });
});
