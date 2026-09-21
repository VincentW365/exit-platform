/**
 * Directive 5.1 integration: read-only adapter surface, DB-backed employee
 * search with audited-but-content-free events, manual-entry fallback, purge/
 * deactivation, live-data banner logic and the scheduled-sync gate.
 *
 * FIXTURE ADAPTER ONLY (G.1/G.2): no live BambooHR data appears anywhere in
 * automated tests; rows labelled BAMBOOHR below carry synthetic identities.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BAMBOO_ALLOWED_SOURCE_FIELDS } from '@exit/domain';
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

// The directory feed carries BambooHR's internal record id, while HR quotes
// the "Employee #" from the employee's record - different values entirely
// (owner question, 2026-08-18). Both must find the person. Runs last: it adds
// a directory row, and earlier assertions in this file count them.
describe('employee search by HR-assigned Employee #', () => {
  it('finds the employee by Employee # as well as by record id', async () => {
    await prisma.employeeSourceRecord.upsert({
      where: { sourceSystem_sourceId: { sourceSystem: 'BAMBOOHR', sourceId: '900001' } },
      create: {
        sourceSystem: 'BAMBOOHR',
        sourceId: '900001',
        displayName: 'Robin Fictional',
        jobTitle: 'Parts Sales Associate',
        department: 'Sales',
        location: 'Molynes Road',
        employeeNumber: 'M900',
        retrievedAt: new Date(),
        payload: {},
      },
      update: { employeeNumber: 'M900' },
    });

    const byEmployeeNumber = await searchEmployees(officer.actor, 'M900');
    const hit = byEmployeeNumber.results.find((r) => r.sourceId === '900001');
    expect(hit?.employeeNumber).toBe('M900');

    // The internal record id keeps working, and the two are not the same value.
    const byRecordId = await searchEmployees(officer.actor, '900001');
    expect(byRecordId.results.map((r) => r.sourceId)).toContain('900001');
    expect(hit?.employeeNumber).not.toBe(hit?.sourceId);
  });
});

/**
 * Employee directory (2026-09-15): the stand-alone per-employee read that a
 * webhook follow-up uses. Proven against a stubbed HTTP layer - no network -
 * because the first live evidence run showed the read asking for detail
 * fields only, the mapper finding no name, and a live employee being archived
 * as "no longer returned".
 */
describe('live per-employee read (webhook follow-up) - stubbed HTTP', () => {
  const adapter = Object.create(LiveBambooDirectoryAdapter.prototype) as LiveBambooDirectoryAdapter;
  Object.assign(adapter, { subdomain: 'synthetic', authHeader: 'Basic c3ludGhldGljOng=' });
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const respond = (handler: (url: string) => { status: number; body: unknown }) => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      requested.push(url);
      const r = handler(url);
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  };
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('asks for the whole approved field set and maps a complete row', async () => {
    requested.length = 0;
    respond(() => ({
      status: 200,
      body: {
        id: '9001',
        displayName: 'Avery Brown',
        firstName: 'Avery',
        lastName: 'Brown',
        workEmail: 'avery.brown@example.test',
        jobTitle: 'Parts Sales Associate',
        department: 'Sales',
        location: 'Kingston',
        supervisor: 'Operations Manager',
        supervisorEId: '9007',
        status: 'Active',
        employeeNumber: '1001',
        hireDate: '2020-01-06',
        workPhoneExtension: '12',
        lastChanged: '2026-09-01T10:00:00+00:00',
      },
    }));
    const rows = await adapter.getEmployees(['9001']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: '9001',
      displayName: 'Avery Brown',
      managerSourceId: '9007',
      employeeNumber: '1001',
      hireDate: '2020-01-06',
      workExtension: '12',
      active: true,
    });
    const url = new URL(requested[0]!);
    const fields = (url.searchParams.get('fields') ?? '').split(',');
    for (const f of [
      'displayName',
      'firstName',
      'lastName',
      'workEmail',
      'jobTitle',
      'supervisor',
      'status',
      'employeeNumber',
      'hireDate',
    ])
      expect(fields).toContain(f);
    for (const f of fields) expect(BAMBOO_ALLOWED_SOURCE_FIELDS as readonly string[]).toContain(f);
    expect(fields).not.toContain('id');
  });

  it('a row the mapper cannot use is a BAD_RESPONSE failure, never a departure', async () => {
    respond(() => ({ status: 200, body: { id: '9001', employeeNumber: '1001' } }));
    await expect(adapter.getEmployees(['9001'])).rejects.toMatchObject({
      details: ['BambooHR request failed: BAD_RESPONSE.'],
    });
  });

  it('only a genuine 404 means the source no longer returns the employee', async () => {
    respond(() => ({ status: 404, body: {} }));
    expect(await adapter.getEmployees(['9999'])).toEqual([]);
    respond(() => ({ status: 503, body: {} }));
    await expect(adapter.getEmployees(['9001'])).rejects.toMatchObject({
      details: ['BambooHR request failed: UPSTREAM_ERROR.'],
    });
  });
});
