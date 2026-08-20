/**
 * Rehearsal mode (HR samples directive section 8): the rules that make it
 * safe to walk the real workflow without a message reaching a real person.
 */
import { describe, expect, it } from 'vitest';
import {
  applyTestModeRedirect,
  parseTestMode,
  testModeErrors,
  TEST_MODE_SUBJECT_PREFIX,
} from '../src/outbox.ts';

const ON = { enabled: true, redirectTo: 'rehearsal@example.test' };

const MESSAGE = {
  subject: 'Access Removal - Avery Brown (OFF-2026-0001)',
  body: 'Kindly process access removal for the below past employee.',
  destination: 'it.team@example.test',
  cc: ['hr.one@example.test', 'hr.two@example.test'],
  bcc: ['audit.copy@example.test'],
};

describe('reading the stored setting', () => {
  it('treats anything unexpected as off', () => {
    for (const value of [null, undefined, 'true', 42, [], {}]) {
      expect(parseTestMode(value).enabled).toBe(false);
    }
  });

  it('reads a complete setting', () => {
    expect(parseTestMode({ enabled: true, redirectTo: ' a@b.test ', note: ' UAT ' })).toEqual({
      enabled: true,
      redirectTo: 'a@b.test',
      note: 'UAT',
    });
  });
});

describe('turning it on', () => {
  it('needs a mailbox', () => {
    expect(testModeErrors({ enabled: true, redirectTo: '' }, 'development')).toEqual([
      'A redirect mailbox is required to turn test mode on.',
    ]);
  });

  it('holds the environment to its own destination rules', () => {
    // A development rehearsal can never be pointed at a deliverable address.
    expect(
      testModeErrors({ enabled: true, redirectTo: 'someone@bertsautoparts.com' }, 'development'),
    ).not.toEqual([]);
    expect(
      testModeErrors({ enabled: true, redirectTo: 'someone@bertsautoparts.com' }, 'production'),
    ).toEqual([]);
  });

  it('never blocks turning it OFF', () => {
    expect(testModeErrors({ enabled: false, redirectTo: '' }, 'production')).toEqual([]);
  });
});

describe('diverting a message', () => {
  it('leaves everything alone when off', () => {
    const out = applyTestModeRedirect(MESSAGE, { enabled: false, redirectTo: 'x@example.test' });
    expect(out.redirected).toBe(false);
    expect(out.destination).toBe(MESSAGE.destination);
    expect(out.cc).toEqual(MESSAGE.cc);
    expect(out.subject).toBe(MESSAGE.subject);
    expect(out.body).toBe(MESSAGE.body);
  });

  it('sends everything to the one mailbox and drops the copies', () => {
    const out = applyTestModeRedirect(MESSAGE, ON);
    expect(out.redirected).toBe(true);
    expect(out.destination).toBe('rehearsal@example.test');
    expect(out.cc).toEqual([]);
  });

  it('marks the subject once, however many times it passes through', () => {
    const once = applyTestModeRedirect(MESSAGE, ON);
    const twice = applyTestModeRedirect(once, ON);
    expect(once.subject.startsWith(TEST_MODE_SUBJECT_PREFIX)).toBe(true);
    expect(twice.subject).toBe(once.subject);
  });

  it('spells out the intended To, Cc and Bcc so routing can be verified', () => {
    // The tester has to be able to check the addresses against the routing
    // table, so the redirected copy carries them in full. The audit trail and
    // the email log still keep masks.
    const out = applyTestModeRedirect(MESSAGE, ON);
    expect(out.body).toContain('WAS INTERCEPTED AND NOT DELIVERED');
    expect(out.body).toContain('Intended recipients (calculated by the normal routing rules):');
    expect(out.body).toContain(`To: ${MESSAGE.destination}`);
    expect(out.body).toContain(`Cc: ${MESSAGE.cc.join(', ')}`);
    expect(out.body).toContain(`Bcc: ${MESSAGE.bcc.join(', ')}`);
    expect(out.body).toContain(MESSAGE.body);
  });

  it('returns the same recipients masked, for the trail and the email log', () => {
    const out = applyTestModeRedirect(MESSAGE, ON);
    expect(out.intendedMasks).toHaveLength(4);
    for (const mask of out.intendedMasks) expect(mask).toContain('*');
    expect(out.intendedTo).toBe(MESSAGE.destination);
    expect(out.intendedCc).toEqual(MESSAGE.cc);
    expect(out.intendedBcc).toEqual(MESSAGE.bcc);
  });

  it('drops the copies so nobody but the tester receives it', () => {
    const out = applyTestModeRedirect(MESSAGE, ON);
    expect(out.cc).toEqual([]);
    expect(out.bcc).toEqual([]);
  });

  it('carries the note when one is configured', () => {
    const out = applyTestModeRedirect(MESSAGE, { ...ON, note: 'August UAT rehearsal.' });
    expect(out.body).toContain('Note: August UAT rehearsal.');
  });
});
