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
      notification_outbox,
      recipient_config,
      system_config,
      access_review,
      employee_sync_run,
      pilot_activation,
      report_run,
      scheduled_report,
      retention_run,
      retention_hold,
      retention_policy,
      disclosure_log,
      data_subject_request,
      backup_record,
      fallback_entry,
      outage,
      support_ticket,
      training_completion,
      clearance_record,
      case_exception,
      handover_record,
      asset_recovery_item,
      issued_asset,
      asset_catalogue_item,
      notification_capture,
      notification_record,
      notification_template,
      task_correction,
      workflow_task,
      workflow_instance,
      workflow_task_definition,
      workflow_definition,
      render_job,
      survey_answer,
      survey_response,
      survey_invitation,
      survey_question,
      survey_template,
      attestation,
      action_form_version,
      document_instance,
      document_template,
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

/**
 * Directive 6.1 (E/F/J): activation now requires an assigned HR Officer,
 * resolved manager routing and the six confirmations. Tests and seeds that
 * only need an ACTIVE case call this between approval and activation.
 */
export async function readyAssignment(
  caseId: string,
  hrManagerActor: Actor,
  officerUserId: string,
  lineManagerUserId: string,
): Promise<void> {
  const { assignOfficer, overrideManager, confirmAssignmentPlan } =
    await import('../src/services/caseAssignmentService.ts');
  const { CONFIRMATION_KEYS } = await import('@exit/domain');
  await assignOfficer(hrManagerActor, caseId, officerUserId, 'Integration test assignment.');
  await overrideManager(hrManagerActor, caseId, lineManagerUserId, 'Integration test routing.');
  await confirmAssignmentPlan(hrManagerActor, caseId, [...CONFIRMATION_KEYS]);
}

/**
 * Stage 3 fixtures: development workflow definitions, notification templates,
 * asset catalogue and issued assets (all synthetic). resetDb truncates them,
 * so tests re-seed explicitly.
 */
export async function seedStage3Fixtures(): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { identitySubject: 'dev|hr-manager' } });
  if (!existing) {
    await prisma.user.create({
      data: {
        identitySubject: 'dev|hr-manager',
        displayName: 'Dana Field',
        workEmail: `dana.field-${randomUUID().slice(0, 8)}@example.test`,
        roleAssignments: { create: [{ role: 'HR_MANAGER', reason: 'integration test fixture' }] },
      },
    });
  }
  const { seedStage3 } = await import('../src/seedStage3.ts');
  await seedStage3(prisma);
  const { seedStage4 } = await import('../src/seedStage4.ts');
  await seedStage4(prisma);
}
