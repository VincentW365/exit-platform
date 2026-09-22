/**
 * Employee directory synchronization engine (owner directive, 2026-09-15,
 * section 35): initial sync, new / updated employee, manager change,
 * inactive employee kept, webhook follow-up and duplicate events, source
 * outage with the cache still searchable, recovery, lease and manual-refresh
 * de-duplication, local-only case search and existing-case protection.
 *
 * FIXTURE ADAPTER ONLY: every row here is a synthetic identity.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  setBambooFixtureForTests,
  syncEmployees,
  type BambooEmployee,
} from '../src/services/bamboohrService.ts';
import {
  abandonStaleRuns,
  acquireDirectorySyncLease,
  directorySyncStatus,
  directorySyncTick,
  listDirectorySyncRuns,
  releaseDirectorySyncLease,
  requestDirectorySync,
  runDirectorySyncNow,
  runQueuedDirectorySyncs,
} from '../src/services/directorySyncService.ts';
import {
  casesForEmployee,
  findDirectoryRecordBySourceId,
  getDirectoryProfile,
  listDirectory,
} from '../src/services/directoryListService.ts';
import { createDraft, searchEmployees } from '../src/services/caseService.ts';
import { setSystemConfig } from '../src/services/systemConfigService.ts';
import { createUser, resetDb, seedStage3Fixtures, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let admin: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;

const row = (
  sourceId: string,
  displayName: string,
  extra: Partial<BambooEmployee> = {},
): BambooEmployee => ({
  sourceId,
  displayName,
  workEmail: `${sourceId.toLowerCase()}@example.test`,
  jobTitle: 'Parts Associate',
  department: 'Sales',
  location: 'Kingston',
  active: true,
  managerName: null,
  managerSourceId: null,
  division: null,
  employeeNumber: sourceId.replace('DIR-', '9'),
  ...extra,
});

/** A small synthetic organization: a manager, two reports, and an alternate manager. */
const ORG: BambooEmployee[] = [
  row('DIR-001', 'Morgan Lead', {
    jobTitle: 'Sales Manager',
    firstName: 'Morgan',
    lastName: 'Lead',
  }),
  row('DIR-002', 'Casey Two', {
    managerSourceId: 'DIR-001',
    managerName: 'Morgan Lead',
    firstName: 'Casey',
    lastName: 'Two',
  }),
  row('DIR-003', 'Riley Three', {
    managerSourceId: 'DIR-001',
    managerName: 'Morgan Lead',
    firstName: 'Riley',
    lastName: 'Three',
    hireDate: '2021-03-15',
    workPhone: '876-555-0100',
    workExtension: '12',
  }),
  row('DIR-004', 'Jordan Alt', {
    jobTitle: 'Warehouse Manager',
    department: 'Warehouse',
    firstName: 'Jordan',
    lastName: 'Alt',
  }),
];

const rec = (sourceId: string) =>
  prisma.employeeSourceRecord.findUniqueOrThrow({
    where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId } },
  });

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  admin = await createUser('Dir Sync Admin', 'HR_MANAGER');
  outsider = await createUser('Dir Sync Outsider');
  manager = await createUser('Dir Sync Manager', 'HR_MANAGER');
  officer = await createUser('Dir Sync Officer', 'HR_OFFICER');
  await setSystemConfig(admin.actor, 'bamboohr.mode', 'fixture', 'directory sync tests');
  await setSystemConfig(admin.actor, 'bamboohr.simulateOutage', false, 'directory sync tests');
  setBambooFixtureForTests(ORG);
});

