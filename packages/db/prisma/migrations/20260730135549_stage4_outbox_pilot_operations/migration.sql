-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('ACTIVE', 'PENDING', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'CLAIMED', 'SUBMITTED', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELLED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "RecipientClassDir" AS ENUM ('IT_OFFBOARDING', 'FINANCE_OFFBOARDING', 'HR_OFFBOARDING', 'LINE_MANAGER', 'SAGICOR_GROUP_HEALTH', 'NCB_GROUP_LIFE', 'EMPLOYEE_PERSONAL', 'OTHER_APPROVED_EXTERNAL');

-- CreateEnum
CREATE TYPE "RecipientApprovalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ActivationState" AS ENUM ('DISABLED', 'TEST_ONLY', 'TRAINING_ENABLED', 'PILOT_READY', 'PILOT_ACTIVE', 'POST_ROLLOUT_READY', 'POST_ROLLOUT_ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'INTEGRATION_FAILURE', 'SECURITY_PRIVACY_INCIDENT', 'DATA_CORRECTION', 'ACCESS_REQUEST', 'CONFIGURATION_ISSUE');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OutageStatus" AS ENUM ('DECLARED', 'RESTORED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RetentionRunMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "DsrType" AS ENUM ('ACCESS', 'CORRECTION', 'EXPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScanStatus" ADD VALUE 'QUARANTINED';
ALTER TYPE "ScanStatus" ADD VALUE 'INFECTED';
ALTER TYPE "ScanStatus" ADD VALUE 'SCAN_FAILED';

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "department" TEXT,
ADD COLUMN     "identitySource" TEXT NOT NULL DEFAULT 'dev',
ADD COLUMN     "lastSignInAt" TIMESTAMP(3),
ADD COLUMN     "managerUserId" UUID,
ADD COLUMN     "provisioningStatus" "ProvisioningStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "sessionsInvalidatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "holiday_calendar" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "offboarding_case" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "anonymizedById" UUID;

-- AlterTable
ALTER TABLE "reason_category" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "departureTypes" "DepartureType"[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "reportingGroup" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "sensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voluntary" BOOLEAN;

-- AlterTable
ALTER TABLE "role_assignment" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "notificationRecordId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "recipientClass" "RecipientClassDir" NOT NULL,
    "recipientConfigId" UUID,
    "destinationMask" TEXT NOT NULL,
    "subjectSnapshot" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "providerMessageRef" TEXT,
    "deliveryStatus" TEXT,
    "lastErrorCode" TEXT,
    "cancelReason" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "correlationId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipient_config" (
    "id" UUID NOT NULL,
    "recipientClass" "RecipientClassDir" NOT NULL,
    "displayName" TEXT NOT NULL,
    "destinationCiphertext" TEXT NOT NULL,
    "destinationMask" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'development',
    "allowedTypes" "NotificationType"[],
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "approvalStatus" "RecipientApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "changeReason" TEXT,
    "createdById" UUID NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "secretRef" TEXT,
    "reason" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "access_review" (
    "id" UUID NOT NULL,
    "generatedById" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "note" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "access_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_sync_run" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatches" JSONB,
    "startedById" UUID,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "employee_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_activation" (
    "id" UUID NOT NULL,
    "state" "ActivationState" NOT NULL,
    "environment" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "startDate" TIMESTAMP(3),
    "enabledIntegrations" JSONB NOT NULL,
    "approvedWorkflowVersions" JSONB NOT NULL,
    "approvedTemplateVersions" JSONB NOT NULL,
    "approvedCalendarVersion" INTEGER,
    "conditions" TEXT,
    "rollbackPlan" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "hrApprovedById" UUID,
    "hrApprovedAt" TIMESTAMP(3),
    "adminApprovedById" UUID,
    "adminApprovedAt" TIMESTAMP(3),
    "privacyApprovedById" UUID,
    "privacyApprovedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "correlationId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_activation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_report" (
    "id" UUID NOT NULL,
    "reportKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "recipientClass" "RecipientClassDir" NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "filters" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdById" UUID NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_run" (
    "id" UUID NOT NULL,
    "scheduledReportId" UUID NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "objectKey" TEXT,
    "error" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "recordType" TEXT NOT NULL,
    "retainYears" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_hold" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "placedById" UUID NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" UUID,
    "releasedAt" TIMESTAMP(3),
    "releaseNote" TEXT,

    CONSTRAINT "retention_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_run" (
    "id" UUID NOT NULL,
    "mode" "RetentionRunMode" NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "findings" JSONB NOT NULL,
    "executedCount" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "retention_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disclosure_log" (
    "id" UUID NOT NULL,
    "caseId" UUID,
    "subjectRef" TEXT NOT NULL,
    "disclosedTo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "disclosedById" UUID NOT NULL,
    "disclosedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "disclosure_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_request" (
    "id" UUID NOT NULL,
    "type" "DsrType" NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "packageObjectKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledById" UUID,
    "completedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_subject_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_record" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DATABASE',
    "objectPath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "backup_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outage" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "OutageStatus" NOT NULL DEFAULT 'DECLARED',
    "declaredById" UUID NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fallback_entry" (
    "id" UUID NOT NULL,
    "outageId" UUID NOT NULL,
    "refNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledCaseId" UUID,
    "reconciledById" UUID,
    "reconciledAt" TIMESTAMP(3),
    "reconcileNote" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fallback_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket" (
    "id" UUID NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'development',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedComponent" TEXT,
    "reporterId" UUID NOT NULL,
    "ownerId" UUID,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "linkedExceptionId" UUID,
    "linkedCaseId" UUID,
    "correlationId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_completion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "module" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_completion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_idempotencyKey_key" ON "notification_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_outbox_status_nextAttemptAt_idx" ON "notification_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_outbox_notificationRecordId_idx" ON "notification_outbox"("notificationRecordId");

-- CreateIndex
CREATE INDEX "recipient_config_recipientClass_environment_idx" ON "recipient_config"("recipientClass", "environment");

-- CreateIndex
CREATE INDEX "pilot_activation_state_idx" ON "pilot_activation"("state");

-- CreateIndex
CREATE INDEX "report_run_scheduledReportId_idx" ON "report_run"("scheduledReportId");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_recordType_version_key" ON "retention_policy"("recordType", "version");

-- CreateIndex
CREATE INDEX "retention_hold_caseId_idx" ON "retention_hold"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "fallback_entry_refNumber_key" ON "fallback_entry"("refNumber");

-- CreateIndex
CREATE INDEX "fallback_entry_outageId_idx" ON "fallback_entry"("outageId");

-- CreateIndex
CREATE INDEX "support_ticket_status_severity_idx" ON "support_ticket"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "training_completion_userId_module_key" ON "training_completion"("userId", "module");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notificationRecordId_fkey" FOREIGN KEY ("notificationRecordId") REFERENCES "notification_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_run" ADD CONSTRAINT "report_run_scheduledReportId_fkey" FOREIGN KEY ("scheduledReportId") REFERENCES "scheduled_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_hold" ADD CONSTRAINT "retention_hold_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fallback_entry" ADD CONSTRAINT "fallback_entry_outageId_fkey" FOREIGN KEY ("outageId") REFERENCES "outage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-authored guarantees (Directive 4 sections B/L/P/Q/W).
-- ============================================================================

-- Outbox, delivery and operational evidence is never hard-deleted.
CREATE TRIGGER trg_notification_outbox_no_delete
  BEFORE DELETE ON "notification_outbox"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_recipient_config_no_delete
  BEFORE DELETE ON "recipient_config"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_pilot_activation_no_delete
  BEFORE DELETE ON "pilot_activation"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_access_review_no_delete
  BEFORE DELETE ON "access_review"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_employee_sync_run_no_delete
  BEFORE DELETE ON "employee_sync_run"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_scheduled_report_no_delete
  BEFORE DELETE ON "scheduled_report"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_report_run_no_delete
  BEFORE DELETE ON "report_run"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_retention_policy_no_delete
  BEFORE DELETE ON "retention_policy"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_retention_hold_no_delete
  BEFORE DELETE ON "retention_hold"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_retention_run_no_delete
  BEFORE DELETE ON "retention_run"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_disclosure_log_no_delete
  BEFORE DELETE ON "disclosure_log"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_data_subject_request_no_delete
  BEFORE DELETE ON "data_subject_request"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_backup_record_no_delete
  BEFORE DELETE ON "backup_record"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_outage_no_delete
  BEFORE DELETE ON "outage"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_fallback_entry_no_delete
  BEFORE DELETE ON "fallback_entry"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_support_ticket_no_delete
  BEFORE DELETE ON "support_ticket"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_training_completion_no_delete
  BEFORE DELETE ON "training_completion"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

-- Append-only evidence: reviews, sync runs, retention runs, disclosures.
CREATE TRIGGER trg_access_review_no_update
  BEFORE UPDATE ON "access_review"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();
CREATE TRIGGER trg_retention_run_no_update
  BEFORE UPDATE ON "retention_run"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();
CREATE TRIGGER trg_disclosure_log_no_update
  BEFORE UPDATE ON "disclosure_log"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();
CREATE TRIGGER trg_report_run_no_update
  BEFORE UPDATE ON "report_run"
  FOR EACH ROW EXECUTE FUNCTION stage3_append_only();

-- Backup evidence: core fields immutable; only verification may be added.
CREATE OR REPLACE FUNCTION backup_record_core_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW."objectPath" IS DISTINCT FROM OLD."objectPath"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'backup record core fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_backup_record_core_immutable
  BEFORE UPDATE ON "backup_record"
  FOR EACH ROW EXECUTE FUNCTION backup_record_core_immutable();

-- Pilot activation records: core scope/checksum freeze once created; only
-- approval and lifecycle columns may change (section L.5 / W).
CREATE OR REPLACE FUNCTION pilot_activation_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.cohort IS DISTINCT FROM OLD.cohort
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW."enabledIntegrations" IS DISTINCT FROM OLD."enabledIntegrations"
     OR NEW."approvedWorkflowVersions" IS DISTINCT FROM OLD."approvedWorkflowVersions"
     OR NEW."approvedTemplateVersions" IS DISTINCT FROM OLD."approvedTemplateVersions"
     OR NEW."approvedCalendarVersion" IS DISTINCT FROM OLD."approvedCalendarVersion"
     OR NEW."rollbackPlan" IS DISTINCT FROM OLD."rollbackPlan"
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'pilot activation core fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_pilot_activation_frozen
  BEFORE UPDATE ON "pilot_activation"
  FOR EACH ROW EXECUTE FUNCTION pilot_activation_frozen();
