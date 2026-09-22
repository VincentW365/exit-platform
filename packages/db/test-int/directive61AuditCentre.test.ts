/**
 * Directive 6.1 integration - Audit Centre backend: filters, pagination,
 * restricted-case minimization, technical scoping, audited export with CSV
 * injection protection (sections K/O/P/Q, AM tests 31-34).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import {
  exportGlobalAuditCsv,
  listCaseAudit,
  listGlobalAudit,
} from '../src/services/auditService.ts';
import { TECHNICAL_CATEGORIES, eventCategory } from '@exit/domain';
import {
  createUser,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let otherManager: Awaited<ReturnType<typeof createUser>>;
let noRole: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

let normalCaseId: string;
let normalCaseNumber: string;
let restrictedCaseId: string;
let restrictedCaseNumber: string;

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('D61C Officer', 'HR_OFFICER');
  manager = await createUser('D61C Manager', 'HR_MANAGER');
  otherManager = await createUser('D61C Other Manager', 'HR_MANAGER');
  noRole = await createUser('D61C No Active Role');

  const normal = await createDraft(officer.actor, TEST_DRAFT);
  normalCaseId = normal.caseId;
  normalCaseNumber = normal.caseNumber;
  await transitionCase(officer.actor, normalCaseId, 'submit');
  await transitionCase(manager.actor, normalCaseId, 'approve');

  // Restricted case run entirely by the OTHER manager - the first manager is
  // not a participant and must never see its content.
  const restricted = await createDraft(otherManager.actor, {
    ...TEST_DRAFT,
    departureType: 'TERMINATION',
    employeeSourceId: 'EMP-TEST-003',
    confirmedLastDay: null,
  });
  restrictedCaseId = restricted.caseId;
  restrictedCaseNumber = restricted.caseNumber;
});

describe('global feed filters and pagination (AM 31)', () => {
  it('filters by category, event type, actor, result and case number', async () => {
    const byCategory = await listGlobalAudit(manager.actor, { category: 'CASE' });
    expect(byCategory.rows.length).toBeGreaterThan(0);
    expect(byCategory.rows.every((r) => r.minimized || r.category === 'CASE')).toBe(true);

    const byType = await listGlobalAudit(manager.actor, { eventType: 'CASE_APPROVED' });
    expect(byType.rows.every((r) => r.eventType === 'CASE_APPROVED')).toBe(true);

    const byActor = await listGlobalAudit(manager.actor, { actorId: officer.userId });
    expect(byActor.rows.every((r) => r.actorId === officer.userId)).toBe(true);

    const byCase = await listGlobalAudit(manager.actor, { caseNumber: normalCaseNumber });
    expect(byCase.rows.length).toBeGreaterThan(0);
    expect(byCase.rows.every((r) => r.caseNumber === normalCaseNumber)).toBe(true);

    const from = new Date(Date.now() + 3_600_000);
    const empty = await listGlobalAudit(manager.actor, { from });
    expect(empty.rows).toHaveLength(0);
  });

  it('keyset pagination walks without overlap', async () => {
    const page1 = await listGlobalAudit(manager.actor, { take: 3 });
    expect(page1.rows).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listGlobalAudit(manager.actor, { take: 3, cursor: page1.nextCursor! });
    const ids1 = new Set(page1.rows.map((r) => r.id));
    expect(page2.rows.every((r) => !ids1.has(r.id))).toBe(true);
  });

  it('audits searches themselves (D9) and case timelines expose chips', async () => {
    await listGlobalAudit(manager.actor, { category: 'SECURITY' });
    const searched = await prisma.auditEvent.count({ where: { eventType: 'AUDIT_SEARCHED' } });
    expect(searched).toBeGreaterThan(0);
    const assignments = await listCaseAudit(officer.actor, normalCaseId, { chip: 'APPROVALS' });
    expect(assignments.every((e) => e.category === 'APPROVAL')).toBe(true);
  });
});

describe('restricted-case minimization for HR_MANAGER (AM 32)', () => {
  it('minimizes rows the manager cannot view; participants see full rows', async () => {
    const feed = await listGlobalAudit(manager.actor, { take: 200 });
    const restrictedRows = feed.rows.filter((r) => r.caseId === restrictedCaseId);
    // Restricted-case rows never reach the manager with content.
    expect(restrictedRows).toHaveLength(0);
    const minimized = feed.rows.filter((r) => r.minimized);
    expect(minimized.length).toBeGreaterThan(0);
    for (const row of minimized) {
      expect(row.eventType).toBe('RESTRICTED');
      expect(row.actorDisplayName).toBeNull();
      expect(row.caseNumber).toBeNull();
      expect(Object.keys(row.metadata)).toHaveLength(0);
    }
    // Case-number lookup does not leak existence (DEC-042: no oversight
    // bypass exists any more - participation is the only path to full rows).
    const lookup = await listGlobalAudit(manager.actor, { caseNumber: restrictedCaseNumber });
    expect(lookup.rows).toHaveLength(0);
    // The participating manager sees the full rows.
    const participant = await listGlobalAudit(otherManager.actor, {
      caseNumber: restrictedCaseNumber,
    });
    expect(participant.rows.length).toBeGreaterThan(0);
    expect(participant.rows.every((r) => !r.minimized)).toBe(true);
  });
});

describe('technical events after DEC-063 (AM 33 superseded)', () => {
  it('sit in the single HR Manager feed; an account with no active role has no feed', async () => {
    // Generate a technical (CONFIG) event with no case linkage.
    const { setFlag } = await import('../src/services/adminService.ts');
    await setFlag(manager.actor, 'automation.workflowEngine', false, 'D61 audit centre test');
    const feed = await listGlobalAudit(manager.actor, { category: 'CONFIG', take: 200 });
    expect(feed.rows.length).toBeGreaterThan(0);
    for (const row of feed.rows) {
      expect(TECHNICAL_CATEGORIES).toContain(eventCategory(row.eventType as never));
      expect(row.caseId).toBeNull();
    }
    await expect(listGlobalAudit(noRole.actor, { take: 200 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('audited export with injection protection (AM 34)', () => {
  it('exports for authorized roles only; formulas are neutralized; export audited', async () => {
    await expect(exportGlobalAuditCsv(officer.actor, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // An actor whose display name starts with '=' would be a formula cell.
    const hostile = await createUser('=cmd|calc!A1', 'HR_OFFICER');
    const hostileCase = await createDraft(hostile.actor, {
      ...TEST_DRAFT,
      employeeSourceId: 'EMP-TEST-004',
    });
    expect(hostileCase.caseId).toBeTruthy();
    const csv = await exportGlobalAuditCsv(manager.actor, { category: 'CASE' });
    expect(csv).toContain('occurredAt,category,eventType');
    expect(csv).not.toMatch(/^=|[\r\n]"?=(?!=)/); // no raw leading formulas
    expect(csv).toContain("'="); // neutralized with a leading apostrophe
    const exported = await prisma.auditEvent.count({ where: { eventType: 'AUDIT_EXPORTED' } });
    expect(exported).toBeGreaterThan(0);
  });
});
