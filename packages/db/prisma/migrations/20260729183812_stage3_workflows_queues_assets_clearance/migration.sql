-- CreateEnum
CREATE TYPE "WorkflowDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PREVIEW', 'ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING', 'COMPLETED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskDepartment" AS ENUM ('HR', 'IT', 'FINANCE', 'LINE_MANAGER');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('STANDARD', 'ACCESS_REVOCATION');

-- CreateEnum
CREATE TYPE "DueBasis" AS ENUM ('CASE_RECEIVED', 'WORKFLOW_ACTIVATION', 'EFFECTIVE_SEPARATION', 'FINAL_WORKING_DAY', 'NONE');

-- CreateEnum
CREATE TYPE "DueOffsetKind" AS ENUM ('BUSINESS_DAYS', 'CALENDAR_DAYS', 'EXACT_TIME');

-- CreateEnum
CREATE TYPE "ReleaseBasis" AS ENUM ('IMMEDIATE', 'EFFECTIVE_SEPARATION');

-- CreateEnum
CREATE TYPE "TaskEvidenceKind" AS ENUM ('NONE', 'NOTE', 'ATTACHMENT', 'LINKED_RECORD');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('IT_ACCESS_REMOVAL', 'FINANCE_OFFBOARDING', 'LINE_MANAGER_HANDOVER', 'SAGICOR_GROUP_HEALTH_REMOVAL', 'NCB_GROUP_LIFE_REMOVAL', 'SURVEY_INVITATION_REFERENCE', 'MANUAL_EXCEPTION_NOTIFICATION');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND', 'MANUALLY_SENT', 'CANCELLED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "NotificationRecipient" AS ENUM ('INTERNAL_DEPARTMENT', 'EXTERNAL_PROVIDER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('EMPLOYEE_ID_CARD', 'ACCESS_CARD', 'HEALTH_CARD', 'LUNCH_CARD', 'UNIFORM', 'LAPTOP', 'MOBILE_PHONE', 'KEYS', 'EMPLOYEE_HANDBOOK', 'COMPANY_DOCUMENTS', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetRecoveryStatus" AS ENUM ('EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED', 'RETURNED', 'NOT_ISSUED', 'LOST', 'DAMAGED', 'WAIVED', 'WRITTEN_OFF', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_APPLICABLE', 'WAIVED');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('TASK_OVERDUE', 'CRITICAL_ACCESS_OVERDUE', 'TASK_BLOCKED', 'RENDER_FAILED', 'DOCUMENT_UNAPPROVED', 'NOTIFICATION_OVERDUE', 'NOTIFICATION_FAILED', 'ASSET_OVERDUE', 'ASSET_UNRESOLVED', 'HANDOVER_OVERDUE', 'MISSING_APPROVAL', 'INVALID_CASE_DATE', 'WORKFLOW_ACTIVATION_FAILURE', 'DUE_DATE_RETROSPECTIVE_CHANGE', 'CLEARANCE_BLOCKED');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentPurpose" ADD VALUE 'ASSET_EVIDENCE';
ALTER TYPE "AttachmentPurpose" ADD VALUE 'TASK_EVIDENCE';
ALTER TYPE "AttachmentPurpose" ADD VALUE 'HANDOVER_EVIDENCE';

-- AlterEnum
ALTER TYPE "AttestationKind" ADD VALUE 'MANAGER_HANDOVER_ATTESTATION';

-- AlterEnum
ALTER TYPE "AttestationSubject" ADD VALUE 'HANDOVER';