describe('initial synchronization', () => {
  it('mirrors every employee with the directory fields and links managers by identifier', async () => {
    const r = await runDirectorySyncNow({ kind: 'MANUAL', actor: admin.actor });
    expect(r.status).toBe('SUCCESS');
    expect(r.mode).toBe('fixture');
    expect(r.added).toBeGreaterThanOrEqual(4);
    expect(r.failed).toBe(0);
    const lead = await rec('DIR-001');
    const two = await rec('DIR-002');
    const three = await rec('DIR-003');
    expect(two.managerDirectoryId).toBe(lead.id);
    expect(three.managerDirectoryId).toBe(lead.id);
    expect(three.firstName).toBe('Riley');
    expect(three.lastName).toBe('Three');
    expect(three.hireDate?.toISOString().slice(0, 10)).toBe('2021-03-15');
    expect(three.workPhone).toBe('876-555-0100');
    expect(three.workExtension).toBe('12');
    expect(three.employmentStatus).toBe('Active');
    expect(three.lastSyncedAt).not.toBeNull();
    expect(three.archivedAt).toBeNull();
    const run = await prisma.directorySyncRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.kind).toBe('MANUAL');
    expect(run.status).toBe('SUCCESS');
    expect(run.requestedById).toBe(admin.userId);
    expect(run.checked).toBe(r.checked);
  });

  it('the status view reports a current directory with counts only', async () => {
    const s = await directorySyncStatus();
    expect(s.mode).toBe('fixture');
    expect(s.employees).toBeGreaterThanOrEqual(4);
    expect(s.freshness.state).toBe('CURRENT');
    expect(s.connection).toBe('HEALTHY');
    expect(s.lastFullAt).not.toBeNull();
    expect(s.lastRun?.status).toBe('SUCCESS');
    expect(JSON.stringify(s)).not.toContain('Morgan');
  });
});

describe('changes arrive', () => {
  it('a new employee is added by the hourly reconciliation', async () => {
    setBambooFixtureForTests([
      ...ORG,
      row('DIR-005', 'Sam Five', { managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }),
    ]);
    const r = await runDirectorySyncNow({ kind: 'HOURLY' });
    expect(r.status).toBe('SUCCESS');
    expect(r.added).toBe(1);
    const five = await rec('DIR-005');
    expect(five.managerDirectoryId).toBe((await rec('DIR-004')).id);
  });

  it('an updated employee changes only the changed fields and records their NAMES', async () => {
    const updated = ORG.map((e) =>
      e.sourceId === 'DIR-002'
        ? { ...e, jobTitle: 'Senior Parts Associate', workEmail: 'casey.two@example.test' }
        : e,
    );
    setBambooFixtureForTests([
      ...updated,
      row('DIR-005', 'Sam Five', { managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }),
    ]);
    const r = await runDirectorySyncNow({ kind: 'HOURLY' });
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBeGreaterThanOrEqual(4);
    const diff = r.diffs.find((d) => d.sourceId === 'DIR-002');
    expect(diff?.changes.sort()).toEqual(['jobTitle', 'workEmail']);
    expect(JSON.stringify(r.diffs)).not.toContain('Senior');
    expect((await rec('DIR-002')).jobTitle).toBe('Senior Parts Associate');
  });

  it('a manager change re-links the reporting line by identifier', async () => {
    const moved = ORG.map((e) =>
      e.sourceId === 'DIR-003'
        ? { ...e, managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }
        : e,
    );
    setBambooFixtureForTests([
      ...moved,
      row('DIR-005', 'Sam Five', { managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }),
    ]);
    const r = await runDirectorySyncNow({ kind: 'MANUAL', actor: admin.actor });
    expect(r.status).toBe('SUCCESS');
    const three = await rec('DIR-003');
    expect(three.managerDirectoryId).toBe((await rec('DIR-004')).id);
    expect(three.managerName).toBe('Jordan Alt');
    const profile = await getDirectoryProfile(manager.actor, three.id);
    expect(profile?.manager?.sourceId).toBe('DIR-004');
    const lead = await getDirectoryProfile(manager.actor, (await rec('DIR-001')).id);
    expect(lead?.reports.map((p) => p.sourceId)).toEqual(['DIR-002']);
  });

  it('an employee no longer in the feed is archived, never deleted, and the cases pointing at them stay', async () => {
    // DIR-005 has a draft case; the feed then stops listing them.
    const draft = await createDraft(officer.actor, { ...VALID_DRAFT, employeeSourceId: 'DIR-005' });
    const feed = ORG.map((e) =>
      e.sourceId === 'DIR-003'
        ? { ...e, managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }
        : e,
    );
    setBambooFixtureForTests(feed); // DIR-005 absent
    const r = await runDirectorySyncNow({ kind: 'NIGHTLY' });
    expect(r.status).toBe('SUCCESS');
    expect(r.archived).toBe(1);
    const five = await rec('DIR-005');
    expect(five.active).toBe(false);
    expect(five.archivedAt).not.toBeNull();
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: draft.caseId } });
    expect(c.employeeSourceId).toBe('DIR-005');
    // Default directory view hides them; "all" still finds them, marked Archived.
    const active = await listDirectory(manager.actor, { q: 'Sam Five' });
    expect(active.rows).toHaveLength(0);
    const all = await listDirectory(manager.actor, { q: 'Sam Five', status: 'all' });
    expect(all.rows[0]?.status).toBe('Archived');
    // Reappearing in the feed restores the record in place - same id.
    setBambooFixtureForTests([
      ...feed,
      row('DIR-005', 'Sam Five', { managerSourceId: 'DIR-004', managerName: 'Jordan Alt' }),
    ]);
    const back = await runDirectorySyncNow({ kind: 'NIGHTLY' });
    expect(back.updated).toBe(1);
    const again = await rec('DIR-005');
    expect(again.id).toBe(five.id);
    expect(again.archivedAt).toBeNull();
    expect(again.active).toBe(true);
  });
});

