/**
 * Directive 6.2 (B) / DEC-043 - absolute side-effect safety for live-data UAT:
 * real organizational data NEVER authorizes real business actions. This suite
 * consolidates the proof that every live side-effect path refuses TEST/
 * TRAINING records and that the BambooHR integration is read-only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { automationPermitted } from '@exit/domain';
import { getBambooAdapter } from '../src/services/bamboohrService.ts';
import { getEmailProvider } from '../src/services/emailProviders.ts';
import { assertFeatureAllowed } from '../src/services/shared.ts';
import { resetDb } from './helpers.ts';

beforeAll(async () => {
  await resetDb();
});

describe('BambooHR is READ-ONLY', () => {
  it('the adapter exposes no write-capable method', async () => {
    const adapter = await getBambooAdapter();
    const methods = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)),
      ...Object.getOwnPropertyNames(adapter),
    ];
    const writeish = methods.filter((m) =>
      /write|update|create|delete|post|put|patch|deactivate|terminate/i.test(m),
    );
    expect(writeish).toEqual([]);
    // The read surface is exactly what the sync needs.
    expect(typeof (adapter as { listEmployees: unknown }).listEmployees).toBe('function');
  });
});

describe('TEST/TRAINING records cannot trigger live automation', () => {
  it('automationPermitted refuses non-OPERATIONAL purposes even with flags enabled', () => {
    expect(automationPermitted({ recordPurpose: 'TEST', measurementCohort: null }, true)).toBe(
      false,
    );
    expect(automationPermitted({ recordPurpose: 'TRAINING', measurementCohort: null }, true)).toBe(
      false,
    );
    // BASELINE operational records never automate either.
    expect(
      automationPermitted({ recordPurpose: 'OPERATIONAL', measurementCohort: 'BASELINE' }, true),
    ).toBe(false);
  });

  it('feature gates let TEST records exercise features WITHOUT enabling live paths', async () => {
    // TEST records pass the feature gate (they exercise the software)...
    await expect(
      assertFeatureAllowed(
        { recordPurpose: 'TEST', measurementCohort: null },
        'automation.notifications',
      ),
    ).resolves.toBeUndefined();
    // ...while OPERATIONAL records without the flag are refused.
    await expect(
      assertFeatureAllowed(
        { recordPurpose: 'OPERATIONAL', measurementCohort: 'PILOT' },
        'automation.notifications',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('email dispatch cannot claim external delivery in this environment', () => {
  it('the configured provider is capture/sink and never returns DELIVERED', async () => {
    const provider = getEmailProvider();
    expect(['sink', 'dev-capture', 'capture']).toContain(provider.mode);
    // The provider contract only permits CAPTURED (dev) or SUBMITTED (live
    // acceptance); DELIVERED does not exist in the type at all - asserted
    // here as a runtime spot check of the mode.
    expect(provider.mode).not.toMatch(/graph|live/i);
  });
});
