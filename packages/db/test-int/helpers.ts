/** Shared fixtures for integration tests. Synthetic identities only. */
import { randomUUID } from 'node:crypto';
import type { Actor, Role } from '@exit/domain';
import { getPrisma } from '../src/client.ts';

export async function resetDb(): Promise<void> {
  const prisma = getPrisma();
  // Truncate in dependency-safe order; audit/case triggers block DELETE, so
  // integration cleanup uses TRUNCATE ... CASCADE as the database owner.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_event,
      baseline_event,
      attachment,
      case_note,
      case_status_history,
      case_participant,
      employee_snapshot,
      offboarding_case,
      employee_source_record,
      case_number_counter,
      role_assignment,
      app_user,
      holiday,
      holiday_calendar,
      reason_category,
      feature_flag,
      config_list_item,
      integration_placeholder
    CASCADE
  `);
}

export async function createUser(
  name: string,
  ...roles: Role[]
): Promise<{ userId: string; actor: Actor }> {
  const prisma = getPrisma();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      identitySubject: `test|${slug}`,
      displayName: name,
      workEmail: `${slug}@example.test`,
      roleAssignments: {
        create: roles.map((role) => ({ role, reason: 'integration test fixture' })),
      },
    },
  });
  return { userId: user.id, actor: { userId: user.id, roles } };
}

export const VALID_DRAFT = {
  employeeSourceId: 'EMP-TEST-001',
  departureType: 'RESIGNATION_WITH_NOTICE',
  receivedAt: '2026-07-20T14:00:00.000Z',
  receiptSource: 'Signed resignation letter received by HR front desk',
  effectiveSeparationAt: '2026-08-14T22:00:00.000Z',
  measurementCohort: 'BASELINE',
  recordPurpose: 'OPERATIONAL',
} as const;
