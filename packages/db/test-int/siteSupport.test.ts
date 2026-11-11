/**
 * DEC-073: site health for support. The test database is migrated by the
 * integration setup, so it reads as current; the worker is judged by the age
 * of its heartbeat alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { EXPECTED_LATEST_MIGRATION } from '../src/schemaVersion.ts';
import { getConfig, uploadBodyLimitMb } from '@exit/config';
import {
  databaseSchemaStatus,
  siteSupportStatus,
  uploadLimitStatus,
  workerStatus,
} from '../src/services/siteSupportService.ts';
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

  it('says whether the build accepts the files the configuration promises (DEC-075)', async () => {
    const configured = getConfig().MAX_UPLOAD_MB;
    const required = uploadBodyLimitMb(configured);
    expect(uploadLimitStatus(required)).toEqual({
      configuredMb: configured,
      builtBodyLimitMb: required,
      requiredBodyLimitMb: required,
      effectiveMb: configured,
      state: 'ok',
    });
    expect(uploadLimitStatus(required + 40)).toMatchObject({
      state: 'ok',
      effectiveMb: configured,
    });
    // A build made for 1 MB less than the configuration asks for.
    expect(uploadLimitStatus(required - 1)).toMatchObject({
      state: 'build-too-small',
      builtBodyLimitMb: required - 1,
      effectiveMb: configured - 1,
    });
    // Next's own default, on a build that never set the limit.
    expect(uploadLimitStatus(1)).toMatchObject({ state: 'build-too-small' });
    expect(uploadLimitStatus(null)).toMatchObject({ state: 'unknown', effectiveMb: configured });
    expect(uploadLimitStatus(Number.NaN)).toMatchObject({ state: 'unknown' });
    const all = await siteSupportStatus({ builtBodyLimitMb: required });
    expect(all.uploads.state).toBe('ok');
    expect(all.schema.state).toBe('current');
  });
});
