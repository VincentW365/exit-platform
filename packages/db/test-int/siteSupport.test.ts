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
  storageStatus,
  uploadLimitStatus,
  workerStatus,
} from '../src/services/siteSupportService.ts';
import { ServiceError } from '../src/errors.ts';
import {
  setStorageForTests,
  STORAGE_READ_UNAVAILABLE,
  STORAGE_WRITE_UNAVAILABLE,
  storageRead,
  storageWrite,
  type StorageAdapter,
} from '../src/storage.ts';
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
    expect(all.storage).toMatchObject({ adapter: 'local-dev', ok: true });
  });

  it('says whether the document store answers, and a dead store fails in words', async () => {
    expect(await storageStatus()).toMatchObject({ adapter: 'local-dev', ok: true });

    const dead: StorageAdapter = {
      name: 's3',
      put: async () => {
        throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid');
      },
      get: async () => {
        throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid');
      },
      health: async () => ({ ok: false, detail: 'bucket unreachable: ENOTFOUND' }),
    };
    setStorageForTests(dead);
    try {
      expect(await storageStatus()).toEqual({
        adapter: 's3',
        ok: false,
        detail: 'bucket unreachable: ENOTFOUND',
      });
      const key = 'branding/' + 'a'.repeat(48);
      await expect(storageWrite(key, new Uint8Array([1]))).rejects.toMatchObject({
        name: 'ServiceError',
        code: 'CONFLICT',
        message: STORAGE_WRITE_UNAVAILABLE,
      });
      await expect(storageRead(key)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: STORAGE_READ_UNAVAILABLE,
      });
      // The words name no host, key or URL.
      expect(STORAGE_WRITE_UNAVAILABLE).not.toMatch(/ENOTFOUND|invalid|http/);
      expect(new ServiceError('CONFLICT', STORAGE_WRITE_UNAVAILABLE).message).toContain(
        'Document storage',
      );
      // A store that never answers is reported, not waited for.
      setStorageForTests({
        name: 's3',
        put: async () => undefined,
        get: async () => Buffer.alloc(0),
        health: () => new Promise(() => undefined),
      });
      expect(await storageStatus(50)).toMatchObject({ ok: false, detail: /no answer/ });
    } finally {
      setStorageForTests(undefined);
    }
  });
});
