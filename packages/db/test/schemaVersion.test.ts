import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPECTED_LATEST_MIGRATION, schemaState } from '../src/schemaVersion.ts';

describe('expected database schema (DEC-073)', () => {
  it('names the newest migration in the repository', () => {
    const dir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const newest = readdirSync(dir)
      .filter((n) => /^\d{14}_/.test(n))
      .sort()
      .at(-1);
    expect(EXPECTED_LATEST_MIGRATION).toBe(newest);
  });

  it('reads a database as current, behind, ahead or unknown', () => {
    expect(schemaState(null)).toBe('unknown');
    expect(schemaState(EXPECTED_LATEST_MIGRATION)).toBe('current');
    expect(schemaState('20260923140000_electronic_signatures')).toBe('behind');
    expect(schemaState('20270101000000_later')).toBe('ahead');
  });
});
