/**
 * DEC-076 (owner decision, 2026-11-17): an address the platform resolved from
 * the case and the directory is accepted outside production while the email
 * provider cannot deliver; a configured address keeps the strict rule. The
 * environment is switched for this file only and restored afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@exit/config';
import { NOTIFICATION_TYPES } from '@exit/domain';
import { upsertRecipient } from '../src/services/recipientService.ts';
import { routedAddressErrors, routingEnvironment } from '../src/services/routingService.ts';
import { createUser, resetDb } from './helpers.ts';

const REAL = 'employee@company.example';
const saved = {
  environment: process.env['APP_ENVIRONMENT'],
  emailMode: process.env['EMAIL_MODE'],
  ack: process.env['UAT_HOSTED_ACK'],
};

function runAs(environment: 'development' | 'uat', emailMode: string): void {
  process.env['APP_ENVIRONMENT'] = environment;
  process.env['EMAIL_MODE'] = emailMode;
  process.env['UAT_HOSTED_ACK'] = environment === 'uat' ? 'true' : 'false';
  resetConfigForTests();
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

let manager: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Route Manager', 'HR_MANAGER');
});

afterAll(() => {
  restore('APP_ENVIRONMENT', saved.environment);
  restore('EMAIL_MODE', saved.emailMode);
  restore('UAT_HOSTED_ACK', saved.ack);
  resetConfigForTests();
});

describe('resolved addresses outside production (DEC-076)', () => {
  it('accepts a real resolved address on a capture provider, in development and hosted uat', () => {
    runAs('development', 'dev-capture');
    expect(routingEnvironment()).toBe('development');
    expect(routedAddressErrors(REAL)).toEqual([]);
    runAs('uat', 'dev-capture');
    expect(routingEnvironment()).toBe('uat');
    expect(routedAddressErrors(REAL)).toEqual([]);
    expect(routedAddressErrors('capture://employee')).toEqual([]);
    expect(routedAddressErrors('not an address')).not.toEqual([]);
  });

  it('refuses the same address the moment a delivering provider is configured', () => {
    runAs('development', 'graph');
    expect(routedAddressErrors(REAL)).toEqual([
      'Development recipients must use capture://, a reserved .test/.invalid domain or localhost - never a deliverable address (D.4/D.6).',
    ]);
    expect(routedAddressErrors('it@example.test')).toEqual([]);
  });

  it('a configured recipient keeps the strict rule under the same capture provider', async () => {
    runAs('development', 'dev-capture');
    await expect(
      upsertRecipient(manager.actor, {
        recipientClass: 'IT_OFFBOARDING',
        displayName: 'IT desk',
        destination: REAL,
        allowedTypes: [NOTIFICATION_TYPES[0]],
        changeReason: 'DEC-076 check: a hand-entered real address stays refused.',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringMatching(/Development recipients must use capture:\/\//)],
    });
  });
});
