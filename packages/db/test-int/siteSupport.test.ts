/**
 * DEC-073: site health for support. The test database is migrated by the
 * integration setup, so it reads as current; the worker is judged by the age
 * of its heartbeat alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { EXPECTED_LATEST_MIGRATION } from '../src/schemaVersion.ts';
import { databaseSchemaStatus, workerStatus } from '../src/services/siteSupportService.ts';
import { resetDb } from './helpers.ts';

beforeAll(async () => {
  await resetDb();
});

describe('site health for support (DEC-073)', () => {
  it('reads the migrated test database as current', async () => {
    expect(await databaseSchemaStatus()).toEqual({
      reachable: true,
      expected: EXPECTED_LATEST_MIGRATION,
      applied: EXPECTED_LATEST_MIGRATION,
      state: 'current',
    });
  });

  it('judges the worker by the age of its heartbeat', async () => {
    expect(await workerStatus()).toEqual({ lastHeartbeatAt: null, ageSeconds: null, alive: false });
    const beat = new Date();
    await getPrisma().systemConfig.upsert({
      where: { key: 'worker.lastHeartbeat' },
      create: { key: 'worker.lastHeartbeat', value: beat.toISOString(), reason: 'test heartbeat' },
      update: { value: beat.toISOString() },
    });
    expect(await workerStatus(new Date(beat.getTime() + 60_000))).toMatchObject({
      ageSeconds: 60,
      alive: true,
    });
    expect((await workerStatus(new Date(beat.getTime() + 600_000))).alive).toBe(false);
  });
});
