/**
 * DEC-073: a saved secret the data key cannot read fails softly, in plain
 * words, and the System page can count such values. Owner report,
 * 2026-11-10: Review and approve crashed on the first saved address it tried
 * to read after the data key had changed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EXTERNAL_RECIPIENT_CLASSES, maskDestination, NOTIFICATION_TYPES } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import {
  dataKeyFingerprint,
  decryptValue,
  encryptValue,
  tryDecryptValue,
  UnreadableSecretError,
} from '../src/secretBox.ts';
import { listRecipients, resolveUsableRecipient } from '../src/services/recipientService.ts';
import { routingEnvironment } from '../src/services/routingService.ts';
import { dataKeyStatus } from '../src/services/siteSupportService.ts';
import { createUser, resetDb } from './helpers.ts';

/** What a value saved under another key looks like to this one: the tag no longer matches. */
function savedUnderAnotherKey(plaintext: string): string {
  const [v, iv, tag, data] = encryptValue(plaintext).split(':');
  const flipped = (tag![0] === 'A' ? 'B' : 'A') + tag!.slice(1);
  return [v, iv, flipped, data].join(':');
}

let manager: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Key Manager', 'HR_MANAGER');
});

async function saveRecipient(recipientClass: string, destination: string, ciphertext: string) {
  return getPrisma().recipientConfig.create({
    data: {
      recipientClass: recipientClass as never,
      displayName: `${recipientClass} mailbox`,
      destinationCiphertext: ciphertext,
      destinationMask: maskDestination(destination),
      environment: routingEnvironment(),
      allowedTypes: [...NOTIFICATION_TYPES],
      isExternal: (EXTERNAL_RECIPIENT_CLASSES as readonly string[]).includes(recipientClass),
      approvalStatus: 'APPROVED',
      approvedById: manager.userId,
      approvedAt: new Date(),
      verifiedAt: new Date(),
      changeReason: 'test',
      createdById: manager.userId,
      ownerId: manager.userId,
    },
  });
}

describe('saved secrets under a changed data key (DEC-073)', () => {
  it('round-trips under the current key and names the failure under another', () => {
    expect(decryptValue(encryptValue('it@example.test'))).toBe('it@example.test');
    expect(() => decryptValue(savedUnderAnotherKey('it@example.test'))).toThrow(
      UnreadableSecretError,
    );
    expect(() => decryptValue('not-a-ciphertext')).toThrow(UnreadableSecretError);
    expect(tryDecryptValue(savedUnderAnotherKey('it@example.test'))).toBeNull();
    expect(tryDecryptValue(encryptValue('ok'))).toBe('ok');
    expect(dataKeyFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    expect(dataKeyFingerprint()).toBe(dataKeyFingerprint());
  });

  it('an unreadable address is an unusable recipient, said plainly - never a crash', async () => {
    await saveRecipient(
      'IT_OFFBOARDING',
      'it@example.test',
      savedUnderAnotherKey('it@example.test'),
    );
    await saveRecipient(
      'FINANCE_OFFBOARDING',
      'fin@example.test',
      encryptValue('fin@example.test'),
    );
    const type = NOTIFICATION_TYPES[0]!;

    const unreadable = await resolveUsableRecipient('IT_OFFBOARDING', type);
    expect('errors' in unreadable).toBe(true);
    if ('errors' in unreadable) {
      expect(unreadable.errors[0]).toMatch(/cannot be read with this site's data key/);
      expect(unreadable.errors[0]).toMatch(/Administration > Recipients/);
    }
    const readable = await resolveUsableRecipient('FINANCE_OFFBOARDING', type);
    expect('destination' in readable && readable.destination).toBe('fin@example.test');

    // The Recipients page learns which rows it can read - never the address.
    const listed = await listRecipients(manager.actor);
    const byClass = Object.fromEntries(listed.map((r) => [r.recipientClass, r]));
    expect(byClass['IT_OFFBOARDING']).toMatchObject({ readable: false });
    expect(byClass['FINANCE_OFFBOARDING']).toMatchObject({ readable: true });
    expect(JSON.stringify(listed)).not.toContain('fin@example.test');
  });

  it('the System page can say how many saved values this key reads', async () => {
    expect(await dataKeyStatus()).toMatchObject({
      fingerprint: dataKeyFingerprint(),
      savedAddresses: 2,
      unreadableAddresses: 1,
      state: 'changed',
    });
    await getPrisma().recipientConfig.updateMany({
      where: { recipientClass: 'IT_OFFBOARDING' },
      data: { destinationCiphertext: encryptValue('it@example.test') },
    });
    expect(await dataKeyStatus()).toMatchObject({ unreadableAddresses: 0, state: 'current' });
  });
});
