-- CreateEnum
CREATE TYPE "Role" AS ENUM ('HR_MANAGER', 'HR_OFFICER', 'IT_RESPONDER', 'FINANCE_RESPONDER', 'LINE_MANAGER', 'AUDITOR', 'PRIVACY_OFFICER', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "DepartureType" AS ENUM ('RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', 'TERMINATION');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'PENDING_HR_REVIEW', 'APPROVED', 'ACTIVE', 'CLEARANCE_REVIEW', 'COMPLETED', 'ON_HOLD', 'CANCELLED', 'VOIDED', 'REOPENED');

-- CreateEnum
CREATE TYPE "CaseClassification" AS ENUM ('CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "MeasurementCohort" AS ENUM ('BASELINE', 'PILOT', 'POST_ROLLOUT');

-- CreateEnum
CREATE TYPE "RecordPurpose" AS ENUM ('OPERATIONAL', 'TRAINING', 'TEST');

-- CreateEnum
CREATE TYPE "ReasonCaptureStatus" AS ENUM ('PENDING', 'PROVIDED', 'NOT_PROVIDED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "RehireEligibility" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('OWNER', 'HR_SUPPORT', 'OVERSIGHT');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'SCANNER_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('RESIGNATION_LETTER', 'SUPPORTING_DOCUMENT');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "BaselineEventType" AS ENUM ('DOCUMENT_REQUESTED', 'DOCUMENT_APPROVED', 'DOCUMENT_ISSUED', 'NOTIFICATION_SENT', 'ACCESS_REMOVAL_REQUESTED', 'ACCESS_REMOVAL_DUE', 'ACCESS_REMOVAL_COMPLETED', 'ASSET_DUE', 'ASSET_RETURNED', 'ASSET_DISPOSITION_RECORDED', 'EXIT_FEEDBACK_OFFERED', 'EXIT_FEEDBACK_COMPLETED', 'PROCESS_COMPLETED');

-- CreateEnum
CREATE TYPE "MissingReason" AS ENUM ('NOT_RECORDED_CURRENT_PROCESS', 'SOURCE_UNAVAILABLE', 'NOT_APPLICABLE', 'CASE_IN_PROGRESS', 'DISPUTED', 'UNKNOWN_OTHER');

-- CreateEnum
CREATE TYPE "ConfigListKind" AS ENUM ('DEPARTMENT', 'LOCATION');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('HR_ONLY', 'HR_AND_OVERSIGHT');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "identitySubject" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "workEmail" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revokeReason" TEXT,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_source_record" (
    "id" UUID NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "workEmail" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "location" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "employee_source_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offboarding_case" (
    "id" UUID NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "departureType" "DepartureType" NOT NULL,
    "classification" "CaseClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "measurementCohort" "MeasurementCohort",
    "recordPurpose" "RecordPurpose" NOT NULL DEFAULT 'OPERATIONAL',
    "employeeSourceSystem" TEXT NOT NULL,
    "employeeSourceId" TEXT NOT NULL,
    "employeeDisplayName" TEXT NOT NULL,
    "employeeWorkEmail" TEXT,
    "department" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "jobTitle" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receiptSource" TEXT NOT NULL,
    "proposedLastDay" TIMESTAMP(3),
    "confirmedLastDay" TIMESTAMP(3),
    "effectiveSeparationAt" TIMESTAMP(3),
    "noticeProvidedDays" INTEGER,
    "noticeRequiredDays" INTEGER,
    "noticeTreatment" TEXT,
    "reasonCategoryId" UUID,
    "reasonCaptureStatus" "ReasonCaptureStatus" NOT NULL DEFAULT 'PENDING',
    "reasonNotes" TEXT,
    "rehireEligibility" "RehireEligibility",
    "ownerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,

    CONSTRAINT "offboarding_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_snapshot" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,

    CONSTRAINT "employee_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_status_history" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "fromStatus" "CaseStatus",
    "toStatus" "CaseStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_participant" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "participantRole" "ParticipantRole" NOT NULL,
    "reason" TEXT,
    "addedById" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,
    "removeReason" TEXT,

    CONSTRAINT "case_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_note" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'HR_ONLY',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,

    CONSTRAINT "case_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "purpose" "AttachmentPurpose" NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanNote" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "effectiveRoles" TEXT[],
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "caseId" UUID,
    "result" "AuditResult" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "appVersion" TEXT NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_event" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "eventType" "BaselineEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "missingReason" "MissingReason",
    "missingNote" TEXT,
    "detail" TEXT,
    "evidenceRef" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" UUID,
    "supersedeReason" TEXT,

    CONSTRAINT "baseline_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendar" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Jamaica',
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reason_category" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "taxonomyVersion" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isTestOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reason_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "config_list_item" (
    "id" UUID NOT NULL,
    "kind" "ConfigListKind" NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_list_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_number_counter" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "case_number_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "integration_placeholder" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'stub',
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "integration_placeholder_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_identitySubject_key" ON "app_user"("identitySubject");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_workEmail_key" ON "app_user"("workEmail");

-- CreateIndex
CREATE INDEX "role_assignment_userId_role_idx" ON "role_assignment"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "employee_source_record_sourceSystem_sourceId_key" ON "employee_source_record"("sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "offboarding_case_caseNumber_key" ON "offboarding_case"("caseNumber");

-- CreateIndex
CREATE INDEX "offboarding_case_status_idx" ON "offboarding_case"("status");

-- CreateIndex
CREATE INDEX "offboarding_case_ownerId_idx" ON "offboarding_case"("ownerId");

-- CreateIndex
CREATE INDEX "offboarding_case_effectiveSeparationAt_idx" ON "offboarding_case"("effectiveSeparationAt");

-- CreateIndex
CREATE INDEX "offboarding_case_measurementCohort_recordPurpose_idx" ON "offboarding_case"("measurementCohort", "recordPurpose");

-- CreateIndex
CREATE INDEX "offboarding_case_employeeSourceId_idx" ON "offboarding_case"("employeeSourceId");

-- CreateIndex
CREATE INDEX "offboarding_case_departureType_idx" ON "offboarding_case"("departureType");

-- CreateIndex
CREATE UNIQUE INDEX "employee_snapshot_caseId_key" ON "employee_snapshot"("caseId");

-- CreateIndex
CREATE INDEX "case_status_history_caseId_occurredAt_idx" ON "case_status_history"("caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "case_participant_caseId_idx" ON "case_participant"("caseId");

-- CreateIndex
CREATE INDEX "case_participant_userId_idx" ON "case_participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "case_note_supersedesId_key" ON "case_note"("supersedesId");

-- CreateIndex
CREATE INDEX "case_note_caseId_createdAt_idx" ON "case_note"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_objectKey_key" ON "attachment"("objectKey");

-- CreateIndex
CREATE INDEX "attachment_caseId_idx" ON "attachment"("caseId");

-- CreateIndex
CREATE INDEX "audit_event_caseId_occurredAt_idx" ON "audit_event"("caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_eventType_occurredAt_idx" ON "audit_event"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_actorId_occurredAt_idx" ON "audit_event"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "baseline_event_caseId_eventType_idx" ON "baseline_event"("caseId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendar_name_version_key" ON "holiday_calendar"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendarId_date_key" ON "holiday"("calendarId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "reason_category_code_key" ON "reason_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "config_list_item_kind_value_key" ON "config_list_item"("kind", "value");

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_case" ADD CONSTRAINT "offboarding_case_reasonCategoryId_fkey" FOREIGN KEY ("reasonCategoryId") REFERENCES "reason_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_case" ADD CONSTRAINT "offboarding_case_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_case" ADD CONSTRAINT "offboarding_case_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_snapshot" ADD CONSTRAINT "employee_snapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_status_history" ADD CONSTRAINT "case_status_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "case_note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_event" ADD CONSTRAINT "baseline_event_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "holiday_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-authored guarantees (Directive 1). Prisma cannot express these in the
-- schema language; they are part of the reviewed migration.
-- ============================================================================

-- REQ-CASE-013: measurement cohort and record purpose pairing.
-- OPERATIONAL requires a cohort; TRAINING/TEST forbid one.
ALTER TABLE "offboarding_case"
  ADD CONSTRAINT "chk_cohort_purpose" CHECK (
    ("recordPurpose" = 'OPERATIONAL' AND "measurementCohort" IS NOT NULL)
    OR ("recordPurpose" IN ('TRAINING', 'TEST') AND "measurementCohort" IS NULL)
  );

-- REQ-SEC-024: business audit events are append-only.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_event_no_update
  BEFORE UPDATE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

CREATE TRIGGER trg_audit_event_no_delete
  BEFORE DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

-- REQ-CASE-015: offboarding cases are never hard-deleted; cancel or void.
CREATE OR REPLACE FUNCTION offboarding_case_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'offboarding_case rows cannot be hard-deleted; cancel or void instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_no_delete
  BEFORE DELETE ON "offboarding_case"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

-- Status history and snapshots are historical evidence: no deletes.
CREATE TRIGGER trg_status_history_no_delete
  BEFORE DELETE ON "case_status_history"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE OR REPLACE FUNCTION employee_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'employee_snapshot is immutable: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- REQ-CASE-004: the approved snapshot never changes.
CREATE TRIGGER trg_snapshot_no_update
  BEFORE UPDATE ON "employee_snapshot"
  FOR EACH ROW EXECUTE FUNCTION employee_snapshot_immutable();

CREATE TRIGGER trg_snapshot_no_delete
  BEFORE DELETE ON "employee_snapshot"
  FOR EACH ROW EXECUTE FUNCTION employee_snapshot_immutable();
