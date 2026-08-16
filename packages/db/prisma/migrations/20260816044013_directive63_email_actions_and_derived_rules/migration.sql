-- CreateEnum
CREATE TYPE "NotificationOrigin" AS ENUM ('MANUAL', 'DERIVED');

-- CreateEnum
CREATE TYPE "BenefitsApplicability" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RequiredActionGroup" AS ENUM ('HR', 'DOCUMENTS', 'MANAGER_HANDOVER', 'IT', 'FINANCE', 'BENEFITS', 'ASSETS', 'SURVEY', 'CLEARANCE');

-- CreateEnum
CREATE TYPE "RequiredActionKind" AS ENUM ('EMAIL_ACTION', 'ASSET_RECOVERY', 'SURVEY_INVITATION', 'BENEFITS_CONFIRMATION');

-- CreateEnum
CREATE TYPE "DerivationResult" AS ENUM ('DERIVED', 'DEFAULTED', 'REQUIRES_REVIEW', 'EXCEPTION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('ACKNOWLEDGE_RECEIPT', 'CONFIRM_COMPLETION');

-- AlterTable
ALTER TABLE "action_form_version" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" UUID,
ADD COLUMN     "hrReviewedAt" TIMESTAMP(3),
ADD COLUMN     "hrReviewedById" UUID,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" UUID;

-- AlterTable
ALTER TABLE "notification_record" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedVia" TEXT,
ADD COLUMN     "caseRecipientCiphertext" TEXT,
ADD COLUMN     "caseRecipientMask" TEXT,
ADD COLUMN     "completionConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "completionEvidenceNote" TEXT,
ADD COLUMN     "completionRecordedById" UUID,
ADD COLUMN     "controlLevel" TEXT,
ADD COLUMN     "derivedActionId" UUID,
ADD COLUMN     "origin" "NotificationOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "recipientConfigId" UUID,
ADD COLUMN     "recipientKind" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "recipientOrg" TEXT,
ADD COLUMN     "scheduledSendAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "offboarding_case" ADD COLUMN     "benefitsConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "benefitsConfirmedById" UUID,
ADD COLUMN     "benefitsSource" TEXT,
ADD COLUMN     "groupHealthApplicability" "BenefitsApplicability" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "groupLifeApplicability" "BenefitsApplicability" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "otherProviderApplicability" "BenefitsApplicability" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "recipient_config" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "organizationName" TEXT,
ADD COLUMN     "purpose" TEXT;

-- CreateTable
CREATE TABLE "case_required_action" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "workflowInstanceId" UUID,
    "actionKey" TEXT NOT NULL,
    "actionGroup" "RequiredActionGroup" NOT NULL,
    "kind" "RequiredActionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL,
    "determination" "DerivationResult" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "sourceFields" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "derivedAt" TIMESTAMP(3) NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overriddenById" UUID,
    "overriddenAt" TIMESTAMP(3),
    "refType" TEXT,
    "refId" UUID,
    "supersededAt" TIMESTAMP(3),
    "supersededReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_required_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_token" (
    "id" UUID NOT NULL,
    "notificationRecordId" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedNote" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_required_action_caseId_actionGroup_idx" ON "case_required_action"("caseId", "actionGroup");

-- CreateIndex
CREATE UNIQUE INDEX "case_required_action_caseId_actionKey_key" ON "case_required_action"("caseId", "actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "action_token_tokenHash_key" ON "action_token"("tokenHash");

-- CreateIndex
CREATE INDEX "action_token_notificationRecordId_idx" ON "action_token"("notificationRecordId");

-- CreateIndex
CREATE INDEX "notification_record_origin_scheduledSendAt_idx" ON "notification_record"("origin", "scheduledSendAt");

-- AddForeignKey
ALTER TABLE "notification_record" ADD CONSTRAINT "notification_record_derivedActionId_fkey" FOREIGN KEY ("derivedActionId") REFERENCES "case_required_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_required_action" ADD CONSTRAINT "case_required_action_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_token" ADD CONSTRAINT "action_token_notificationRecordId_fkey" FOREIGN KEY ("notificationRecordId") REFERENCES "notification_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Directive 6.3 F: the one-live-form-per-case guard must recognize the union
-- of legacy live statuses (historical rows may still carry them) and the new
-- HR-validated lifecycle statuses. This is why the enum additions live in a
-- SEPARATE earlier migration: new enum values cannot be referenced in the
-- transaction that adds them.
DROP INDEX "uniq_live_action_form_per_case";
CREATE UNIQUE INDEX "uniq_live_action_form_per_case"
  ON "action_form_version" ("caseId")
  WHERE status IN (
    'DRAFT','RETURNED','PENDING_MANAGER','PENDING_HR','APPROVED',
    'READY_FOR_HR_REVIEW','HR_REVIEWED','COMPLETE','RETURNED_FOR_CORRECTION'
  );

-- House guarantee: evidence tables are never hard-deleted (REQ-CASE-015
-- discipline extended to the Directive 6.3 tables).
CREATE TRIGGER trg_case_required_action_no_delete
  BEFORE DELETE ON "case_required_action"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
CREATE TRIGGER trg_action_token_no_delete
  BEFORE DELETE ON "action_token"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();
