/**
 * Role-by-surface authorization matrix (Directive 1.1 section E).
 *
 * Every role is exercised against every Stage 1 surface at the SERVICE layer
 * (the single server-side authorization choke point). The expected outcome
 * table below is the acceptance matrix reproduced in Stage1AcceptanceReport.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@exit/domain';
import {
  baselineDashboard,
  baselineExportCsv,
  createDraft,
  getCase,
  hrDashboard,
  listAttachments,
  listCaseAudit,
  listCases,
  listGlobalAudit,
  listUsersForAdmin,
  searchEmployees,
  transitionCase,
} from '../src/index.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

type Outcome = 'ALLOW' | 'FORBIDDEN' | 'NOT_FOUND';

const ROLES: Role[] = [
  'HR_MANAGER',
  'HR_OFFICER',
  'IT_RESPONDER',
  'FINANCE_RESPONDER',
  'LINE_MANAGER',
  'AUDITOR',
  'PRIVACY_OFFICER',
  'SYSTEM_ADMIN',
];

/**
 * Expected outcomes per surface. HR_MANAGER/HR_OFFICER here are NOT
 * participants of the restricted case - restricted access must come from
 * explicit assignment, never from role alone.
 */
const EXPECTED: Record<string, Record<Role, Outcome>> = {
  caseList: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'ALLOW',
    PRIVACY_OFFICER: 'ALLOW',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  employeeSearch: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  caseCreate: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  normalCaseDetail: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'NOT_FOUND',
    FINANCE_RESPONDER: 'NOT_FOUND',
    LINE_MANAGER: 'NOT_FOUND',
    AUDITOR: 'ALLOW',
    PRIVACY_OFFICER: 'ALLOW',
    SYSTEM_ADMIN: 'NOT_FOUND',
  },
  restrictedCaseDetail: {
    HR_MANAGER: 'NOT_FOUND',
    HR_OFFICER: 'NOT_FOUND',
    IT_RESPONDER: 'NOT_FOUND',
    FINANCE_RESPONDER: 'NOT_FOUND',
    LINE_MANAGER: 'NOT_FOUND',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'NOT_FOUND',
  },
  hrDashboard: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  baselineDashboard: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  baselineExport: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  globalAuditFeed: {
    HR_MANAGER: 'FORBIDDEN',
    HR_OFFICER: 'FORBIDDEN',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'ALLOW',
    PRIVACY_OFFICER: 'ALLOW',
    SYSTEM_ADMIN: 'FORBIDDEN',
  },
  normalCaseAudit: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'NOT_FOUND',
    FINANCE_RESPONDER: 'NOT_FOUND',
    LINE_MANAGER: 'NOT_FOUND',
    AUDITOR: 'ALLOW',
    PRIVACY_OFFICER: 'ALLOW',
    SYSTEM_ADMIN: 'NOT_FOUND',
  },
  normalCaseAttachments: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'ALLOW',
    IT_RESPONDER: 'NOT_FOUND',
    FINANCE_RESPONDER: 'NOT_FOUND',
    LINE_MANAGER: 'NOT_FOUND',
    AUDITOR: 'ALLOW',
    PRIVACY_OFFICER: 'ALLOW',
    SYSTEM_ADMIN: 'NOT_FOUND',
  },
  approveMutation: {
    HR_MANAGER: 'ALLOW',
    HR_OFFICER: 'FORBIDDEN',
    IT_RESPONDER: 'NOT_FOUND',
    FINANCE_RESPONDER: 'NOT_FOUND',
    LINE_MANAGER: 'NOT_FOUND',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'NOT_FOUND',
  },
  adminUsers: {
    HR_MANAGER: 'FORBIDDEN',
    HR_OFFICER: 'FORBIDDEN',
    IT_RESPONDER: 'FORBIDDEN',
    FINANCE_RESPONDER: 'FORBIDDEN',
    LINE_MANAGER: 'FORBIDDEN',
    AUDITOR: 'FORBIDDEN',
    PRIVACY_OFFICER: 'FORBIDDEN',
    SYSTEM_ADMIN: 'ALLOW',
  },
};

const actors = new Map<Role, Awaited<ReturnType<typeof createUser>>>();
let normalCaseId: string;
let restrictedCaseId: string;
let pendingCaseId: string;

