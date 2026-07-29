-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RESIGNATION_ACCEPTANCE_WITH_NOTICE', 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT', 'OFFBOARDING_ACTION_FORM', 'MANUAL_EXCEPTION_DOCUMENT', 'TERMINATION_DOCUMENT_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'VALIDATION_FAILED', 'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'RENDERING', 'RENDERED', 'MANUALLY_ISSUED', 'SUPERSEDED', 'VOIDED', 'RENDER_FAILED');

-- CreateEnum
CREATE TYPE "IssueMethod" AS ENUM ('HAND_DELIVERY', 'REGISTERED_MAIL', 'OTHER_APPROVED');

-- CreateEnum
CREATE TYPE "RecipientClass" AS ENUM ('EMPLOYEE', 'AUTHORIZED_REPRESENTATIVE', 'INTERNAL_RECORD');

-- CreateEnum
CREATE TYPE "AttestationSubject" AS ENUM ('DOCUMENT', 'ACTION_FORM');

-- CreateEnum
CREATE TYPE "AttestationKind" AS ENUM ('HR_DOCUMENT_APPROVAL', 'MANAGER_FORM_APPROVAL', 'HR_FORM_FINAL_APPROVAL');

-- CreateEnum
CREATE TYPE "ActionFormStatus" AS ENUM ('DRAFT', 'RETURNED', 'PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'SUPERSEDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AcknowledgementStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'NOT_OBTAINED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'RATING_1_5', 'YES_NO_PNTS', 'SHORT_TEXT', 'LONG_TEXT');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'MANUALLY_SENT', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'INVALID_CONTACT', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "ResponseChannel" AS ENUM ('ONLINE_SURVEY', 'VERBAL_DEBRIEF', 'DECLINED', 'NOT_COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentPurpose" ADD VALUE 'MANUAL_EXCEPTION_DOCUMENT';
ALTER TYPE "AttachmentPurpose" ADD VALUE 'ACKNOWLEDGEMENT_EVIDENCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ParticipantRole" ADD VALUE 'FINANCE';
ALTER TYPE "ParticipantRole" ADD VALUE 'MANAGER';

-- CreateTable
CREATE TABLE "document_template" (
    "id" UUID NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "contentBody" TEXT NOT NULL,
    "allowedPlaceholders" TEXT[],
    "contentChecksum" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "document_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_instance" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "templateId" UUID,
    "templateVersion" INTEGER,
    "version" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "fieldSnapshot" JSONB NOT NULL,
    "contentSnapshot" TEXT,
    "contentChecksum" TEXT,
    "validationErrors" JSONB,
    "outdatedReason" TEXT,
    "returnReason" TEXT,
    "voidReason" TEXT,
    "exceptionAttachmentId" UUID,
    "exceptionReason" TEXT,
    "pdfObjectKey" TEXT,
    "pdfChecksum" TEXT,
    "renderAttempts" INTEGER NOT NULL DEFAULT 0,
    "renderError" TEXT,
    "issuedById" UUID,
    "issuedAt" TIMESTAMP(3),
    "issueMethod" "IssueMethod",
    "recipientClass" "RecipientClass",
    "issueNote" TEXT,
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "renderedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attestation" (
    "id" UUID NOT NULL,
    "subjectType" "AttestationSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "subjectVersion" INTEGER NOT NULL,
    "kind" "AttestationKind" NOT NULL,
    "caseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "actorDisplayName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,

    CONSTRAINT "attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_form_version" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ActionFormStatus" NOT NULL DEFAULT 'DRAFT',
    "fieldSnapshot" JSONB NOT NULL,
    "priorStatus" TEXT NOT NULL DEFAULT 'EMPLOYED',
    "newStatus" TEXT NOT NULL DEFAULT 'SEPARATED',
    "hrChecklist" JSONB NOT NULL,
    "financeChecklist" JSONB NOT NULL,
    "financeNotes" TEXT,
    "ackStatus" "AcknowledgementStatus" NOT NULL DEFAULT 'PENDING',
    "ackDate" TIMESTAMP(3),
    "ackMethod" TEXT,
    "ackReason" TEXT,
    "ackEvidenceAttachmentId" UUID,
    "hrRemarks" TEXT,
    "returnReason" TEXT,
    "voidReason" TEXT,
    "outdatedReason" TEXT,
    "pdfObjectKey" TEXT,
    "pdfChecksum" TEXT,
    "renderError" TEXT,
    "createdById" UUID NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_form_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_template" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "introText" TEXT NOT NULL,
    "privacyNotice" TEXT NOT NULL,
    "createdById" UUID,
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_question" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "maxLength" INTEGER,

    CONSTRAINT "survey_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_invitation" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "eligibilityNote" TEXT,
    "overrideReason" TEXT,
    "tokenHash" TEXT,
    "tokenGeneratedAt" TIMESTAMP(3),
    "invitationDueAt" TIMESTAMP(3) NOT NULL,
    "manualSentById" UUID,
    "manualSentAt" TIMESTAMP(3),
    "reminder1DueAt" TIMESTAMP(3),
    "reminder1SentAt" TIMESTAMP(3),
    "reminder2DueAt" TIMESTAMP(3),
    "reminder2SentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "responseChannel" "ResponseChannel",
    "completedAt" TIMESTAMP(3),
    "invalidContactNote" TEXT,
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_response" (
    "id" UUID NOT NULL,
    "invitationId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "channel" "ResponseChannel" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID,

    CONSTRAINT "survey_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answer" (
    "id" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "valueChoice" TEXT[],
    "valueRating" INTEGER,
    "valueText" TEXT,

    CONSTRAINT "survey_answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "render_job" (
    "id" UUID NOT NULL,
    "subjectType" "AttestationSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "correlationId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "render_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_template_documentType_status_idx" ON "document_template"("documentType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_documentType_version_key" ON "document_template"("documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_instance_pdfObjectKey_key" ON "document_instance"("pdfObjectKey");

-- CreateIndex
CREATE INDEX "document_instance_caseId_documentType_idx" ON "document_instance"("caseId", "documentType");

-- CreateIndex
CREATE INDEX "document_instance_status_idx" ON "document_instance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_instance_caseId_documentType_version_key" ON "document_instance"("caseId", "documentType", "version");

-- CreateIndex
CREATE INDEX "attestation_subjectType_subjectId_idx" ON "attestation"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "attestation_caseId_idx" ON "attestation"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "action_form_version_pdfObjectKey_key" ON "action_form_version"("pdfObjectKey");

-- CreateIndex
CREATE INDEX "action_form_version_status_idx" ON "action_form_version"("status");

-- CreateIndex
CREATE UNIQUE INDEX "action_form_version_caseId_version_key" ON "action_form_version"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "survey_template_code_version_key" ON "survey_template"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "survey_question_templateId_order_key" ON "survey_question"("templateId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "survey_invitation_tokenHash_key" ON "survey_invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "survey_invitation_caseId_idx" ON "survey_invitation"("caseId");

-- CreateIndex
CREATE INDEX "survey_invitation_status_idx" ON "survey_invitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "survey_response_invitationId_key" ON "survey_response"("invitationId");

-- CreateIndex
CREATE INDEX "survey_response_caseId_idx" ON "survey_response"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_answer_responseId_questionId_key" ON "survey_answer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "render_job_status_idx" ON "render_job"("status");

-- AddForeignKey
ALTER TABLE "document_instance" ADD CONSTRAINT "document_instance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_instance" ADD CONSTRAINT "document_instance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_form_version" ADD CONSTRAINT "action_form_version_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_question" ADD CONSTRAINT "survey_question_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "survey_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "survey_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "survey_invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer" ADD CONSTRAINT "survey_answer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_response"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer" ADD CONSTRAINT "survey_answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-authored guarantees (Directive 2 sections B/D/L/M).
-- ============================================================================

-- B.5: at most one ACTIVE template version per document type.
CREATE UNIQUE INDEX "uniq_active_template_per_type"
  ON "document_template" ("documentType")
  WHERE status = 'ACTIVE';

-- One current (non-superseded/voided) instance chain guard: at most one
-- instance per (case, type) in a live pre-supersession state.
CREATE UNIQUE INDEX "uniq_live_document_per_case_type"
  ON "document_instance" ("caseId", "documentType")
  WHERE status IN ('DRAFT','VALIDATION_FAILED','PENDING_APPROVAL','RETURNED','APPROVED','RENDERING','RENDERED','MANUALLY_ISSUED','RENDER_FAILED');

-- At most one live action form version per case.
CREATE UNIQUE INDEX "uniq_live_action_form_per_case"
  ON "action_form_version" ("caseId")
  WHERE status IN ('DRAFT','RETURNED','PENDING_MANAGER','PENDING_HR','APPROVED');

-- Evidence tables are never hard-deleted (REQ-CASE-015 discipline extended).
CREATE TRIGGER trg_document_template_no_delete
  BEFORE DELETE ON "document_template"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE TRIGGER trg_document_instance_no_delete
  BEFORE DELETE ON "document_instance"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE TRIGGER trg_attestation_no_delete
  BEFORE DELETE ON "attestation"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE TRIGGER trg_action_form_no_delete
  BEFORE DELETE ON "action_form_version"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE TRIGGER trg_survey_response_no_delete
  BEFORE DELETE ON "survey_response"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

CREATE TRIGGER trg_survey_answer_no_delete
  BEFORE DELETE ON "survey_answer"
  FOR EACH ROW EXECUTE FUNCTION offboarding_case_no_delete();

-- Attestation core columns are immutable; only invalidation fields may change.
CREATE OR REPLACE FUNCTION attestation_core_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."subjectVersion" IS DISTINCT FROM OLD."subjectVersion"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
     OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
     OR NEW."actorDisplayName" IS DISTINCT FROM OLD."actorDisplayName"
     OR NEW."actorRole" IS DISTINCT FROM OLD."actorRole"
     OR NEW."meaning" IS DISTINCT FROM OLD."meaning"
     OR NEW."contentChecksum" IS DISTINCT FROM OLD."contentChecksum"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'attestation core fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attestation_core_immutable
  BEFORE UPDATE ON "attestation"
  FOR EACH ROW EXECUTE FUNCTION attestation_core_immutable();

-- Survey responses/answers are append-only evidence: no updates permitted.
CREATE OR REPLACE FUNCTION survey_response_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'survey responses are append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_survey_response_no_update
  BEFORE UPDATE ON "survey_response"
  FOR EACH ROW EXECUTE FUNCTION survey_response_immutable();

CREATE TRIGGER trg_survey_answer_no_update
  BEFORE UPDATE ON "survey_answer"
  FOR EACH ROW EXECUTE FUNCTION survey_response_immutable();
