/**
 * The separation decision matrix, end to end (owner directive, 2026-08-26,
 * section 33).
 *
 * The unit tests prove the rules; this proves the platform actually obeys
 * them - that every canonical type can be created, validated, activated and
 * carried downstream without borrowing another separation's behaviour.
 *
 * The server is the authority here, not the form: every rejection asserted
 * below is asserted by calling the service directly, which is exactly what a
 * direct API request would do (directive 30).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase, updateDraft } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { DEPARTURE_TYPES, separationProfile } from '@exit/domain';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
} from './helpers.ts';

const prisma = getPrisma();
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;

/** The minimum a type needs, taken from its own profile rather than guessed. */
function draftFor(type: (typeof DEPARTURE_TYPES)[number], employeeSourceId: string) {
  const profile = separationProfile(type);
  const base: Record<string, unknown> = {
    ...VALID_DRAFT,
    employeeSourceId,
    departureType: type,
    recordPurpose: 'TEST',
    measurementCohort: null,
    receivedAt: iso(0),
    effectiveSeparationAt: undefined,
    confirmedLastDay: iso(10),
  };
  if (profile.requiredDates.includes('effectiveSeparationAt')) base.effectiveSeparationAt = iso(10);
  else delete base.effectiveSeparationAt;
  if (profile.requiredDates.includes('contractEndDate')) base.contractEndDate = iso(10);
  if (profile.requiresDetail) {
    base.separationTypeDetail = 'Mutual separation agreed in writing.';
    base.noticeApplicableOverride = false;
  }
  return base;
}

describe('every canonical separation type works end to end', () => {
  beforeAll(async () => {
    await resetDb();
    await seedStage3Fixtures();
    officer = await createUser('Separation Officer', 'HR_OFFICER');
    manager = await createUser('Separation Manager', 'HR_MANAGER');
  });

  for (const type of DEPARTURE_TYPES) {
    it(`${type} creates, activates and gets its own workflow`, async () => {
      // A restricted-by-default separation is not discoverable by a
      // non-participant, so the approving manager owns it - the same shape
      // the existing termination fixtures use.
      const author = separationProfile(type).restrictedByDefault ? manager : officer;
      const created = await createDraft(author.actor, draftFor(type, 'EMP-TEST-001'));
      await transitionCase(author.actor, created.caseId, 'submit');
      await transitionCase(manager.actor, created.caseId, 'approve');
      await readyAssignment(created.caseId, manager.actor, officer.userId);
      await activateCase(manager.actor, created.caseId);

      const instance = await prisma.workflowInstance.findFirstOrThrow({
        where: { caseId: created.caseId },
        include: { definition: true, tasks: true },
      });
      // Its OWN definition - never another separation's.
      expect(instance.definition.workflowType).toBe(type);
      expect(instance.tasks.length).toBeGreaterThan(0);
    });
  }

  it('classifies employer-initiated separations as restricted', async () => {
    for (const type of DEPARTURE_TYPES) {
      const created = await createDraft(officer.actor, draftFor(type, 'EMP-TEST-002'));
      const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
      expect(c.classification).toBe(
        separationProfile(type).restrictedByDefault ? 'RESTRICTED' : 'CONFIDENTIAL',
      );
    }
  });
});

describe('the server enforces the rules the form only displays', () => {
  beforeAll(async () => {
    await resetDb();
    await seedStage3Fixtures();
    officer = await createUser('Rules Officer', 'HR_OFFICER');
    manager = await createUser('Rules Manager', 'HR_MANAGER');
  });

  it('refuses a contract end date on a termination', async () => {
    await expect(
      createDraft(officer.actor, {
        ...draftFor('TERMINATION', 'EMP-TEST-001'),
        contractEndDate: iso(20),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/does not apply to a termination/i)],
    });
  });

  it('refuses to let a caller declare notice on a type that already answers it', async () => {
    // The control is only offered for OTHER; a direct call must not be able
    // to claim a termination had employee notice.
    await expect(
      createDraft(officer.actor, {
        ...draftFor('TERMINATION', 'EMP-TEST-001'),
        noticeApplicableOverride: true,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/determined by/i)],
    });
  });

  it('refuses an "Other" separation that does not say what it is', async () => {
    const draft = draftFor('OTHER', 'EMP-TEST-001');
    delete draft.separationTypeDetail;
    delete draft.noticeApplicableOverride;
    await expect(createDraft(officer.actor, draft)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: expect.arrayContaining([
        expect.stringMatching(/describe the separation/i),
        expect.stringMatching(/whether employee notice applies/i),
      ]),
    });
  });

  it('requires a contract end date when the employee record has none', async () => {
    const draft = draftFor('CONTRACT_EXPIRY', 'EMP-TEST-001');
    delete draft.contractEndDate;
    await expect(createDraft(officer.actor, draft)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/contract end date is required/i)],
    });
  });

  it('questions an impossible date pairing but accepts an audited reason', async () => {
    const bad = {
      ...draftFor('RESIGNATION_WITH_NOTICE', 'EMP-TEST-001'),
      receivedAt: iso(0),
      confirmedLastDay: iso(10),
      effectiveSeparationAt: iso(2),
    };
    await expect(createDraft(officer.actor, bad)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/before the last working day/i)],
    });
    const ok = await createDraft(officer.actor, {
      ...bad,
      dateOverrideReason: 'Employment ended early by agreement; entered as it happened.',
    });
    expect(ok.caseId).toBeTruthy();
  });
});

