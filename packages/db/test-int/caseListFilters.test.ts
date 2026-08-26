/**
 * Section 15 (owner design directive): the case list answers the questions
 * HR actually asks it - whose case is this, which department, how close is
 * the departure, how far has it run, and does it need somebody today.
 *
 * The security case matters as much as the feature: a filter is a read, and
 * the values offered in a filter are a read too. A department dropdown built
 * from every case would disclose that a restricted case exists in a
 * department, which is exactly what record-level visibility forbids.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  createDraft,
  listCaseFilterOptions,
  listCases,
  transitionCase,
} from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
} from './helpers.ts';

const prisma = getPrisma();
const DAY = 24 * 60 * 60 * 1000;

let officerA: Awaited<ReturnType<typeof createUser>>;
let officerB: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;

/** A case driven to ACTIVE so it has a workflow, and therefore progress. */
async function activeCase(officer: Awaited<ReturnType<typeof createUser>>) {
  const { caseId } = await createDraft(officer.actor, {
    ...VALID_DRAFT,
    recordPurpose: 'TEST',
    measurementCohort: null,
  });
  await transitionCase(officer.actor, caseId, 'submit');
  await transitionCase(manager.actor, caseId, 'approve');
  await readyAssignment(caseId, manager.actor, officer.userId);
  await activateCase(manager.actor, caseId);
  return caseId;
}

describe('case list filtering (section 15)', () => {
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    await resetDb();
    await seedStage3Fixtures();
    officerA = await createUser('Filter Officer A', 'HR_OFFICER');
    officerB = await createUser('Filter Officer B', 'HR_OFFICER');
    manager = await createUser('Filter Manager', 'HR_MANAGER');
    outsider = await createUser('Filter Outsider', 'IT_RESPONDER');
    mine = await activeCase(officerA);
    theirs = await activeCase(officerB);
  });

  it('filters by the assigned HR officer', async () => {
    const rows = await listCases(officerA.actor, { officer: officerA.userId });
    expect(rows.map((r) => r.id)).toContain(mine);
    expect(rows.map((r) => r.id)).not.toContain(theirs);
  });

  it('filters by department using a value the list itself offers', async () => {
    const options = await listCaseFilterOptions(officerA.actor);
    expect(options.departments.length).toBeGreaterThan(0);
    const rows = await listCases(officerA.actor, { department: options.departments[0] });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.department).toBe(options.departments[0]);
  });

  it('reports progress and outstanding work on every row', async () => {
    const [row] = await listCases(officerA.actor, { officer: officerA.userId });
    expect(row).toBeDefined();
    expect(row!.tasksTotal).toBeGreaterThan(0);
    expect(row!.tasksDone).toBe(0);
    expect(row!.officerName).toBe('Filter Officer A');
  });

  it('finds cases that need attention, by either route into the list', async () => {
    // Activation opens its own exceptions (an unconfigured recipient is a real
    // thing needing somebody), so the open-exception limb is already true.
    const open = await prisma.caseException.count({ where: { caseId: mine, resolvedAt: null } });
    expect(open).toBeGreaterThan(0);
    expect((await listCases(officerA.actor, { attention: 'yes' })).map((r) => r.id)).toContain(
      mine,
    );

    // Close them, and push every due date into the future - some tasks are
    // due from receipt, which the fixture puts 25 days back, so a fresh case
    // is legitimately late on day one. With neither limb true it drops out.
    await prisma.caseException.updateMany({
      where: { caseId: mine, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    await prisma.workflowTask.updateMany({
      where: { caseId: mine },
      data: { dueAt: new Date(Date.now() + 30 * DAY) },
    });
    expect((await listCases(officerA.actor, { attention: 'yes' })).map((r) => r.id)).not.toContain(
      mine,
    );

    // The overdue-task limb brings it back on its own.
    const task = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId: mine, required: true, status: { in: ['READY', 'NOT_READY'] } },
    });
    await prisma.workflowTask.update({
      where: { id: task.id },
      data: { dueAt: new Date(Date.now() - DAY) },
    });
    const rows = await listCases(officerA.actor, { attention: 'yes' });
    expect(rows.map((r) => r.id)).toContain(mine);
    expect(rows.find((r) => r.id === mine)!.tasksOverdue).toBeGreaterThan(0);
  });

  it('bands cases by how far the workflow has run', async () => {
    const notStarted = await listCases(officerA.actor, { progress: 'not-started' });
    expect(notStarted.map((r) => r.id)).toEqual(expect.arrayContaining([mine, theirs]));
    expect(await listCases(officerA.actor, { progress: 'done' })).toHaveLength(0);
  });

  it('offers no filter values at all to somebody who may not list cases', async () => {
    await expect(listCaseFilterOptions(outsider.actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('never offers a restricted case as a filter value to a non-participant', async () => {
    // Make one case restricted and put it in a department of its own. The
    // officer who is not on it must not learn either fact from the dropdown.
    await prisma.offboardingCase.update({
      where: { id: theirs },
      data: { classification: 'RESTRICTED', department: 'Restricted Department' },
    });
    const options = await listCaseFilterOptions(officerA.actor);
    expect(options.departments).not.toContain('Restricted Department');
    expect(options.officers.map((o) => o.displayName)).not.toContain('Filter Officer B');

    // ...and the participant on it still sees both.
    const theirOptions = await listCaseFilterOptions(officerB.actor);
    expect(theirOptions.departments).toContain('Restricted Department');
  });
});
