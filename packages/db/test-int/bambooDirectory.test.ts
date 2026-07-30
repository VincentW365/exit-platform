/**
 * Directive 5.1 integration: read-only adapter surface, DB-backed employee
 * search with audited-but-content-free events, manual-entry fallback, purge/
 * deactivation, live-data banner logic and the scheduled-sync gate.
 *
 * FIXTURE ADAPTER ONLY (G.1/G.2): no live BambooHR data appears anywhere in
 * automated tests; rows labelled BAMBOOHR below carry synthetic identities.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  getBambooAdapter,
  LiveBambooDirectoryAdapter,
  liveDirectoryPresence,
  purgeLiveDirectory,
  scheduledDirectorySyncIfEnabled,
  syncEmployees,
} from '../src/services/bamboohrService.ts';
import {
  createDraft,
  createManualEmployeeSource,
  searchEmployees,
} from '../src/services/caseService.ts';
import { directoryOverview, directoryTechnicalCounts } from '../src/services/directoryService.ts';
import { setSystemConfig } from '../src/services/systemConfigService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let manager: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;
let sysadmin: Awaited<ReturnType<typeof createUser>>;
let itUser: Awaited<ReturnType<typeof createUser>>;

const WRITE_METHOD_PATTERN = /create|update|delete|remove|post|put|patch|write|upload|terminat/i;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Dir Manager', 'HR_MANAGER');
  officer = await createUser('Dir Officer', 'HR_OFFICER');
  sysadmin = await createUser('Dir Sysadmin', 'SYSTEM_ADMIN');
  itUser = await createUser('Dir IT', 'IT_RESPONDER');
});

describe('adapter surface is strictly read-only (K.3)', () => {
  it('neither adapter exposes any write-like method', async () => {
    const fixture = await getBambooAdapter();
    for (const cls of [Object.getPrototypeOf(fixture).constructor, LiveBambooDirectoryAdapter]) {
      const methods = Object.getOwnPropertyNames(cls.prototype).filter((m) => m !== 'constructor');
      expect(methods.length).toBeGreaterThan(0);
      for (const m of methods) {
        expect(m, `method ${m} looks like a write operation`).not.toMatch(WRITE_METHOD_PATTERN);
      }
    }
  });

  it('the live adapter fails closed without configuration', async () => {
    await setSystemConfig(sysadmin.actor, 'bamboohr.mode', 'live', 'test: switch to live');
    await expect(getBambooAdapter()).rejects.toMatchObject({ code: 'VALIDATION' });
    await setSystemConfig(sysadmin.actor, 'bamboohr.mode', 'fixture', 'test: back to fixture');
  });
});

describe('DB-backed employee search with content-free auditing (E.1, G.8)', () => {
  it('finds fixture employees before any sync and DB rows after sync', async () => {
    const before = await searchEmployees(officer.actor, 'avery');
    expect(before.results.some((r) => r.sourceId === 'EMP-TEST-001')).toBe(true);

    const sync = await syncEmployees(sysadmin.actor);
    expect(sync.mode).toBe('fixture');
    expect(sync.retrieved).toBeGreaterThan(0);

    const after = await searchEmployees(officer.actor, 'Sales');
    const avery = after.results.find((r) => r.sourceId === 'EMP-TEST-001');
    expect(avery?.sourceSystem).toBe('SYNTHETIC');
    expect(avery?.lastSyncedAt).not.toBeNull();
  });

  it('records an audit event WITHOUT the query text or result content', async () => {
    await searchEmployees(officer.actor, 'Morgan Reed');
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'EMPLOYEE_DIRECTORY_SEARCHED', actorId: officer.userId },
      orderBy: { occurredAt: 'desc' },
    });
    const metadata = JSON.stringify(event.metadata);
    expect(metadata).toContain('queryLength');
    expect(metadata).toContain('resultCount');
    expect(metadata).not.toContain('Morgan');
    expect(metadata).not.toContain('Reed');
  });

  it('is refused for non-HR roles (K.6)', async () => {
    await expect(searchEmployees(itUser.actor, 'avery')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(searchEmployees(sysadmin.actor, 'avery')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('manual-entry fallback (E.8, K.7/K.8)', () => {
  it('creates a MANUAL source record usable for case intake', async () => {
    const { sourceId } = await createManualEmployeeSource(officer.actor, {
      displayName: 'Manual Testperson',
      workEmail: 'manual.testperson@example.test',
      jobTitle: 'Storeroom Assistant',
      department: 'Warehouse',
      location: 'Kingston',
    });
    expect(sourceId).toMatch(/^MAN-\d{4}-/);

    const found = await searchEmployees(officer.actor, 'Manual Testperson');
    expect(found.results.find((r) => r.sourceId === sourceId)?.sourceSystem).toBe('MANUAL');

    const created = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: sourceId,
      recordPurpose: 'TEST',
      measurementCohort: null,
    });
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.employeeSourceSystem).toBe('MANUAL');
    expect(c.employeeDisplayName).toBe('Manual Testperson');
  });
});

describe('live-cache purge and banner logic (G.4/G.5/G.6, K.13/K.14)', () => {
  it('anonymizes live-labelled rows without touching cases or snapshots', async () => {
    // Synthetic rows deliberately labelled as live-source for this test.
    await prisma.employeeSourceRecord.createMany({
      data: [
        {
          sourceSystem: 'BAMBOOHR',
          sourceId: 'LIVE-TEST-001',
          displayName: 'Livecache Person One',
          workEmail: 'livecache.one@example.test',
          jobTitle: 'Clerk',
          department: 'Sales',
          location: 'Kingston',
          retrievedAt: new Date(),
          payload: { active: true, managerName: 'Someone Synthetic' },
        },
        {
          sourceSystem: 'BAMBOOHR',
          sourceId: 'LIVE-TEST-002',
          displayName: 'Livecache Person Two',
          workEmail: 'livecache.two@example.test',
          jobTitle: 'Clerk',
          department: 'Sales',
          location: 'Kingston',
          retrievedAt: new Date(),
          payload: { active: true },
        },
      ],
    });

    // Banner shows while unpurged live rows exist.
    expect((await liveDirectoryPresence()).present).toBe(true);

    // One row becomes referenced by a TEST case.
    const created = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'LIVE-TEST-001',
      recordPurpose: 'TEST',
      measurementCohort: null,
    });
    const before = await prisma.offboardingCase.findUniqueOrThrow({
      where: { id: created.caseId },
    });
    expect(before.employeeDisplayName).toBe('Livecache Person One');

    const purge = await purgeLiveDirectory(sysadmin.actor);
    expect(purge.anonymized).toBe(2);
    expect(purge.referencedKept).toBe(1);

    // PII is gone from BOTH rows; identifiers remain for referenced linkage.
    const rows = await prisma.employeeSourceRecord.findMany({
      where: { sourceSystem: 'BAMBOOHR' },
      orderBy: { sourceId: 'asc' },
    });
    for (const row of rows) {
      expect(row.displayName.startsWith('PURGED-')).toBe(true);
      expect(row.workEmail).toBeNull();
      expect(row.jobTitle).toBeNull();
    }

    // The case and its immutable data are untouched (D.10/G.6).
    const after = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(after.employeeDisplayName).toBe('Livecache Person One');

    // Banner clears once everything is purged.
    expect((await liveDirectoryPresence()).present).toBe(false);

    // Purged rows never resolve for new case intake.
    await expect(
      createDraft(officer.actor, {
        ...VALID_DRAFT,
        employeeSourceId: 'LIVE-TEST-002',
        recordPurpose: 'TEST',
        measurementCohort: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('directory views and scheduled-sync gate (F, D.2)', () => {
  it('HR directory overview works; technical counts carry no names', async () => {
    const overview = await directoryOverview(manager.actor);
    expect(overview.totals.records).toBeGreaterThan(0);
    expect(overview.totals.purged).toBe(2);
    await expect(directoryOverview(sysadmin.actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const tech = await directoryTechnicalCounts();
    expect(JSON.stringify(tech)).not.toContain('Livecache');
    expect(tech.liveRecords).toBe(0); // purged rows no longer count as live
  });

  it('scheduled sync stays disabled unless explicitly enabled', async () => {
    expect(await scheduledDirectorySyncIfEnabled()).toBe('disabled');
    await setSystemConfig(sysadmin.actor, 'bamboohr.scheduledSync', true, 'test: enable schedule');
    expect(await scheduledDirectorySyncIfEnabled()).toBe('ran');
    await setSystemConfig(sysadmin.actor, 'bamboohr.scheduledSync', false, 'test: disable again');
    expect(await scheduledDirectorySyncIfEnabled()).toBe('disabled');
  });
});