describe('changing the separation type never reinterprets a date', () => {
  beforeAll(async () => {
    await resetDb();
    await seedStage3Fixtures();
    officer = await createUser('Change Officer', 'HR_OFFICER');
    manager = await createUser('Change Manager', 'HR_MANAGER');
  });

  it('refuses to carry a contract end date into a resignation', async () => {
    const created = await createDraft(officer.actor, draftFor('CONTRACT_EXPIRY', 'EMP-TEST-001'));
    await expect(
      updateDraft(officer.actor, created.caseId, { departureType: 'RESIGNATION_WITH_NOTICE' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/no longer mean anything/i)],
    });

    // Clearing it is a deliberate act, and it travels WITH the re-type -
    // one edit, so the case is never momentarily invalid against either
    // type's rules.
    await updateDraft(officer.actor, created.caseId, {
      departureType: 'RESIGNATION_WITH_NOTICE',
      contractEndDate: null,
    });
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.departureType).toBe('RESIGNATION_WITH_NOTICE');
    expect(c.contractEndDate).toBeNull();
  });

  it('audits the before and after of every critical separation date', async () => {
    const created = await createDraft(
      officer.actor,
      draftFor('RESIGNATION_WITH_NOTICE', 'EMP-TEST-002'),
    );
    const before = await prisma.offboardingCase.findUniqueOrThrow({
      where: { id: created.caseId },
    });
    await updateDraft(officer.actor, created.caseId, { confirmedLastDay: iso(20) });

    const entry = await prisma.auditEvent.findFirstOrThrow({
      where: { caseId: created.caseId, eventType: 'CASE_UPDATED' },
      orderBy: { occurredAt: 'desc' },
    });
    const metadata = entry.metadata as Record<string, string>;
    expect(metadata['confirmedLastDay.from']).toBe(before.confirmedLastDay!.toISOString());
    expect(metadata['confirmedLastDay.to']).toEqual(expect.any(String));
    expect(metadata['confirmedLastDay.to']).not.toBe(metadata['confirmedLastDay.from']);
  });

  it('raises the classification when the new type is restricted, never lowers it', async () => {
    const created = await createDraft(
      officer.actor,
      draftFor('RESIGNATION_WITH_NOTICE', 'EMP-TEST-003'),
    );
    await updateDraft(officer.actor, created.caseId, {
      departureType: 'REDUNDANCY',
      effectiveSeparationAt: iso(10),
    });
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.classification).toBe('RESTRICTED');
  });
});

describe('notice is recorded only where a period is actually served', () => {
  beforeAll(async () => {
    await resetDb();
    await seedStage3Fixtures();
    officer = await createUser('Notice Officer', 'HR_OFFICER');
  });

  it('counts notice days for a resignation with notice', async () => {
    const created = await createDraft(
      officer.actor,
      draftFor('RESIGNATION_WITH_NOTICE', 'EMP-TEST-001'),
    );
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.noticeProvidedDays).toBeGreaterThan(0);
  });

  it('records none for an immediate resignation or a termination', async () => {
    for (const [type, employee] of [
      ['IMMEDIATE_RESIGNATION', 'EMP-TEST-002'],
      ['TERMINATION', 'EMP-TEST-003'],
    ] as const) {
      const created = await createDraft(officer.actor, draftFor(type, employee));
      const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
      // Null, not zero: zero would read as "no notice given" rather than
      // "notice is not a concept for this separation".
      expect(c.noticeProvidedDays).toBeNull();
    }
  });
});
