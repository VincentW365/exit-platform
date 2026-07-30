import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  destinationErrors,
  isRetryableError,
  maskDestination,
  normalizeProviderError,
  recipientUsableErrors,
  OUTBOX_BASE_DELAY_MS,
  OUTBOX_MAX_DELAY_MS,
} from '../src/outbox.ts';
import {
  activationChecksum,
  activationTransitionError,
  caseInScope,
  evaluateGateBlockers,
  READINESS_GATES,
} from '../src/pilot.ts';
import {
  backupMetadataErrors,
  computeEmployeeDiff,
  deterministicKeywordSummary,
  fallbackRefNumber,
  idClaimErrors,
  isFallbackRef,
  retentionEligible,
  scannerUnavailableOutcome,
  storageKeyErrors,
  suppressSmallGroups,
  SYNC_FORBIDDEN_CASE_FIELDS,
  downloadableScanStatuses,
} from '../src/operations.ts';

describe('outbox rules (Directive 4 B/C)', () => {
  it('backoff is bounded exponential with jitter and deterministic under injection', () => {
    const fixed = () => 0.5; // jitter factor 0.75
    expect(backoffDelayMs(1, fixed)).toBe(OUTBOX_BASE_DELAY_MS * 0.75);
    expect(backoffDelayMs(2, fixed)).toBe(OUTBOX_BASE_DELAY_MS * 2 * 0.75);
    expect(backoffDelayMs(50, fixed)).toBeLessThanOrEqual(OUTBOX_MAX_DELAY_MS);
    expect(backoffDelayMs(50, () => 1)).toBe(OUTBOX_MAX_DELAY_MS);
  });

  it('retry classification separates retryable and permanent codes', () => {
    expect(isRetryableError('PROVIDER_THROTTLED')).toBe(true);
    expect(isRetryableError('PROVIDER_UNAVAILABLE')).toBe(true);
    expect(isRetryableError('RECIPIENT_REJECTED')).toBe(false);
    expect(isRetryableError('AUTH_FAILED')).toBe(false);
  });

  it('provider errors normalize to stable safe codes (429 -> throttled)', () => {
    expect(normalizeProviderError({ httpStatus: 429 })).toBe('PROVIDER_THROTTLED');
    expect(normalizeProviderError({ httpStatus: 503 })).toBe('PROVIDER_UNAVAILABLE');
    expect(normalizeProviderError({ httpStatus: 401 })).toBe('AUTH_FAILED');
    expect(normalizeProviderError({ httpStatus: 400 })).toBe('MESSAGE_REJECTED');
    expect(normalizeProviderError({})).toBe('NETWORK_ERROR');
  });
});

describe('recipient directory rules (D)', () => {
  it('development must use capture/non-deliverable; production rejects them (D.4/D.5)', () => {
    expect(destinationErrors('capture://it-offboarding', 'development')).toEqual([]);
    expect(destinationErrors('it@example.invalid', 'development')).toEqual([]);
    expect(destinationErrors('it@company.com', 'development')).not.toEqual([]);
    expect(destinationErrors('it@example.invalid', 'production')).not.toEqual([]);
    expect(destinationErrors('capture://x', 'production')).not.toEqual([]);
    expect(destinationErrors('user@localhost', 'production')).not.toEqual([]);
    expect(destinationErrors('offboarding@company.com', 'production')).toEqual([]);
  });

  it('masks destinations for display', () => {
    expect(maskDestination('itdesk@company.com')).toBe('i***@c***.com');
    expect(maskDestination('capture://it')).toBe('capture://it');
  });

  it('expired, inactive, unverified or wrong-type recipients are unusable (D.7)', () => {
    const base = {
      active: true,
      approvalStatus: 'APPROVED',
      verifiedAt: new Date(),
      effectiveFrom: null,
      environment: 'development',
      allowedTypes: ['IT_ACCESS_REMOVAL'],
    };
    const now = new Date();
    expect(recipientUsableErrors(base, 'IT_ACCESS_REMOVAL', 'development', now)).toEqual([]);
    expect(
      recipientUsableErrors({ ...base, active: false }, 'IT_ACCESS_REMOVAL', 'development', now),
    ).not.toEqual([]);
    expect(
      recipientUsableErrors({ ...base, verifiedAt: null }, 'IT_ACCESS_REMOVAL', 'development', now),
    ).not.toEqual([]);
    expect(
      recipientUsableErrors(
        { ...base, approvalStatus: 'PENDING_APPROVAL' },
        'IT_ACCESS_REMOVAL',
        'development',
        now,
      ),
    ).not.toEqual([]);
    expect(
      recipientUsableErrors(
        { ...base, effectiveFrom: new Date(Date.now() + 86_400_000) },
        'IT_ACCESS_REMOVAL',
        'development',
        now,
      ),
    ).not.toEqual([]);
    expect(recipientUsableErrors(base, 'FINANCE_OFFBOARDING', 'development', now)).not.toEqual([]);
    expect(recipientUsableErrors(base, 'IT_ACCESS_REMOVAL', 'production', now)).not.toEqual([]);
  });
});

