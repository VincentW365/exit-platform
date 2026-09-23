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
      document_revision,
      signature_record,
      signature_request,
      directory_sync_run,
      return_items_checklist_entry,
      return_items_checklist,
      action_token,
      case_required_action,
      notification_outbox,
      notification_routing,
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

// Directive 6.3 logic-audit fix: the fixture dates were fixed calendar
// instants that real time eventually overtook, silently flipping "early"
// completions into "late" ones. Anchor them to the test run's clock instead:
// receipt ~25 days ago, effective separation 5 days ahead (always future).
const DAY_MS = 24 * 60 * 60 * 1000;
export const FIXTURE_RECEIVED_AT = new Date(Date.now() - 25 * DAY_MS).toISOString();
export const FIXTURE_EFFECTIVE_AT = new Date(Date.now() + 5 * DAY_MS).toISOString();
export const FIXTURE_CONFIRMED_LAST_DAY = new Date(Date.now() + 4 * DAY_MS).toISOString();

export const VALID_DRAFT = {
  employeeSourceId: 'EMP-TEST-001',
  departureType: 'RESIGNATION_WITH_NOTICE',
  receivedAt: FIXTURE_RECEIVED_AT,
  receiptSource: 'Signed resignation letter received by HR front desk',
  effectiveSeparationAt: FIXTURE_EFFECTIVE_AT,
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
  /**
   * Kept for call-site compatibility and ignored: since the owner decision of
   * 2026-08-19 an alternate manager is a DIRECTORY person, not an application
   * account. The helper records one from the synthetic directory so every
   * case has somewhere to send the departure notice.
   */
  _lineManagerUserId?: string,
): Promise<void> {
  const { assignOfficer, overrideManager, confirmAssignmentPlan } =
    await import('../src/services/caseAssignmentService.ts');
  const { CONFIRMATION_KEYS } = await import('@exit/domain');
  const prisma = getPrisma();
  await assignOfficer(hrManagerActor, caseId, officerUserId, 'Integration test assignment.');
  const c = await prisma.offboardingCase.findUniqueOrThrow({
    where: { id: caseId },
    select: { employeeSourceSystem: true, employeeSourceId: true, managerSourceId: true },
  });
  if (!c.managerSourceId) {
    const alternate = await prisma.employeeSourceRecord.findFirst({
      where: {
        sourceSystem: c.employeeSourceSystem,
        active: true,
        NOT: [{ workEmail: null }, { workEmail: '' }, { sourceId: c.employeeSourceId }],
      },
      orderBy: { sourceId: 'asc' },
      select: { sourceId: true },
    });
    if (alternate)
      await overrideManager(
        hrManagerActor,
        caseId,
        alternate.sourceId,
        'Integration test routing.',
      );
  }
  await confirmAssignmentPlan(hrManagerActor, caseId, [...CONFIRMATION_KEYS]);
}

/**
 * Directive 6.3 AD: legacy-coverage helper. Temporarily restores the v1
 * workflow definitions as ACTIVE (lifecycle-only status flips, permitted by
 * the freeze trigger) so a test can activate a case pinned to the OLD
 * login-based workflow, then restores v2. Historical instances stay pinned
 * regardless - this only affects which definition NEW activations pick.
 */
export async function withLegacyV1Definitions<T>(fn: () => Promise<T>): Promise<T> {
  const prisma = getPrisma();
  const now = new Date();
  // Version-agnostic: remember whichever versions are ACTIVE now and put them
  // back afterwards. Hard-coding "v2" broke the moment v3 shipped, and at most
  // one version per type may be ACTIVE, so activating v1 alongside a live
  // version violates the partial unique index.
  const previouslyActive = await prisma.workflowDefinition.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.workflowDefinition.updateMany({
    where: { id: { in: previouslyActive.map((d) => d.id) } },
    data: { status: 'SUPERSEDED', supersededAt: now },
  });
  await prisma.workflowDefinition.updateMany({
    where: { version: 1, status: 'SUPERSEDED' },
    data: { status: 'ACTIVE', supersededAt: null },
  });
  try {
    return await fn();
  } finally {
    await prisma.workflowDefinition.updateMany({
      where: { version: 1, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await prisma.workflowDefinition.updateMany({
      where: { id: { in: previouslyActive.map((d) => d.id) } },
      data: { status: 'ACTIVE', supersededAt: null },
    });
  }
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
        displayName: 'HR Manager',
        workEmail: `dana.field-${randomUUID().slice(0, 8)}@example.test`,
        roleAssignments: { create: [{ role: 'HR_MANAGER', reason: 'integration test fixture' }] },
      },
    });
  }
  const { seedStage3 } = await import('../src/seedStage3.ts');
  await seedStage3(prisma);
  const { seedStage4 } = await import('../src/seedStage4.ts');
  await seedStage4(prisma);

  // Load the fixture organization into the directory, the way a real
  // deployment syncs BambooHR. Without it the directory holds only employees
  // a case happened to touch, and anything that reads the ORGANIZATION -
  // manager routing, the HR colleagues who can be copied on a letter - sees
  // an empty company.
  const { SYNTHETIC_EMPLOYEES } = await import('@exit/domain');
  for (const e of SYNTHETIC_EMPLOYEES) {
    await prisma.employeeSourceRecord.upsert({
      where: { sourceSystem_sourceId: { sourceSystem: e.sourceSystem, sourceId: e.sourceId } },
      create: {
        sourceSystem: e.sourceSystem,
        sourceId: e.sourceId,
        displayName: e.displayName,
        workEmail: e.workEmail,
        jobTitle: e.jobTitle,
        department: e.department,
        location: e.location,
        employeeNumber: e.employeeNumber ?? null,
        managerName: e.managerName ?? null,
        managerSourceId: e.managerSourceId ?? null,
        active: e.active ?? true,
        retrievedAt: new Date(),
        // The raw source record, exactly as a real sync stores it: the payload
        // is directory provenance, not a placeholder.
        payload: e as unknown as object,
      },
      update: {
        displayName: e.displayName,
        workEmail: e.workEmail,
        jobTitle: e.jobTitle,
        department: e.department,
        location: e.location,
        employeeNumber: e.employeeNumber ?? null,
        managerName: e.managerName ?? null,
        managerSourceId: e.managerSourceId ?? null,
        active: e.active ?? true,
      },
    });
  }
}
