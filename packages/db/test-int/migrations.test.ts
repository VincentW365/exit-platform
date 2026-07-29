/**
 * Database-level guarantees that Prisma cannot express in the schema:
 * check constraint, append-only audit, and no-hard-delete for cases
 * (REQ-CASE-013/015, REQ-SEC-024). Requires the migrated test database.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';
import { createDraft } from '../src/services/caseService.ts';

const prisma = getPrisma();

beforeAll(async () => {
  await resetDb();
});

describe('cohort/purpose check constraint (REQ-CASE-013)', () => {
  it('rejects OPERATIONAL without a cohort at the database layer', async () => {
    const { userId } = await createUser('Constraint HR', 'HR_OFFICER');
    await expect(
      prisma.$executeRawUnsafe(
        `
        INSERT INTO offboarding_case
          (id, "caseNumber", status, "departureType", classification,
           "recordPurpose", "measurementCohort",
           "employeeSourceSystem", "employeeSourceId", "employeeDisplayName",
           department, location, "receivedAt", "receiptSource",
           "ownerId", "createdById", version, "reasonCaptureStatus", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), 'OFF-9999-0001', 'DRAFT', 'RESIGNATION_WITH_NOTICE', 'CONFIDENTIAL',
           'OPERATIONAL', NULL,
           'SYNTHETIC', 'EMP-TEST-001', 'Avery Brown',
           'Sales', 'Kingston', now(), 'test',
           $1::uuid, $1::uuid, 0, 'PENDING', now(), now())
        `,
        userId,
      ),
    ).rejects.toThrow(/chk_cohort_purpose|constraint/i);
  });

  it('rejects TRAINING with a cohort at the database layer', async () => {
    const { userId } = await createUser('Constraint HR 2', 'HR_OFFICER');
    await expect(
      prisma.$executeRawUnsafe(
        `
        INSERT INTO offboarding_case
          (id, "caseNumber", status, "departureType", classification,
           "recordPurpose", "measurementCohort",
           "employeeSourceSystem", "employeeSourceId", "employeeDisplayName",
           department, location, "receivedAt", "receiptSource",
           "ownerId", "createdById", version, "reasonCaptureStatus", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), 'OFF-9999-0002', 'DRAFT', 'RESIGNATION_WITH_NOTICE', 'CONFIDENTIAL',
           'TRAINING', 'BASELINE',
           'SYNTHETIC', 'EMP-TEST-001', 'Avery Brown',
           'Sales', 'Kingston', now(), 'test',
           $1::uuid, $1::uuid, 0, 'PENDING', now(), now())
        `,
        userId,
      ),
    ).rejects.toThrow(/chk_cohort_purpose|constraint/i);
  });
});

describe('audit events are append-only (REQ-SEC-024)', () => {
  it('UPDATE and DELETE on audit_event are rejected by trigger', async () => {
    const { actor } = await createUser('Audit HR', 'HR_OFFICER');
    await createDraft(actor, VALID_DRAFT);
    const row = await prisma.auditEvent.findFirst({ where: { eventType: 'CASE_CREATED' } });
    expect(row).not.toBeNull();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_event SET "eventType"='TAMPERED' WHERE id='${row!.id}'::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_event WHERE id='${row!.id}'::uuid`),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('cases cannot be hard-deleted (REQ-CASE-015)', () => {
  it('DELETE on offboarding_case is rejected by trigger', async () => {
    const { actor } = await createUser('Delete HR', 'HR_OFFICER');
    const { caseId } = await createDraft(actor, VALID_DRAFT);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM offboarding_case WHERE id='${caseId}'::uuid`),
    ).rejects.toThrow(/cannot be hard-deleted/i);
  });
});

describe('case number uniqueness (REQ-CASE-001)', () => {
  it('allocates sequential unique numbers under concurrency', async () => {
    const { actor } = await createUser('Numbering HR', 'HR_OFFICER');
    const results = await Promise.all([
      createDraft(actor, VALID_DRAFT),
      createDraft(actor, { ...VALID_DRAFT, employeeSourceId: 'EMP-TEST-002' }),
      createDraft(actor, { ...VALID_DRAFT, employeeSourceId: 'EMP-TEST-004' }),
    ]);
    const numbers = results.map((r) => r.caseNumber);
    expect(new Set(numbers).size).toBe(3);
    for (const n of numbers) expect(n).toMatch(/^OFF-\d{4}-\d{4}$/);
  });
});
