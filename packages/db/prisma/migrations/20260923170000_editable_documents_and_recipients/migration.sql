-- Editable generated forms, PDF downloads, asset receipt records and
-- flexible email recipients (owner directive, 2026-09-23; DEC-069).

-- 1. Vocabulary.
DO $$ BEGIN
  CREATE TYPE "DocumentKind" AS ENUM ('LETTER', 'ACTION_FORM', 'ASSET_RECEIPT', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "RevisionKind" AS ENUM ('GENERATED', 'EDITED', 'FIELDS_REFRESHED', 'FINALIZED', 'SUPERSEDED', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "RecipientOverrideKind" AS ENUM ('RECIPIENT', 'ADDRESS', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ReceiptLifecycle" AS ENUM ('DRAFT', 'READY', 'FINAL', 'SUPERSEDED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SignatureDocumentKind" AS ENUM ('ACTION_FORM', 'ASSET_RECEIPT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Every save of an editable document is a recorded revision. Append-only:
--    the runtime role may read and insert, never update or delete.
CREATE TABLE "document_revision" (
  "id"              UUID PRIMARY KEY,
  "caseId"          UUID NOT NULL REFERENCES "offboarding_case"("id"),
  "documentKind"    "DocumentKind" NOT NULL,
  "documentId"      UUID NOT NULL,
  "revision"        INTEGER NOT NULL,
  "kind"            "RevisionKind" NOT NULL,
  "content"         JSONB NOT NULL,
  "contentChecksum" TEXT NOT NULL,
  "note"            TEXT,
  "editedById"      UUID,
  "editedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "document_revision_documentKind_documentId_revision_key"
  ON "document_revision"("documentKind", "documentId", "revision");
CREATE INDEX "document_revision_caseId_idx" ON "document_revision"("caseId");

-- The revision log is history: refuse changes at the database as well as at
-- the privilege layer.
CREATE OR REPLACE FUNCTION trg_document_revision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document_revision rows are immutable';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_document_revision_no_update ON "document_revision";
CREATE TRIGGER trg_document_revision_no_update
  BEFORE UPDATE OR DELETE ON "document_revision"
  FOR EACH ROW EXECUTE FUNCTION trg_document_revision_immutable();

-- 3. A letter keeps HR's edited wording beside the template it came from.
ALTER TABLE "document_instance"
  ADD COLUMN "editedBody" TEXT,
  ADD COLUMN "editedById" UUID,
  ADD COLUMN "editedAt"   TIMESTAMP(3);

-- 4. An email record keeps the hierarchy's answer beside any override, and
--    remembers who edited it and which sent message it corrects.
ALTER TABLE "notification_record"
  ADD COLUMN "autoDestinationKey"      TEXT,
  ADD COLUMN "autoRecipientName"       TEXT,
  ADD COLUMN "autoRecipientMask"       TEXT,
  ADD COLUMN "autoRecipientCiphertext" TEXT,
  ADD COLUMN "autoRecipientConfigId"   UUID,
  ADD COLUMN "recipientOverride"       "RecipientOverrideKind",
  ADD COLUMN "recipientOverrideById"   UUID,
  ADD COLUMN "recipientOverrideAt"     TIMESTAMP(3),
  ADD COLUMN "recipientOverrideReason" TEXT,
  ADD COLUMN "hrNote"                  TEXT,
  ADD COLUMN "editedById"              UUID,
  ADD COLUMN "editedAt"                TIMESTAMP(3),
  ADD COLUMN "correctsRecordId"        UUID;

-- 5. The Exit Checklist for Return Items becomes a versioned document.
ALTER TABLE "return_items_checklist"
  ADD COLUMN "version"          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lifecycle"        "ReceiptLifecycle" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "hrNotes"          TEXT,
  ADD COLUMN "finalizedById"    UUID,
  ADD COLUMN "finalizedAt"      TIMESTAMP(3),
  ADD COLUMN "pdfObjectKey"     TEXT,
  ADD COLUMN "pdfChecksum"      TEXT,
  ADD COLUMN "outdatedReason"   TEXT,
  ADD COLUMN "supersededReason" TEXT,
  ADD COLUMN "createdById"      UUID;
CREATE UNIQUE INDEX "return_items_checklist_pdfObjectKey_key"
  ON "return_items_checklist"("pdfObjectKey");
-- One checklist per case becomes one LIVE checklist per case: versions stack.
DROP INDEX IF EXISTS "return_items_checklist_caseId_key";
CREATE UNIQUE INDEX "return_items_checklist_caseId_version_key"
  ON "return_items_checklist"("caseId", "version");
CREATE INDEX "return_items_checklist_caseId_idx" ON "return_items_checklist"("caseId");

-- Rows carry the receipt detail the printed form implies, and HR may add
-- rows for property the form does not list (no catalogue key).
ALTER TABLE "return_items_checklist_entry"
  ALTER COLUMN "itemKey" DROP NOT NULL,
  ADD COLUMN "quantity"       INTEGER,
  ADD COLUMN "condition"      TEXT,
  ADD COLUMN "returnedAt"     TIMESTAMP(3),
  ADD COLUMN "assetReference" TEXT,
  ADD COLUMN "custom"         BOOLEAN NOT NULL DEFAULT false;

-- 6. Signatures are collected on more than one document kind.
ALTER TABLE "signature_request"
  ADD COLUMN "documentKind" "SignatureDocumentKind" NOT NULL DEFAULT 'ACTION_FORM',
  ADD COLUMN "checklistId"  UUID REFERENCES "return_items_checklist"("id"),
  ALTER COLUMN "formId" DROP NOT NULL;
CREATE INDEX "signature_request_checklistId_idx" ON "signature_request"("checklistId");

ALTER TABLE "signature_record"
  ADD COLUMN "documentKind" "SignatureDocumentKind" NOT NULL DEFAULT 'ACTION_FORM',
  ADD COLUMN "checklistId"  UUID REFERENCES "return_items_checklist"("id"),
  ALTER COLUMN "documentId" DROP NOT NULL;
CREATE INDEX "signature_record_checklistId_idx" ON "signature_record"("checklistId");
-- One LIVE mark per block on a receipt, as on a form.
CREATE UNIQUE INDEX "signature_record_checklistId_blockKey_key"
  ON "signature_record"("checklistId", "blockKey")
  WHERE "supersededAt" IS NULL AND "checklistId" IS NOT NULL;

-- 7. Runtime privileges, in step with scripts/db/grants.sql.
DO $$ BEGIN
  GRANT SELECT, INSERT ON "document_revision" TO exit_app;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