-- CreateTable
CREATE TABLE "workflow_definition" (
    "id" UUID NOT NULL,
    "workflowType" "DepartureType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkflowDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "activationConditions" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "changeReason" TEXT,
    "configChecksum" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task_definition" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "taskCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "department" "TaskDepartment" NOT NULL,
    "requiredRole" "Role" NOT NULL,
    "taskKind" "TaskKind" NOT NULL DEFAULT 'STANDARD',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "waiverAllowed" BOOLEAN NOT NULL DEFAULT false,
    "waiverAuthority" "Role" NOT NULL DEFAULT 'HR_MANAGER',
    "dueBasis" "DueBasis" NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "dueOffsetKind" "DueOffsetKind" NOT NULL DEFAULT 'BUSINESS_DAYS',
    "releaseBasis" "ReleaseBasis" NOT NULL DEFAULT 'IMMEDIATE',
    "releaseOffsetHours" INTEGER NOT NULL DEFAULT 0,
    "pausesOnHold" BOOLEAN NOT NULL DEFAULT true,
    "blockPausesSla" BOOLEAN NOT NULL DEFAULT false,
    "dependsOnCodes" TEXT[],
    "evidenceKind" "TaskEvidenceKind" NOT NULL DEFAULT 'NOTE',
    "evidenceNote" TEXT,
    "slaNote" TEXT,
    "escalationNote" TEXT,

    CONSTRAINT "workflow_task_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "workflowType" "DepartureType" NOT NULL,
    "configChecksum" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "activatedById" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,
    "requiredTaskCount" INTEGER NOT NULL DEFAULT 0,
    "completedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "waivedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "blockedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "overdueTaskCount" INTEGER NOT NULL DEFAULT 0,
    "completionPct" INTEGER NOT NULL DEFAULT 0,
    "clearanceReady" BOOLEAN NOT NULL DEFAULT false,
    "readinessDetail" JSONB,
    "readinessCheckedAt" TIMESTAMP(3),
    "holdStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "taskDefId" UUID,
    "taskCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "department" "TaskDepartment" NOT NULL,
    "requiredRole" "Role" NOT NULL,
    "taskKind" "TaskKind" NOT NULL DEFAULT 'STANDARD',
    "priority" "TaskPriority" NOT NULL,
    "confidential" BOOLEAN NOT NULL,
    "required" BOOLEAN NOT NULL,
    "waiverAllowed" BOOLEAN NOT NULL,
    "waiverAuthority" "Role" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_READY',
    "assigneeId" UUID,
    "dependsOnCodes" TEXT[],
    "pausesOnHold" BOOLEAN NOT NULL,
    "blockPausesSla" BOOLEAN NOT NULL,
    "releaseAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "originalDueAt" TIMESTAMP(3),
    "dueRule" TEXT,
    "dueSourceAt" TIMESTAMP(3),
    "dueCalendarVersion" INTEGER,
    "dueCalculatedAt" TIMESTAMP(3),
    "dueRecalcReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "startedById" UUID,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "blockerOwner" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" UUID,
    "waiverReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "completionNote" TEXT,
    "lateMinutes" INTEGER,
    "evidenceKind" "TaskEvidenceKind" NOT NULL DEFAULT 'NOTE',
    "evidenceAttachmentId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "accessSystems" TEXT[],
    "accessSystemsCompleted" TEXT[],
    "accessSystemsUnresolved" TEXT[],
    "accessResult" TEXT,
    "earlyCompletionReason" TEXT,
    "incidentRef" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_correction" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT,
    "reason" TEXT NOT NULL,
    "clearanceEffect" TEXT,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientClass" "NotificationRecipient" NOT NULL,
    "name" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "allowedPlaceholders" TEXT[],
    "minimumDataNote" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_record" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "templateId" UUID NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "recipientClass" "NotificationRecipient" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "subjectSnapshot" TEXT,
    "bodySnapshot" TEXT,
    "contentChecksum" TEXT,
    "fieldSnapshot" JSONB NOT NULL,
    "applicabilityNote" TEXT,
    "applicabilityConfirmedById" UUID,
    "applicabilityConfirmedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvalInvalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "readyAt" TIMESTAMP(3),
    "manualSentById" UUID,
    "manualSentAt" TIMESTAMP(3),
    "sentMethod" TEXT,
    "destinationRef" TEXT,
    "sentNote" TEXT,
    "cancelReason" TEXT,
    "failReason" TEXT,
    "supersededReason" TEXT,
    "createdById" UUID NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_capture" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "notification_capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_catalogue_item" (
    "id" UUID NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "label" TEXT NOT NULL,
    "trackIdentifier" BOOLEAN NOT NULL DEFAULT false,
    "issuingDepartment" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_catalogue_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_asset" (
    "id" UUID NOT NULL,
    "employeeSourceSystem" TEXT NOT NULL,
    "employeeSourceId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "catalogueLabel" TEXT NOT NULL,
    "identifier" TEXT,
    "serialNumber" TEXT,
    "issuingDepartment" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "currentHolderNote" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issued_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_recovery_item" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "issuedAssetId" UUID,
    "manuallyAdded" BOOLEAN NOT NULL DEFAULT false,
    "assetType" "AssetType" NOT NULL,
    "label" TEXT NOT NULL,
    "identifier" TEXT,
    "serialNumber" TEXT,
    "responsibleDepartment" "TaskDepartment" NOT NULL DEFAULT 'HR',
    "expectedReturnAt" TIMESTAMP(3),
    "requiredForClearance" BOOLEAN NOT NULL DEFAULT true,
    "status" "AssetRecoveryStatus" NOT NULL DEFAULT 'EXPECTED',
    "receivedById" UUID,
    "receivedAt" TIMESTAMP(3),
    "condition" TEXT,
    "remarks" TEXT,
    "evidenceAttachmentId" UUID,
    "exceptionOwnerId" UUID,
    "dispositionReason" TEXT,
    "dispositionById" UUID,
    "dispositionAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_recovery_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_record" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "requiredForClearance" BOOLEAN NOT NULL DEFAULT true,
    "managerId" UUID,
    "dutiesToReassign" TEXT,
    "openWorkDeadlines" TEXT,
    "customerVendorMatters" TEXT,
    "keyDocumentLocations" TEXT,
    "physicalFileLocations" TEXT,
    "replacementOwner" TEXT,
    "handoverSessions" TEXT,
    "trainingCompleted" TEXT,
    "unresolvedRisks" TEXT,
    "managerNotes" TEXT,
    "managerAttestedById" UUID,
    "managerAttestedAt" TIMESTAMP(3),
    "hrReviewedById" UUID,
    "hrReviewedAt" TIMESTAMP(3),
    "hrReviewNote" TEXT,
    "notApplicableReason" TEXT,
    "waiverReason" TEXT,
    "waivedById" UUID,
    "waivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_exception" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "exceptionType" "ExceptionType" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "refType" TEXT,
    "refId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "ownerDepartment" "TaskDepartment",
    "ownerId" UUID,
    "dueAt" TIMESTAMP(3),
    "securityExceptionApproved" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clearance_record" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "workflowInstanceId" UUID NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'APPROVED',
    "actorId" UUID NOT NULL,
    "actorDisplayName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "unresolvedApprovedExceptions" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clearance_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definition_workflowType_status_idx" ON "workflow_definition"("workflowType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definition_workflowType_version_key" ON "workflow_definition"("workflowType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_task_definition_definitionId_taskCode_key" ON "workflow_task_definition"("definitionId", "taskCode");

-- CreateIndex
CREATE INDEX "workflow_instance_caseId_idx" ON "workflow_instance"("caseId");

-- CreateIndex
CREATE INDEX "workflow_instance_status_idx" ON "workflow_instance"("status");

-- CreateIndex
CREATE INDEX "workflow_task_caseId_idx" ON "workflow_task"("caseId");

-- CreateIndex
CREATE INDEX "workflow_task_department_status_idx" ON "workflow_task"("department", "status");

-- CreateIndex
CREATE INDEX "workflow_task_assigneeId_status_idx" ON "workflow_task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "workflow_task_status_dueAt_idx" ON "workflow_task"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_task_instanceId_taskCode_key" ON "workflow_task"("instanceId", "taskCode");

-- CreateIndex
CREATE INDEX "task_correction_taskId_idx" ON "task_correction"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_notificationType_version_key" ON "notification_template"("notificationType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "notification_record_idempotencyKey_key" ON "notification_record"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_record_caseId_idx" ON "notification_record"("caseId");

-- CreateIndex
CREATE INDEX "notification_record_status_idx" ON "notification_record"("status");

-- CreateIndex
CREATE INDEX "notification_capture_recordId_idx" ON "notification_capture"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_catalogue_item_label_key" ON "asset_catalogue_item"("label");

-- CreateIndex
CREATE INDEX "issued_asset_employeeSourceId_idx" ON "issued_asset"("employeeSourceId");

-- CreateIndex
CREATE INDEX "asset_recovery_item_caseId_idx" ON "asset_recovery_item"("caseId");

-- CreateIndex
CREATE INDEX "asset_recovery_item_status_idx" ON "asset_recovery_item"("status");

-- CreateIndex
CREATE UNIQUE INDEX "handover_record_caseId_key" ON "handover_record"("caseId");

-- CreateIndex
CREATE INDEX "case_exception_caseId_status_idx" ON "case_exception"("caseId", "status");

-- CreateIndex
CREATE INDEX "case_exception_exceptionType_status_idx" ON "case_exception"("exceptionType", "status");

-- CreateIndex
CREATE INDEX "case_exception_status_severity_idx" ON "case_exception"("status", "severity");

-- CreateIndex
CREATE INDEX "clearance_record_caseId_idx" ON "clearance_record"("caseId");

-- AddForeignKey
ALTER TABLE "workflow_task_definition" ADD CONSTRAINT "workflow_task_definition_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_taskDefId_fkey" FOREIGN KEY ("taskDefId") REFERENCES "workflow_task_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_correction" ADD CONSTRAINT "task_correction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflow_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_record" ADD CONSTRAINT "notification_record_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_record" ADD CONSTRAINT "notification_record_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "notification_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_capture" ADD CONSTRAINT "notification_capture_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "notification_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_recovery_item" ADD CONSTRAINT "asset_recovery_item_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_recovery_item" ADD CONSTRAINT "asset_recovery_item_issuedAssetId_fkey" FOREIGN KEY ("issuedAssetId") REFERENCES "issued_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_record" ADD CONSTRAINT "handover_record_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_exception" ADD CONSTRAINT "case_exception_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_record" ADD CONSTRAINT "clearance_record_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-authored guarantees (Directive 3 sections B/C/N/O/S).
-- ============================================================================

-- B.5: at most one ACTIVE workflow-definition version per workflow type.
CREATE UNIQUE INDEX "uniq_active_workflow_def_per_type"
  ON "workflow_definition" ("workflowType")
  WHERE status = 'ACTIVE';

-- C.3: at most one live workflow instance per case (duplicate-activation guard).
CREATE UNIQUE INDEX "uniq_live_workflow_instance_per_case"
  ON "workflow_instance" ("caseId")
  WHERE status IN ('ACTIVE','ON_HOLD','CLEARANCE_PENDING');

-- N: open exceptions are deduplicated per (case, type, reference).
CREATE UNIQUE INDEX "uniq_open_exception_per_ref"
  ON "case_exception" ("caseId", "exceptionType", COALESCE("refId",''))
  WHERE status = 'OPEN';

-- Workflow evidence is never hard-deleted (fixed default 24).
CREATE TRIGGER trg_workflow_definition_no_delete
  BEFORE DELETE ON "workflow_definition"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_workflow_task_definition_no_delete
  BEFORE DELETE ON "workflow_task_definition"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_workflow_instance_no_delete
  BEFORE DELETE ON "workflow_instance"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_workflow_task_no_delete
  BEFORE DELETE ON "workflow_task"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_task_correction_no_delete
  BEFORE DELETE ON "task_correction"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_notification_template_no_delete
  BEFORE DELETE ON "notification_template"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_notification_record_no_delete
  BEFORE DELETE ON "notification_record"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_notification_capture_no_delete
  BEFORE DELETE ON "notification_capture"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_issued_asset_no_delete
  BEFORE DELETE ON "issued_asset"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_asset_recovery_item_no_delete
  BEFORE DELETE ON "asset_recovery_item"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_handover_record_no_delete
  BEFORE DELETE ON "handover_record"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_case_exception_no_delete
  BEFORE DELETE ON "case_exception"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_clearance_record_no_delete
  BEFORE DELETE ON "clearance_record"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

-- B.3: ACTIVE (and later) workflow-definition versions are content-immutable;
-- only lifecycle columns may change after leaving DRAFT.
CREATE OR REPLACE FUNCTION workflow_definition_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW."workflowType"         IS DISTINCT FROM OLD."workflowType"
       OR NEW.name                IS DISTINCT FROM OLD.name
       OR NEW.version             IS DISTINCT FROM OLD.version
       OR NEW.description         IS DISTINCT FROM OLD.description
       OR NEW."activationConditions" IS DISTINCT FROM OLD."activationConditions"
       OR NEW."effectiveDate"     IS DISTINCT FROM OLD."effectiveDate"
       OR NEW."configChecksum"    IS DISTINCT FROM OLD."configChecksum"
       OR NEW."createdById"       IS DISTINCT FROM OLD."createdById"
       OR NEW."createdAt"         IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'non-draft workflow definition versions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workflow_definition_frozen
  BEFORE UPDATE ON "workflow_definition"
  FOR EACH ROW EXECUTE FUNCTION workflow_definition_frozen();

-- Task definitions freeze with their definition version.
CREATE OR REPLACE FUNCTION workflow_task_definition_frozen() RETURNS trigger AS $$
DECLARE def_status text;
BEGIN
  SELECT status::text INTO def_status
    FROM "workflow_definition" WHERE id = OLD."definitionId";
  IF def_status IS NOT NULL AND def_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'task definitions of a non-draft workflow version are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workflow_task_definition_frozen
  BEFORE UPDATE ON "workflow_task_definition"
  FOR EACH ROW EXECUTE FUNCTION workflow_task_definition_frozen();

-- O: clearance records and task corrections are append-only evidence.
CREATE OR REPLACE FUNCTION stage3_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'this record is append-only evidence: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clearance_record_no_update
  BEFORE UPDATE ON "clearance_record"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();
CREATE TRIGGER trg_task_correction_no_update
  BEFORE UPDATE ON "task_correction"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();
CREATE TRIGGER trg_notification_capture_no_update
  BEFORE UPDATE ON "notification_capture"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();

-- I.9 / D.10: access-revocation tasks can never be waived (defence in depth
-- behind the service rule).
CREATE OR REPLACE FUNCTION access_task_never_waived() RETURNS trigger AS $$
BEGIN
  IF NEW."taskKind" = 'ACCESS_REVOCATION' AND NEW.status = 'WAIVED' THEN
    RAISE EXCEPTION 'access-revocation tasks cannot be waived';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_access_task_never_waived
  BEFORE INSERT OR UPDATE ON "workflow_task"
  FOR EACH ROW EXECUTE FUNCTION access_task_never_waived();