describe('webhook follow-up (sections 10-11)', () => {
  it('a webhook run re-reads ONLY the named employee and is idempotent on repeat', async () => {
    const before = await prisma.employeeSourceRecord.count({
      where: { sourceSystem: 'SYNTHETIC' },
    });
    setBambooFixtureForTests(
      ORG.map((e) => (e.sourceId === 'DIR-002' ? { ...e, department: 'Counter Sales' } : e)),
    );
    const first = await requestDirectorySync({
      kind: 'WEBHOOK',
      employeeSourceIds: ['DIR-002'],
      changedFields: ['department'],
    });
    expect(first.runIds).toHaveLength(1);
    const ran = await runQueuedDirectorySyncs({ holder: 'test-webhook-1' });
    expect(ran.skipped).toBeNull();
    const r1 = ran.executed.find((x) => x.runId === first.runIds[0]);
    expect(r1?.status).toBe('SUCCESS');
    expect(r1?.checked).toBe(1);
    expect(r1?.updated).toBe(1);
    expect((await rec('DIR-002')).department).toBe('Counter Sales');
    // The same event delivered again changes nothing and creates nothing.
    const second = await requestDirectorySync({ kind: 'WEBHOOK', employeeSourceIds: ['DIR-002'] });
    const ran2 = await runQueuedDirectorySyncs({ holder: 'test-webhook-2' });
    const r2 = ran2.executed.find((x) => x.runId === second.runIds[0]);
    expect(r2?.status).toBe('SUCCESS');
    expect(r2?.unchanged).toBe(1);
    expect(r2?.added).toBe(0);
    const after = await prisma.employeeSourceRecord.count({ where: { sourceSystem: 'SYNTHETIC' } });
    expect(after).toBe(before);
    const runs = await listDirectorySyncRuns(manager.actor, {
      kind: 'WEBHOOK',
      employee: 'DIR-002',
    });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]?.employee?.displayName).toBe('Casey Two');
    expect(runs.every((x) => x.employeeSourceId === 'DIR-002')).toBe(true);
  });

  it('a webhook for an employee the source no longer returns archives the record', async () => {
    setBambooFixtureForTests(ORG.filter((e) => e.sourceId !== 'DIR-004'));
    await requestDirectorySync({ kind: 'WEBHOOK', employeeSourceIds: ['DIR-004'] });
    const ran = await runQueuedDirectorySyncs({ holder: 'test-webhook-3' });
    expect(ran.executed[0]?.archived).toBe(1);
    expect((await rec('DIR-004')).archivedAt).not.toBeNull();
    setBambooFixtureForTests(ORG);
    await runDirectorySyncNow({ kind: 'MANUAL', actor: admin.actor });
    expect((await rec('DIR-004')).archivedAt).toBeNull();
  });
});

