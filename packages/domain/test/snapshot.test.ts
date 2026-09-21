import { describe, expect, it } from 'vitest';
import { SYNTHETIC_EMPLOYEES, SyntheticEmployeeSourceAdapter } from '../src/employeeSource.ts';
import { buildSnapshotPayload, snapshotChecksum } from '../src/snapshot.ts';
import { baselineEventErrors } from '../src/baseline.ts';

describe('employee snapshot (REQ-CASE-004)', () => {
  const retrieved = new Date('2026-07-28T12:00:00Z');

  it('captures the approved source subset with provenance', () => {
    const payload = buildSnapshotPayload(SYNTHETIC_EMPLOYEES[0]!, retrieved);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      sourceSystem: 'SYNTHETIC',
      sourceId: 'EMP-TEST-001',
      displayName: 'Avery Brown',
      sourceRetrievedAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('checksum is deterministic and content-sensitive', () => {
    const a = buildSnapshotPayload(SYNTHETIC_EMPLOYEES[0]!, retrieved);
    const b = buildSnapshotPayload(SYNTHETIC_EMPLOYEES[0]!, retrieved);
    expect(snapshotChecksum(a)).toBe(snapshotChecksum(b));
    const c = buildSnapshotPayload(SYNTHETIC_EMPLOYEES[1]!, retrieved);
    expect(snapshotChecksum(a)).not.toBe(snapshotChecksum(c));
  });
});

describe('synthetic employee source adapter (REQ-INT-017)', () => {
  const adapter = new SyntheticEmployeeSourceAdapter();

  it('finds fixtures by name, id and department; empty query returns nothing', async () => {
    // Two Averys exist since the hosted-UAT population (Avery Brown, Avery
    // Immediate); the full name is unambiguous.
    expect(await adapter.search('avery brown')).toHaveLength(1);
    expect(await adapter.search('avery')).toHaveLength(2);
    expect(await adapter.search('EMP-TEST-003')).toHaveLength(1);
    expect(await adapter.search('kingston')).toHaveLength(0); // location not searched
    expect(await adapter.search('')).toHaveLength(0);
  });

  it('resolves by id and returns null for unknown ids', async () => {
    expect((await adapter.getById('EMP-TEST-002'))?.displayName).toBe('Jordan Lee');
    expect(await adapter.getById('EMP-REAL-001')).toBeNull();
  });

  it('all fixture identities are clearly synthetic', () => {
    for (const e of SYNTHETIC_EMPLOYEES) {
      // Two identifier families, both unmistakably synthetic: the original
      // EMP-TEST fixtures and the hosted-UAT generic population (2026-09-21).
      expect(e.sourceId).toMatch(/^(EMP-TEST-\d{3}|UAT-\d{4})$/);
      expect(e.workEmail.endsWith('@example.test')).toBe(true);
    }
  });
});

describe('baseline event validation (BaselineDataCapturePlan)', () => {
  const now = new Date('2026-07-28T12:00:00Z');
  const base = {
    eventType: 'DOCUMENT_ISSUED' as const,
    occurredAt: new Date('2026-07-27T15:00:00Z'),
    missingReason: null,
    missingNote: null,
    detail: null,
    evidenceRef: null,
  };

  it('accepts a recorded past event', () => {
    expect(baselineEventErrors(base, now)).toEqual([]);
  });

  it('requires a time or a missing-reason, never both, never neither', () => {
    expect(baselineEventErrors({ ...base, occurredAt: null }, now)).toHaveLength(1);
    expect(baselineEventErrors({ ...base, missingReason: 'SOURCE_UNAVAILABLE' }, now)).toHaveLength(
      1,
    );
    expect(
      baselineEventErrors(
        { ...base, occurredAt: null, missingReason: 'NOT_RECORDED_CURRENT_PROCESS' },
        now,
      ),
    ).toEqual([]);
  });

  it('forbids future timestamps except for due-type events', () => {
    const future = new Date('2026-08-01T12:00:00Z');
    expect(baselineEventErrors({ ...base, occurredAt: future }, now)).toHaveLength(1);
    expect(
      baselineEventErrors({ ...base, eventType: 'ACCESS_REMOVAL_DUE', occurredAt: future }, now),
    ).toEqual([]);
  });

  it('UNKNOWN_OTHER requires an explanation', () => {
    expect(
      baselineEventErrors(
        { ...base, occurredAt: null, missingReason: 'UNKNOWN_OTHER', missingNote: null },
        now,
      ),
    ).toContainEqual(expect.stringContaining('explanation'));
  });
});