describe('identity claim validation (E.8)', () => {
  const expected = { issuer: 'https://login.example.invalid', audience: 'app-client' };
  const now = 1_800_000_000;
  const good = {
    iss: expected.issuer,
    aud: 'app-client',
    sub: 'user-1',
    email: 'user@example.invalid',
    exp: now + 600,
  };
  it('accepts valid claims and rejects issuer/audience/expiry/subject problems', () => {
    expect(idClaimErrors(good, expected, now)).toEqual([]);
    expect(idClaimErrors({ ...good, iss: 'https://evil.invalid' }, expected, now)).not.toEqual([]);
    expect(idClaimErrors({ ...good, aud: 'other' }, expected, now)).not.toEqual([]);
    expect(idClaimErrors({ ...good, exp: now - 1 }, expected, now)).not.toEqual([]);
    expect(idClaimErrors({ ...good, sub: '' }, expected, now)).not.toEqual([]);
  });
});

describe('BambooHR mapping (F)', () => {
  it('diffs only the mapped mutable fields', () => {
    const current = {
      displayName: 'A',
      workEmail: 'a@x.invalid',
      jobTitle: 'T',
      department: 'D',
      location: 'L',
    };
    expect(computeEmployeeDiff(current, { ...current })).toEqual([]);
    const diff = computeEmployeeDiff(current, { ...current, department: 'D2', location: 'L2' });
    expect(diff.map((d) => d.field).sort()).toEqual(['department', 'location']);
  });
  it('case decision fields are declared untouchable (F.8)', () => {
    expect(SYNC_FORBIDDEN_CASE_FIELDS).toContain('effectiveSeparationAt');
    expect(SYNC_FORBIDDEN_CASE_FIELDS).toContain('rehireEligibility');
    expect(SYNC_FORBIDDEN_CASE_FIELDS).toContain('status');
  });
});

describe('storage and scanner rules (G/H)', () => {
  it('accepts legacy and prefixed random keys; rejects meaningful keys', () => {
    const legacy = 'a'.repeat(48);
    expect(storageKeyErrors(legacy.replace(/a/g, '3'))).toEqual([]);
    expect(storageKeyErrors(`generated/${'ab12'.repeat(12)}`)).toEqual([]);
    expect(storageKeyErrors('clean/avery-brown.pdf')).not.toEqual([]);
    expect(storageKeyErrors('secret/uploads')).not.toEqual([]);
  });
  it('only CLEAN is downloadable; unavailable scanner quarantines with an exception', () => {
    expect(downloadableScanStatuses()).toEqual(['CLEAN']);
    const outcome = scannerUnavailableOutcome();
    expect(outcome.status).toBe('QUARANTINED');
    expect(outcome.openException).toBe(true);
  });
});

describe('pilot gates and activation (L/M)', () => {
  it('24 gates are defined; mandatory failures block', () => {
    expect(READINESS_GATES.length).toBe(24);
    const results = READINESS_GATES.map((g, i) => ({
      ...g,
      ok: i !== 0,
      detail: 'x',
    }));
    const blockers = evaluateGateBlockers(results);
    expect(blockers.length).toBe(1);
    expect(blockers[0]!.key).toBe('workflowVersions');
    // Advisory gate failure does not block.
    const advisory = READINESS_GATES.map((g) => ({ ...g, ok: g.mandatory, detail: 'x' }));
    expect(evaluateGateBlockers(advisory)).toEqual([]);
  });

  it('activation transitions follow the state model (L)', () => {
    expect(activationTransitionError('TEST_ONLY', 'TRAINING_ENABLED')).toBeNull();
    expect(activationTransitionError('TRAINING_ENABLED', 'PILOT_READY')).toBeNull();
    expect(activationTransitionError('PILOT_READY', 'PILOT_ACTIVE')).toBeNull();
    expect(activationTransitionError('TEST_ONLY', 'PILOT_ACTIVE')).not.toBeNull();
    expect(activationTransitionError('PILOT_ACTIVE', 'SUSPENDED')).toBeNull();
    expect(activationTransitionError('SUSPENDED', 'POST_ROLLOUT_ACTIVE')).not.toBeNull();
  });

  it('scope limits cases by department/location/type/limit (L.7)', () => {
    const c = {
      department: 'Sales',
      location: 'Kingston',
      departureType: 'RESIGNATION_WITH_NOTICE',
      createdAt: new Date(),
    };
    expect(caseInScope({}, c, 0).ok).toBe(true);
    expect(caseInScope({ departments: ['Sales'] }, c, 0).ok).toBe(true);
    expect(caseInScope({ departments: ['Warehouse'] }, c, 0).ok).toBe(false);
    expect(caseInScope({ maxActiveCases: 2 }, c, 2).ok).toBe(false);
    expect(caseInScope({ departureTypes: ['TERMINATION'] }, c, 0).ok).toBe(false);
  });

  it('activation checksum is deterministic and content-sensitive', () => {
    const core = {
      environment: 'development',
      cohort: 'PILOT',
      scope: {},
      enabledIntegrations: [],
      approvedWorkflowVersions: [],
      approvedTemplateVersions: [],
      approvedCalendarVersion: 1,
      rollbackPlan: 'return to manual operations',
    };
    expect(activationChecksum(core)).toBe(activationChecksum({ ...core }));
    expect(activationChecksum(core)).not.toBe(
      activationChecksum({ ...core, cohort: 'POST_ROLLOUT' }),
    );
  });
});