async function classify(p: Promise<unknown>): Promise<Outcome> {
  try {
    await p;
    return 'ALLOW';
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'FORBIDDEN') return 'FORBIDDEN';
    if (code === 'NOT_FOUND') return 'NOT_FOUND';
    throw e;
  }
}

beforeAll(async () => {
  await resetDb();
  for (const role of ROLES) actors.set(role, await createUser(`Matrix ${role}`, role));
  const owner = await createUser('Matrix Owner', 'HR_OFFICER');
  const restrictedOwner = await createUser('Matrix RestrictedOwner', 'HR_MANAGER');
  normalCaseId = (await createDraft(owner.actor, VALID_DRAFT)).caseId;
  restrictedCaseId = (
    await createDraft(restrictedOwner.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
    })
  ).caseId;
  pendingCaseId = (
    await createDraft(owner.actor, { ...VALID_DRAFT, employeeSourceId: 'EMP-TEST-002' })
  ).caseId;
  await transitionCase(owner.actor, pendingCaseId, 'submit');
});

describe('role-by-surface authorization matrix', () => {
  const surfaces: Record<string, (role: Role) => Promise<unknown>> = {
    caseList: (r) => listCases(actors.get(r)!.actor, {}),
    employeeSearch: (r) => searchEmployees(actors.get(r)!.actor, 'avery'),
    caseCreate: (r) =>
      createDraft(actors.get(r)!.actor, {
        ...VALID_DRAFT,
        employeeSourceId: 'EMP-TEST-004',
        recordPurpose: 'TEST',
        measurementCohort: null,
      }),
    normalCaseDetail: (r) => getCase(actors.get(r)!.actor, normalCaseId),
    restrictedCaseDetail: (r) => getCase(actors.get(r)!.actor, restrictedCaseId),
    hrDashboard: (r) => hrDashboard(actors.get(r)!.actor),
    baselineDashboard: (r) => baselineDashboard(actors.get(r)!.actor),
    baselineExport: (r) => baselineExportCsv(actors.get(r)!.actor),
    globalAuditFeed: (r) => listGlobalAudit(actors.get(r)!.actor, {}),
    normalCaseAudit: (r) => listCaseAudit(actors.get(r)!.actor, normalCaseId),
    normalCaseAttachments: (r) => listAttachments(actors.get(r)!.actor, normalCaseId),
    approveMutation: (r) => transitionCase(actors.get(r)!.actor, pendingCaseId, 'approve'),
    adminUsers: (r) => listUsersForAdmin(actors.get(r)!.actor),
  };

  for (const [surface, run] of Object.entries(surfaces)) {
    it(`surface: ${surface}`, async () => {
      const expected = EXPECTED[surface]!;
      for (const role of ROLES) {
        // approveMutation would actually approve for HR_MANAGER; run it last
        // for the manager and tolerate ALLOW consuming the transition.
        if (surface === 'approveMutation' && role === 'HR_MANAGER') continue;
        const outcome = await classify(run(role));
        expect(outcome, `${surface} as ${role}`).toBe(expected[role]);
      }
      if (surface === 'approveMutation') {
        const outcome = await classify(run('HR_MANAGER'));
        expect(outcome, `${surface} as HR_MANAGER`).toBe(expected['HR_MANAGER']);
      }
    });
  }

  it('restricted case is absent from every unauthorized aggregate surface', async () => {
    // list rows
    for (const role of ['HR_MANAGER', 'HR_OFFICER'] as Role[]) {
      const rows = await listCases(actors.get(role)!.actor, {});
      expect(
        rows.some((c) => c.id === restrictedCaseId),
        role,
      ).toBe(false);
    }
    // search by restricted employee name
    const found = await listCases(actors.get('HR_OFFICER')!.actor, { q: 'Morgan' });
    expect(found).toHaveLength(0);
    // baseline dashboard + export
    const dash = await baselineDashboard(actors.get('HR_OFFICER')!.actor);
    expect(dash.some((r) => r.id === restrictedCaseId)).toBe(false);
    const csv = await baselineExportCsv(actors.get('HR_OFFICER')!.actor);
    expect(csv.includes('Morgan')).toBe(false);
    // oversight sees only a minimized row, never the employee identity
    const oversightRows = await listCases(actors.get('AUDITOR')!.actor, {});
    const row = oversightRows.find((c) => c.id === restrictedCaseId);
    expect(row?.minimized).toBe(true);
    expect(JSON.stringify(row)).not.toContain('Morgan');
  });
});
