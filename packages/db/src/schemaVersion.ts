/**
 * The newest migration this build expects in its database (DEC-073).
 *
 * A hosted site whose release skipped `prisma migrate deploy` otherwise fails
 * only when a page first touches a missing table - with a reference nobody
 * can read. Bump this with every migration; packages/db/test/schemaVersion.test.ts
 * reads the migrations folder and fails when it is stale.
 */
export const EXPECTED_LATEST_MIGRATION = '20260923170000_editable_documents_and_recipients';

export type SchemaState = 'current' | 'behind' | 'ahead' | 'unknown';

/** Migration names begin with a timestamp, so their order is their text order. */
export function schemaState(
  applied: string | null,
  expected: string = EXPECTED_LATEST_MIGRATION,
): SchemaState {
  if (!applied) return 'unknown';
  if (applied === expected) return 'current';
  return applied < expected ? 'behind' : 'ahead';
}