describe('source outage (sections 18 and 37)', () => {
  it('a failed run leaves the cache untouched, the directory searchable and the status honest', async () => {
    const before = await prisma.employeeSourceRecord.findMany({
      where: { sourceSystem: 'SYNTHETIC' },
      orderBy: { sourceId: 'asc' },
    });
    await setSystemConfig(
      admin.actor,
      'bamboohr.simulateOutage',
      true,
      'directory sync tests: outage',
    );
    const r = await runDirectorySyncNow({ kind: 'MANUAL', actor: admin.actor });
    expect(r.status).toBe('FAILED');
    expect(r.errorCode).toBe('NETWORK_ERROR');
    const after = await prisma.employeeSourceRecord.findMany({
      where: { sourceSystem: 'SYNTHETIC' },
      orderBy: { sourceId: 'asc' },
    });
    expect(
      after.map((x) => [x.sourceId, x.displayName, x.jobTitle, x.lastSyncedAt?.toISOString()]),
    ).toEqual(
      before.map((x) => [x.sourceId, x.displayName, x.jobTitle, x.lastSyncedAt?.toISOString()]),
    );
    // Local reads carry on - none of them touch the source.
    const list = await listDirectory(manager.actor, { q: 'Casey' });
    expect(list.rows.map((x) => x.sourceId)).toContain('DIR-002');
    const search = await searchEmployees(officer.actor, 'Riley');
    expect(search.results.map((x) => x.sourceId)).toContain('DIR-003');
    const s = await directorySyncStatus();
    expect(s.connection).toBe('FAILING');
    expect(s.simulatedOutage).toBe(true);
    expect(s.freshness.state).toBe('CURRENT'); // the last SUCCESSFUL sync is recent
    expect(s.employees).toBeGreaterThanOrEqual(4);
    // The legacy entry point reports the failure without pretending.
    await expect(syncEmployees(admin.actor)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('recovers on the next run once the source is back', async () => {
    await setSystemConfig(
      admin.actor,
      'bamboohr.simulateOutage',
      false,
      'directory sync tests: recovered',
    );
    const r = await runDirectorySyncNow({ kind: 'MANUAL', actor: admin.actor });
    expect(r.status).toBe('SUCCESS');
    expect((await directorySyncStatus()).connection).toBe('HEALTHY');
    const runs = await listDirectorySyncRuns(admin.actor, { errorsOnly: true });
    expect(runs.some((x) => x.errorCode === 'NETWORK_ERROR')).toBe(true);
    expect(runs.every((x) => x.status === 'FAILED' || x.failed > 0)).toBe(true);
  });
});

describe('concurrency and de-duplication (sections 17 and 31)', () => {
  it('two manual refreshes queue one run', async () => {
    const a = await requestDirectorySync({ kind: 'MANUAL', actor: admin.actor });
    const b = await requestDirectorySync({ kind: 'MANUAL', actor: admin.actor });
    expect(b.reused).toBe(true);
    expect(b.runIds).toEqual(a.runIds);
    const queued = await prisma.directorySyncRun.count({ where: { status: 'QUEUED' } });
    expect(queued).toBe(1);
    // An hourly request joins the queued manual run too.
    const c = await requestDirectorySync({ kind: 'HOURLY' });
    expect(c.reused).toBe(true);
    const ran = await runQueuedDirectorySyncs({ holder: 'test-dedupe' });
    expect(ran.executed.map((x) => x.runId)).toEqual(a.runIds);
  });

  it('a run cannot start while another process holds the lease', async () => {
    expect(await acquireDirectorySyncLease('other-process')).toBe(true);
    try {
      await requestDirectorySync({ kind: 'HOURLY' });
      const ran = await runQueuedDirectorySyncs({ holder: 'me' });
      expect(ran.skipped).toBe('locked');
      expect(ran.executed).toHaveLength(0);
      expect(await prisma.directorySyncRun.count({ where: { status: 'QUEUED' } })).toBe(1);
    } finally {
      await releaseDirectorySyncLease('other-process');
    }
    const ran = await runQueuedDirectorySyncs({ holder: 'me' });
    expect(ran.executed).toHaveLength(1);
  });

  it('a run abandoned by a dead process is closed so it cannot block later refreshes', async () => {
    const stale = await prisma.directorySyncRun.create({
      data: {
        kind: 'MANUAL',
        status: 'RUNNING',
        requestedAt: new Date(Date.now() - 20 * 60_000),
        startedAt: new Date(Date.now() - 19 * 60_000),
        correlationId: 'test-stale',
      },
    });
    expect(await abandonStaleRuns()).toBeGreaterThanOrEqual(1);
    const closed = await prisma.directorySyncRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(closed.status).toBe('FAILED');
    expect(closed.errorCode).toBe('ABANDONED');
    const fresh = await requestDirectorySync({ kind: 'MANUAL', actor: admin.actor });
    expect(fresh.reused).toBe(false);
    await runQueuedDirectorySyncs({ holder: 'after-stale' });
  });

  it('the worker tick queues nothing while the mirror is fresh and honours the master switch', async () => {
    await setSystemConfig(admin.actor, 'bamboohr.scheduledSync', true, 'directory sync tests');
    const t = await directorySyncTick(new Date());
    expect(t.queued).toEqual([]);
    await setSystemConfig(admin.actor, 'bamboohr.scheduledSync', false, 'directory sync tests');
    const t2 = await directorySyncTick(new Date(Date.now() + 26 * 3_600_000));
    expect(t2.queued).toEqual([]);
  });
});

describe('directory reads and access control (sections 22-25 and 34)', () => {
  it('search and filters work on local data with active employees by default', async () => {
    const byDept = await listDirectory(manager.actor, { department: 'Warehouse' });
    expect(byDept.rows.map((x) => x.sourceId)).toEqual(['DIR-004']);
    const byMgr = await listDirectory(officer.actor, { managerId: (await rec('DIR-001')).id });
    // After the last full synchronization of ORG, both report to DIR-001 again.
    expect(byMgr.rows.map((x) => x.sourceId).sort()).toEqual(['DIR-002', 'DIR-003']);
    const byNumber = await listDirectory(officer.actor, { q: '9003' });
    expect(byNumber.rows.map((x) => x.sourceId)).toEqual(['DIR-003']);
    expect(byNumber.facets.departments).toContain('Sales');
    expect(byNumber.sync.freshness.state).toBe('CURRENT');
    const rowById = await findDirectoryRecordBySourceId(officer.actor, 'DIR-003');
    expect(rowById?.managerName).toBe('Morgan Lead');
  });

  it('directory reads are HR-only; the synchronization log is for HR Managers (DEC-063)', async () => {
    await expect(listDirectory(outsider.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      getDirectoryProfile(outsider.actor, (await rec('DIR-001')).id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listDirectorySyncRuns(officer.actor, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await listDirectorySyncRuns(manager.actor, { limit: 5 })).not.toHaveLength(0);
  });

  it('an existing live case is surfaced and a second case needs explicit confirmation (DEC-061)', async () => {
    const first = await createDraft(officer.actor, { ...VALID_DRAFT, employeeSourceId: 'DIR-003' });
    const cases = await casesForEmployee(officer.actor, 'DIR-003');
    expect(cases.live.map((c) => c.caseNumber)).toContain(first.caseNumber);
    const profile = await getDirectoryProfile(officer.actor, (await rec('DIR-003')).id);
    expect(profile?.cases.live).toHaveLength(1);
    // The intake without the confirmation ticked is refused...
    await expect(
      createDraft(officer.actor, {
        ...VALID_DRAFT,
        employeeSourceId: 'DIR-003',
        duplicateAcknowledged: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const second = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'DIR-003',
      duplicateAcknowledged: true,
    });
    expect(second.duplicateWarnings.some((w) => w.startsWith(first.caseNumber))).toBe(true);
  });
});

describe('incremental reconciliation (section 13)', () => {
  it('an hourly pass re-reads only new or changed rows and keeps the details the mirror holds', async () => {
    setBambooFixtureForTests(ORG);
    await runDirectorySyncNow({ kind: 'NIGHTLY' });
    const before = await rec('DIR-003');
    expect(before.hireDate).not.toBeNull();
    // A detail-only change (hire date) with an unchanged listing is not seen
    // by the hourly pass - by design; the nightly exhaustive pass sees it.
    const detailOnly = ORG.map((e) =>
      e.sourceId === 'DIR-003' ? { ...e, hireDate: '2022-06-01' } : e,
    );
    setBambooFixtureForTests(detailOnly);
    const hourly = await runDirectorySyncNow({ kind: 'HOURLY' });
    expect(hourly.status).toBe('SUCCESS');
    expect(hourly.updated).toBe(0);
    const afterHourly = await rec('DIR-003');
    expect(afterHourly.hireDate?.toISOString().slice(0, 10)).toBe('2021-03-15');
    expect(afterHourly.workExtension).toBe('12'); // kept, not blanked
    const nightly = await runDirectorySyncNow({ kind: 'NIGHTLY' });
    expect(nightly.updated).toBe(1);
    expect((await rec('DIR-003')).hireDate?.toISOString().slice(0, 10)).toBe('2022-06-01');
    // A listing change (job title) IS picked up by the hourly pass, details included.
    const listingChange = detailOnly.map((e) =>
      e.sourceId === 'DIR-002' ? { ...e, jobTitle: 'Team Lead', hireDate: '2019-02-02' } : e,
    );
    setBambooFixtureForTests(listingChange);
    const hourly2 = await runDirectorySyncNow({ kind: 'HOURLY' });
    expect(hourly2.updated).toBe(1);
    const two = await rec('DIR-002');
    expect(two.jobTitle).toBe('Team Lead');
    expect(two.hireDate?.toISOString().slice(0, 10)).toBe('2019-02-02');
  });
});
