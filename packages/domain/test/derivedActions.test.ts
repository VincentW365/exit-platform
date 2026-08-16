import { describe, expect, it } from 'vitest';
import {
  deriveRequiredActions,
  DERIVATION_RULES_VERSION,
  type DerivationFacts,
} from '../src/derivedActions.ts';

const NOW = new Date('2026-08-10T12:00:00.000Z');

const baseFacts: DerivationFacts = {
  departureType: 'RESIGNATION_WITH_NOTICE',
  classification: 'CONFIDENTIAL',
  effectiveSeparationAt: new Date('2026-08-20T22:00:00.000Z'),
  groupHealthApplicability: 'YES',
  groupLifeApplicability: 'NO',
  otherProviderApplicability: 'NO',
  surveyEligibilityOverridden: false,
  issuedAssets: [
    { id: 'ia-1', assetType: 'LAPTOP', label: 'Laptop' },
    { id: 'ia-2', assetType: 'ACCESS_CARD', label: 'Access card' },
  ],
};

describe('derived-action rules engine (Directive 6.3 B/C)', () => {
  it('is deterministic: same facts, same clock, same output', () => {
    const a = deriveRequiredActions(baseFacts, NOW);
    const b = deriveRequiredActions(baseFacts, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(DERIVATION_RULES_VERSION).toBeTruthy();
  });

  it('always derives IT and Finance email actions (AC invariants 5-6)', () => {
    const specs = deriveRequiredActions(baseFacts, NOW);
    const it_ = specs.find((s) => s.actionKey === 'EMAIL:IT_ACCESS_REMOVAL');
    const fin = specs.find((s) => s.actionKey === 'EMAIL:FINANCE_OFFBOARDING');
    expect(it_?.applicable).toBe(true);
    expect(it_?.determination).toBe('DERIVED');
    expect(it_?.notificationType).toBe('IT_ACCESS_REMOVAL');
    expect(it_?.scheduledSendAt).toEqual(NOW);
    expect(fin?.applicable).toBe(true);
    expect(fin?.scheduledSendAt).toEqual(NOW);
  });

  it('termination IT email is scheduled one hour before the effective time (U)', () => {
    const specs = deriveRequiredActions(
      { ...baseFacts, departureType: 'TERMINATION', classification: 'RESTRICTED' },
      NOW,
    );
    const it_ = specs.find((s) => s.actionKey === 'EMAIL:IT_ACCESS_REMOVAL')!;
    expect(it_.scheduledSendAt).toEqual(new Date('2026-08-20T21:00:00.000Z'));
    const fin = specs.find((s) => s.actionKey === 'EMAIL:FINANCE_OFFBOARDING')!;
    expect(fin.scheduledSendAt).toEqual(baseFacts.effectiveSeparationAt);
  });

  it('a past effective time never schedules into the past', () => {
    const specs = deriveRequiredActions(
      {
        ...baseFacts,
        departureType: 'TERMINATION',
        effectiveSeparationAt: new Date('2026-08-01T12:00:00.000Z'),
      },
      NOW,
    );
    expect(specs.find((s) => s.actionKey === 'EMAIL:IT_ACCESS_REMOVAL')!.scheduledSendAt).toEqual(
      NOW,
    );
  });

  it('benefits YES prepares the notification, NO creates nothing, UNKNOWN requires review (V, AC invariant 7)', () => {
    const specs = deriveRequiredActions(baseFacts, NOW);
    const health = specs.find((s) => s.actionKey === 'EMAIL:GROUP_HEALTH_REMOVAL')!;
    expect(health.applicable).toBe(true);
    expect(health.determination).toBe('DERIVED');
    expect(health.notificationType).toBe('SAGICOR_GROUP_HEALTH_REMOVAL');
    const life = specs.find((s) => s.actionKey === 'EMAIL:GROUP_LIFE_REMOVAL')!;
    expect(life.applicable).toBe(false);
    expect(life.determination).toBe('NOT_APPLICABLE');
    expect(life.notificationType).toBeNull();

    const unknown = deriveRequiredActions({ ...baseFacts, groupLifeApplicability: 'UNKNOWN' }, NOW);
    expect(unknown.find((s) => s.actionKey === 'EMAIL:GROUP_LIFE_REMOVAL')!.determination).toBe(
      'REQUIRES_REVIEW',
    );
    const confirm = unknown.find((s) => s.actionKey === 'BENEFITS:CONFIRMATION')!;
    expect(confirm.applicable).toBe(true);
    expect(confirm.determination).toBe('REQUIRES_REVIEW');
  });

  it('asset actions come strictly from issued assets (G, AC invariants 11-12)', () => {
    const specs = deriveRequiredActions(baseFacts, NOW);
    const assets = specs.filter((s) => s.kind === 'ASSET_RECOVERY');
    expect(assets.map((s) => s.actionKey).sort()).toEqual(['ASSET:ia-1', 'ASSET:ia-2']);
    expect(assets.every((s) => s.determination === 'DERIVED')).toBe(true);

    const none = deriveRequiredActions({ ...baseFacts, issuedAssets: [] }, NOW);
    const assetRows = none.filter((s) => s.kind === 'ASSET_RECOVERY');
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]!.actionKey).toBe('ASSET:NONE');
    expect(assetRows[0]!.determination).toBe('NOT_APPLICABLE');
  });

  it('survey eligibility follows departure type; termination needs an override', () => {
    expect(
      deriveRequiredActions(baseFacts, NOW).find((s) => s.actionKey === 'SURVEY:INVITATION')!
        .applicable,
    ).toBe(true);
    const term = deriveRequiredActions({ ...baseFacts, departureType: 'TERMINATION' }, NOW).find(
      (s) => s.actionKey === 'SURVEY:INVITATION',
    )!;
    expect(term.applicable).toBe(false);
    const overridden = deriveRequiredActions(
      { ...baseFacts, departureType: 'TERMINATION', surveyEligibilityOverridden: true },
      NOW,
    ).find((s) => s.actionKey === 'SURVEY:INVITATION')!;
    expect(overridden.applicable).toBe(true);
  });

  it('other-provider YES surfaces review instead of fabricating a recipient', () => {
    const specs = deriveRequiredActions({ ...baseFacts, otherProviderApplicability: 'YES' }, NOW);
    const other = specs.find((s) => s.actionKey === 'EMAIL:OTHER_PROVIDER')!;
    expect(other.applicable).toBe(true);
    expect(other.determination).toBe('REQUIRES_REVIEW');
    expect(other.scheduledSendAt).toBeNull();
  });

  it('every spec carries full provenance: rule key + source fields + result', () => {
    for (const spec of deriveRequiredActions(baseFacts, NOW)) {
      expect(spec.ruleKey).toMatch(/^RULE_[A-Z_]+_V\d+$/);
      expect(Object.keys(spec.sourceFields).length).toBeGreaterThan(0);
      expect(Object.keys(spec.result).length).toBeGreaterThan(0);
    }
  });
});
