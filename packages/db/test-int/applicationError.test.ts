/**
 * DEC-073: unexpected errors recorded for the System page. Proves the record
 * carries the reference, a bounded and redacted message and the route pattern
 * only, lists newest first for the HR Manager, and is refused to anyone else.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  APPLICATION_ERROR_EVENT,
  listRecentApplicationErrors,
  recordApplicationError,
  safeErrorMessage,
} from '../src/services/applicationErrorService.ts';
import { createUser, resetDb } from './helpers.ts';

let manager: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  manager = await createUser('Err Manager', 'HR_MANAGER');
  officer = await createUser('Err Officer', 'HR_OFFICER');
});

describe('unexpected errors visible to the HR Manager (DEC-073)', () => {
  it('shortens a message and removes addresses and long tokens', () => {
    expect(safeErrorMessage('Mail to avery.brown@example.test failed')).toBe(
      'Mail to [address] failed',
    );
    expect(safeErrorMessage(`token ${'a'.repeat(40)} rejected`)).toBe('token [token] rejected');
    expect(safeErrorMessage('word '.repeat(100))).toHaveLength(280);
    expect(safeErrorMessage('  spaced\n\n out  ')).toBe('spaced out');
  });

  it('records the reference, name, message and route pattern - nothing else', async () => {
    await recordApplicationError({
      reference: '2806405632',
      errorName: 'PrismaClientKnownRequestError',
      message: 'The table `public.document_revision` does not exist in the current database.',
      routePath: '/cases/[id]/approve',
      method: 'GET',
      routeType: 'render',
    });
    const row = await getPrisma().auditEvent.findFirstOrThrow({
      where: { eventType: APPLICATION_ERROR_EVENT },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row.actorType).toBe('SYSTEM');
    expect(row.actorId).toBeNull();
    expect(row.objectType).toBe('Route');
    expect(row.objectId).toBe('/cases/[id]/approve');
    expect(row.result).toBe('FAILURE');
    expect(row.metadata).toEqual({
      reference: '2806405632',
      errorName: 'PrismaClientKnownRequestError',
      message: 'The table `public.document_revision` does not exist in the current database.',
      method: 'GET',
      routeType: 'render',
    });
  });

  it('lists the latest first, for the HR Manager only', async () => {
    await recordApplicationError({
      reference: null,
      errorName: 'TypeError',
      message: 'Cannot read properties of undefined',
      routePath: '/queue',
      method: 'GET',
      routeType: 'render',
    });
    const list = await listRecentApplicationErrors(manager.actor, 5);
    expect(list.map((e) => e.route)).toEqual(['/queue', '/cases/[id]/approve']);
    expect(list[0]).toMatchObject({ reference: null, errorName: 'TypeError', method: 'GET' });
    expect(list[1]).toMatchObject({
      reference: '2806405632',
      errorName: 'PrismaClientKnownRequestError',
    });
    await expect(listRecentApplicationErrors(officer.actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
