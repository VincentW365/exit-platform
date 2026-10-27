/**
 * DEC-072: the BambooHR credential entered on the System page.
 *
 * Fake key only. Proves the key is stored encrypted, never listed or audited,
 * drives the directory to live, can be removed, and is HR Manager only. No
 * request reaches BambooHR: the tests stop at credential resolution.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  STORED_BAMBOO_CREDENTIAL_KEY,
  bambooCredentialStatus,
  normaliseBambooSubdomain,
  removeBambooCredential,
  resolveBambooCredential,
  saveBambooCredential,
} from '../src/services/bambooCredentialService.ts';
import { directoryMode } from '../src/services/directoryModeService.ts';
import { listSystemConfig, setSystemConfig } from '../src/services/systemConfigService.ts';
import { createUser, resetDb } from './helpers.ts';

const prisma = getPrisma();
const FAKE_KEY = 'fake-test-key-0123456789abcdefghijklmnop';

let manager: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Cred Manager', 'HR_MANAGER');
  officer = await createUser('Cred Officer', 'HR_OFFICER');
});

afterAll(async () => {
  await removeBambooCredential(manager.actor);
});

describe('BambooHR connection saved in the application (DEC-072)', () => {
  it('understands the company name however it is typed', () => {
    expect(normaliseBambooSubdomain('acme')).toBe('acme');
    expect(normaliseBambooSubdomain('https://Acme.bamboohr.com/home')).toBe('acme');
    expect(normaliseBambooSubdomain('https://api.bamboohr.com/api/gateway.php/acme/v1')).toBe(
      'acme',
    );
    expect(normaliseBambooSubdomain('not a name!')).toBeNull();
  });

  it('refuses an incomplete key and an unreadable company name, in plain words', async () => {
    await expect(
      saveBambooCredential(manager.actor, { subdomain: 'acme', apiKey: 'short' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      saveBambooCredential(manager.actor, { subdomain: 'bad name!', apiKey: FAKE_KEY }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('is an HR Manager action', async () => {
    await expect(
      saveBambooCredential(officer.actor, { subdomain: 'acme', apiKey: FAKE_KEY }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stores the key encrypted, never lists or audits it, and makes the directory live', async () => {
    await setSystemConfig(manager.actor, 'bamboohr.mode', 'live', 'test: live');
    await saveBambooCredential(manager.actor, {
      subdomain: 'acme.bamboohr.com',
      apiKey: FAKE_KEY,
    });

    const row = await prisma.systemConfig.findUnique({
      where: { key: STORED_BAMBOO_CREDENTIAL_KEY },
    });
    expect(JSON.stringify(row?.value)).not.toContain(FAKE_KEY);

    const resolved = await resolveBambooCredential();
    expect(resolved).toEqual({ key: FAKE_KEY, subdomain: 'acme', source: 'app' });
    expect((await bambooCredentialStatus()).status).toBe('configured');
    expect(await directoryMode()).toBe('live');

    const listed = await listSystemConfig(manager.actor);
    expect(listed.map((c) => c.key)).not.toContain(STORED_BAMBOO_CREDENTIAL_KEY);

    const audit = await prisma.auditEvent.findMany({
      where: { objectType: 'BambooHRCredential' },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(FAKE_KEY);
  });

  it('cannot be overwritten through the generic settings form', async () => {
    await expect(
      setSystemConfig(manager.actor, STORED_BAMBOO_CREDENTIAL_KEY, 'x', 'test'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('can be removed, after which nothing resolves', async () => {
    await removeBambooCredential(manager.actor);
    expect(await resolveBambooCredential()).toBeNull();
    expect((await bambooCredentialStatus()).source).toBeNull();
  });
});