describe('reporting suppression and deterministic summaries (N)', () => {
  it('suppresses groups below the threshold (default 5)', () => {
    const rows = [
      { group: 'A', count: 12 },
      { group: 'B', count: 4 },
      { group: 'C', count: 5 },
    ];
    const out = suppressSmallGroups(rows);
    expect(out[0]).toEqual(rows[0]);
    expect(out[1]).toEqual({ suppressed: true, count: null });
    expect(out[2]).toEqual(rows[2]);
    expect(suppressSmallGroups(rows, 13).every((r) => 'suppressed' in r)).toBe(true);
  });

  it('keyword summary is deterministic counting, once per response, no AI', () => {
    const texts = [
      'The management was supportive but the schedule was difficult',
      'Schedule flexibility would help; management listened',
      'Great colleagues and management',
    ];
    const summary = deterministicKeywordSummary(texts, 3);
    expect(summary[0]).toEqual({ keyword: 'management', count: 3 });
    expect(summary.find((s) => s.keyword === 'schedule')?.count).toBe(2);
    // Stopwords and short words never appear.
    expect(summary.some((s) => ['the', 'was', 'and'].includes(s.keyword))).toBe(false);
    expect(deterministicKeywordSummary(texts, 3)).toEqual(summary); // deterministic
  });
});

describe('retention, backup and fallback (P/Q/R)', () => {
  const policy = {
    recordType: 'OFFBOARDING_CASE',
    retainYears: 2,
    active: true,
    approvedById: 'u1',
  };
  it('eligibility requires approved active policy, elapsed period and no hold', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const now = new Date('2026-07-30T00:00:00Z');
    expect(retentionEligible({ closedAt: old, hasActiveHold: false }, policy, now).eligible).toBe(
      true,
    );
    expect(retentionEligible({ closedAt: old, hasActiveHold: true }, policy, now).eligible).toBe(
      false,
    );
    expect(retentionEligible({ closedAt: null, hasActiveHold: false }, policy, now).eligible).toBe(
      false,
    );
    expect(
      retentionEligible({ closedAt: new Date('2026-01-01'), hasActiveHold: false }, policy, now)
        .eligible,
    ).toBe(false);
    expect(
      retentionEligible(
        { closedAt: old, hasActiveHold: false },
        { ...policy, approvedById: null },
        now,
      ).eligible,
    ).toBe(false);
  });

  it('backup metadata validation', () => {
    const good = {
      kind: 'DATABASE',
      sizeBytes: 1024,
      checksum: 'a'.repeat(64),
      objectPath: '/b/x.dump',
    };
    expect(backupMetadataErrors(good)).toEqual([]);
    expect(backupMetadataErrors({ ...good, sizeBytes: 0 })).not.toEqual([]);
    expect(backupMetadataErrors({ ...good, checksum: 'xyz' })).not.toEqual([]);
    expect(backupMetadataErrors({ ...good, kind: 'FILES' })).not.toEqual([]);
  });

  it('fallback references are controlled and recognizable', () => {
    expect(fallbackRefNumber(2026, 7)).toBe('FB-2026-0007');
    expect(isFallbackRef('FB-2026-0007')).toBe(true);
    expect(isFallbackRef('FB-26-7')).toBe(false);
  });
});
