/**
 * Employee directory synchronization rules (owner directive, 2026-09-15).
 * Pure logic: freshness thresholds, schedule decisions, webhook signature
 * verification, payload parsing and change detection. Synthetic values only.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRECTORY_SYNC_SETTINGS,
  directoryFieldChanges,
  directoryFreshness,
  directoryRecordStatus,
  hourlyDue,
  nightlyDue,
  parseBambooWebhookEmployees,
  parseDirectorySyncSettings,
  startupSyncNeeded,
  syncResultFromCounts,
  verifyBambooWebhookSignature,
} from '../src/index.ts';

const NOW = new Date('2026-09-15T15:00:00.000Z'); // 10:00 Jamaica
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('directory freshness (section 19)', () => {
  it('has never synchronized -> the only genuinely unavailable state, for administrators', () => {
    const f = directoryFreshness(null, NOW);
    expect(f.state).toBe('NEVER');
    expect(f.audience).toBe('admin');
  });
  it('is current under two hours and says so quietly', () => {
    const f = directoryFreshness(hoursAgo(1.5), NOW);
    expect(f.state).toBe('CURRENT');
    expect(f.audience).toBe('none');
    expect(f.message).toMatch(/last synchronized 2 hours ago|last synchronized 90 minutes ago/);
  });
  it('is delayed between two and six hours, stale to a day, then an administrative alert', () => {
    expect(directoryFreshness(hoursAgo(3), NOW).state).toBe('DELAYED');
    expect(directoryFreshness(hoursAgo(3), NOW).audience).toBe('hr');
    expect(directoryFreshness(hoursAgo(7), NOW).state).toBe('STALE');
    expect(directoryFreshness(hoursAgo(25), NOW).state).toBe('ALERT');
    expect(directoryFreshness(hoursAgo(25), NOW).audience).toBe('admin');
    expect(directoryFreshness(hoursAgo(72), NOW).message).toContain('3 days ago');
  });
  it('honours configured thresholds', () => {
    const s = parseDirectorySyncSettings({
      staleDelayedHours: 1,
      staleWarningHours: 2,
      staleAlertHours: 3,
    });
    expect(directoryFreshness(hoursAgo(1.5), NOW, s).state).toBe('DELAYED');
    expect(directoryFreshness(hoursAgo(2.5), NOW, s).state).toBe('STALE');
    expect(directoryFreshness(hoursAgo(3.5), NOW, s).state).toBe('ALERT');
  });
});

describe('settings parsing', () => {
  it('falls back to the defaults for anything odd', () => {
    expect(parseDirectorySyncSettings(null)).toEqual(DEFAULT_DIRECTORY_SYNC_SETTINGS);
    expect(
      parseDirectorySyncSettings({ hourlyMinutes: -5, nightlyHour: 99, nightlyMinute: 'x' }),
    ).toEqual(DEFAULT_DIRECTORY_SYNC_SETTINGS);
  });
  it('keeps valid overrides', () => {
    const s = parseDirectorySyncSettings({ hourlyMinutes: 30, nightlyHour: 3, nightlyMinute: 15 });
    expect(s.hourlyMinutes).toBe(30);
    expect(s.nightlyHour).toBe(3);
    expect(s.nightlyMinute).toBe(15);
  });
});

describe('schedule (section 38)', () => {
  it('hourly reconciliation is due after the interval, and at once when nothing has ever run', () => {
    expect(hourlyDue(null, NOW)).toBe(true);
    expect(hourlyDue(hoursAgo(0.5), NOW)).toBe(false);
    expect(hourlyDue(hoursAgo(1), NOW)).toBe(true);
  });
  it('nightly full reconciliation is due once per day after 2:00 AM Jamaica', () => {
    // 01:30 Jamaica = 06:30Z: the slot has not passed yet today.
    expect(nightlyDue(null, new Date('2026-09-15T06:30:00.000Z'))).toBe(false);
    // 02:05 Jamaica = 07:05Z: due, nothing has run since the slot.
    expect(nightlyDue(hoursAgo(30), new Date('2026-09-15T07:05:00.000Z'))).toBe(true);
    // A nightly that succeeded after the slot means it is not due again today.
    expect(nightlyDue(new Date('2026-09-15T07:10:00.000Z'), NOW)).toBe(false);
    // ...but one from before the slot leaves it due.
    expect(nightlyDue(new Date('2026-09-15T06:00:00.000Z'), NOW)).toBe(true);
  });
  it('start-up check reconciles only when materially stale', () => {
    expect(startupSyncNeeded(null, NOW)).toBe(true);
    expect(startupSyncNeeded(hoursAgo(1), NOW)).toBe(false);
    expect(startupSyncNeeded(hoursAgo(2.5), NOW)).toBe(true);
  });
});

describe('webhook signature verification (section 10)', () => {
  const key = 'test-webhook-private-key-not-real';
  const body = JSON.stringify({ employees: [{ id: 9001, changedFields: ['jobTitle'] }] });
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sign = (b: string, t: string, k = key) =>
    createHmac('sha256', k)
      .update(b + t)
      .digest('hex');

  it('accepts a correctly signed, timely request', () => {
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: sign(body, ts),
        privateKey: key,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });
  it('refuses when no key is configured (the endpoint is closed)', () => {
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: sign(body, ts),
        privateKey: '',
        now: NOW,
      }).reason,
    ).toBe('NO_KEY');
  });
  it('refuses a missing signature or timestamp', () => {
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: null,
        privateKey: key,
        now: NOW,
      }).reason,
    ).toBe('NO_SIGNATURE');
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: null,
        signature: sign(body, ts),
        privateKey: key,
        now: NOW,
      }).reason,
    ).toBe('NO_TIMESTAMP');
  });
  it('refuses a wrong key, a tampered body and a replayed (stale) timestamp', () => {
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: sign(body, ts, 'other'),
        privateKey: key,
        now: NOW,
      }).reason,
    ).toBe('BAD_SIGNATURE');
    expect(
      verifyBambooWebhookSignature({
        rawBody: body + ' ',
        timestamp: ts,
        signature: sign(body, ts),
        privateKey: key,
        now: NOW,
      }).reason,
    ).toBe('BAD_SIGNATURE');
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    expect(
      verifyBambooWebhookSignature({
        rawBody: body,
        timestamp: old,
        signature: sign(body, old),
        privateKey: key,
        now: NOW,
      }).reason,
    ).toBe('STALE_TIMESTAMP');
  });
  it('never includes the key or the body in the verdict', () => {
    const v = verifyBambooWebhookSignature({
      rawBody: body,
      timestamp: ts,
      signature: 'nope',
      privateKey: key,
      now: NOW,
    });
    expect(JSON.stringify(v)).not.toContain(key);
    expect(JSON.stringify(v)).not.toContain('9001');
  });
});

describe('webhook payload parsing (section 11)', () => {
  it('reads employee ids and changed field names, tolerating shapes, and de-duplicates', () => {
    const out = parseBambooWebhookEmployees({
      employees: [
        { id: 9001, changedFields: ['jobTitle', 'department'], action: 'Updated' },
        { id: '9001', changedFields: ['workEmail'] },
        { employeeId: '9002', fields: { ssn: 'must be ignored' } },
        { id: '' },
        'garbage',
      ],
    });
    expect(out).toEqual([
      { sourceId: '9001', changedFields: ['jobTitle', 'department'], action: 'Updated' },
      { sourceId: '9002', changedFields: [], action: null },
    ]);
    expect(parseBambooWebhookEmployees([{ id: 7 }])).toEqual([
      { sourceId: '7', changedFields: [], action: null },
    ]);
    expect(parseBambooWebhookEmployees({ nothing: true })).toEqual([]);
    expect(parseBambooWebhookEmployees(null)).toEqual([]);
  });
});

describe('change detection and status words', () => {
  it('reports the NAMES of mirrored fields that differ, never values', () => {
    const changes = directoryFieldChanges(
      {
        displayName: 'Avery Brown',
        jobTitle: 'Clerk',
        department: 'Sales',
        active: true,
        hireDate: new Date('2020-01-02'),
      },
      {
        displayName: 'Avery Brown',
        jobTitle: 'Senior Clerk',
        department: 'Sales ',
        active: true,
        hireDate: '2020-01-02',
      },
    );
    expect(changes).toEqual(['jobTitle']);
    expect(JSON.stringify(changes)).not.toContain('Senior');
  });
  it('treats blank and null as the same value', () => {
    expect(directoryFieldChanges({ division: '' }, { division: null })).toEqual([]);
  });
  it('names the record status from active, archived and employment status', () => {
    expect(directoryRecordStatus({ active: true })).toBe('Active');
    expect(directoryRecordStatus({ active: false })).toBe('Inactive');
    expect(directoryRecordStatus({ active: false, employmentStatus: 'Terminated' })).toBe(
      'Terminated',
    );
    expect(directoryRecordStatus({ active: false, archivedAt: new Date() })).toBe('Archived');
  });
  it('a run with row failures is PARTIAL, otherwise SUCCESS', () => {
    expect(syncResultFromCounts({ failed: 0, checked: 3 })).toBe('SUCCESS');
    expect(syncResultFromCounts({ failed: 1, checked: 3 })).toBe('PARTIAL');
  });
});
