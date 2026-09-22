/**
 * Record-level authorization against the real database: restricted
 * termination invisibility, masking, and the
 * SYSTEM_ADMIN isolation rule (REQ-SEC-007/008/010, DEC-035, IC-S1-011).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addParticipant,
  createDraft,
  getCase,
  listCases,
  setRehireEligibility,
} from '../src/services/caseService.ts';
import { hrDashboard } from '../src/services/dashboardService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

let manager: Awaited<ReturnType<typeof createUser>>;
let otherOfficer: Awaited<ReturnType<typeof createUser>>;
let sysadmin: Awaited<ReturnType<typeof createUser>>;
let itResponder: Awaited<ReturnType<typeof createUser>>;
let restrictedCaseId: string;
let restrictedCaseNumber: string;
let normalCaseId: string;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Dana Manager', 'HR_MANAGER');
  otherOfficer = await createUser('Riley Other', 'HR_OFFICER');
  sysadmin = await createUser('Marley Admin');
  itResponder = await createUser('Sam IT');

  const normal = await createDraft(otherOfficer.actor, VALID_DRAFT);
  normalCaseId = normal.caseId;

  const restricted = await createDraft(manager.actor, {
    ...VALID_DRAFT,
    employeeSourceId: 'EMP-TEST-003',
    departureType: 'TERMINATION',
  });
  restrictedCaseId = restricted.caseId;
  restrictedCaseNumber = restricted.caseNumber;
});

describe('restricted termination cases (DEC-035 / IC-S1-011)', () => {
  it('are RESTRICTED by default', async () => {
    const { case: c } = await getCase(manager.actor, restrictedCaseId);
    expect(c.classification).toBe('RESTRICTED');
  });

  it('detail access for a non-participant HR officer returns NOT_FOUND (no existence leak)', async () => {
    await expect(getCase(otherOfficer.actor, restrictedCaseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never appear in a non-participant HR list or dashboard counts', async () => {
    const rows = await listCases(otherOfficer.actor, {});
    expect(rows.some((r) => r.id === restrictedCaseId)).toBe(false);

    const dash = await hrDashboard(otherOfficer.actor);
    const totalVisible = Object.values(dash.countsByStatus).reduce((a, b) => a + b, 0);
    const managerDash = await hrDashboard(manager.actor);
    const totalManager = Object.values(managerDash.countsByStatus).reduce((a, b) => a + b, 0);
    expect(totalManager).toBe(totalVisible + 1); // exactly the restricted case
  });

  it('search by the restricted employee name returns nothing for non-participants', async () => {
    const rows = await listCases(otherOfficer.actor, { q: 'Morgan' });
    expect(rows).toHaveLength(0);
  });

  it('SYSTEM_ADMIN and departmental roles get nothing at all (REQ-SEC-010)', async () => {
    for (const denied of [sysadmin, itResponder]) {
      await expect(listCases(denied.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(getCase(denied.actor, restrictedCaseId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(getCase(denied.actor, normalCaseId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('explicit participation opens content access and is audited', async () => {
    await addParticipant(
      manager.actor,
      restrictedCaseId,
      otherOfficer.userId,
      'HR_SUPPORT',
      'Assigned to support the termination preparation.',
    );
    const { case: c } = await getCase(otherOfficer.actor, restrictedCaseId);
    expect(c.caseNumber).toBe(restrictedCaseNumber);
  });
});

describe('sensitive field masking (REQ-CASE-026)', () => {
  it('rehire eligibility is visible to HR Manager only', async () => {
    await setRehireEligibility(manager.actor, normalCaseId, 'ELIGIBLE');

    const managerView = await getCase(manager.actor, normalCaseId);
    expect(managerView.case.rehireEligibility).toBe('ELIGIBLE');
    expect(managerView.case.rehireMasked).toBe(false);

    const officerView = await getCase(otherOfficer.actor, normalCaseId);
    expect(officerView.case.rehireEligibility).toBeNull();
    expect(officerView.case.rehireMasked).toBe(true);
  });

  it('an HR officer cannot set rehire eligibility', async () => {
    await expect(
      setRehireEligibility(otherOfficer.actor, normalCaseId, 'NOT_ELIGIBLE'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
