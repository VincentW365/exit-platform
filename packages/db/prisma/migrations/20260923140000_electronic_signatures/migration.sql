-- Electronic initials and signatures on the Employee Action Form
-- (owner directives, 2026-09-23; DEC-068).

-- 1. A signature-request email type, alongside the existing controlled types.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SIGNATURE_REQUEST';

-- 2. Signing vocabulary.
DO $$ BEGIN
  CREATE TYPE "SignerRole" AS ENUM ('EMPLOYEE', 'HR_OFFICER', 'HR_MANAGER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SignatureType" AS ENUM ('INITIALS', 'SIGNATURE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SignatureRequestStatus" AS ENUM ('PENDING', 'SIGNED', 'REVOKED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SignatureProvenance" AS ENUM ('DRAWN', 'TYPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. One request per signer per form. The token hash is unique and is nulled
--    the moment the request ends; the encrypted raw token lets HR copy or
--    re-send the SAME link and is cleared at the same moment.
CREATE TABLE "signature_request" (
  "id"              UUID PRIMARY KEY,
  "caseId"          UUID NOT NULL REFERENCES "offboarding_case"("id"),
  "formId"          UUID NOT NULL REFERENCES "action_form_version"("id"),
  "documentTitle"   TEXT NOT NULL,
  "signerRole"      "SignerRole" NOT NULL,
  "signerName"      TEXT NOT NULL,
  "signerEmail"     TEXT,
  "status"          "SignatureRequestStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash"       TEXT,
  "tokenCiphertext" TEXT,
  "issuedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "requiredBlocks"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastSentAt"      TIMESTAMP(3),
  "sentCount"       INTEGER NOT NULL DEFAULT 0,
  "lastSentToMask"  TEXT,
  "firstOpenedAt"   TIMESTAMP(3),
  "signedAt"        TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "revokedReason"   TEXT,
  "extendedCount"   INTEGER NOT NULL DEFAULT 0,
  "consentText"     TEXT,
  "consentAt"       TIMESTAMP(3),
  "signerIpHash"    TEXT,
  "signerUserAgent" TEXT,
  "createdById"     UUID NOT NULL,
  "rowVersion"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "signature_request_tokenHash_key" ON "signature_request"("tokenHash");
CREATE INDEX "signature_request_caseId_idx" ON "signature_request"("caseId");
CREATE INDEX "signature_request_formId_idx" ON "signature_request"("formId");
CREATE INDEX "signature_request_status_expiresAt_idx" ON "signature_request"("status", "expiresAt");

-- 4. One applied mark per block per form version. The image is in private
--    object storage; this row is the record that proves who applied it.
CREATE TABLE "signature_record" (
  "id"              UUID PRIMARY KEY,
  "caseId"          UUID NOT NULL REFERENCES "offboarding_case"("id"),
  "documentId"      UUID NOT NULL REFERENCES "action_form_version"("id"),
  "requestId"       UUID REFERENCES "signature_request"("id"),
  "signerReference" TEXT NOT NULL,
  "signerName"      TEXT NOT NULL,
  "signerRole"      "SignerRole" NOT NULL,
  "signatureType"   "SignatureType" NOT NULL,
  "blockKey"        TEXT NOT NULL,
  "blockLabel"      TEXT NOT NULL,
  "provenance"      "SignatureProvenance" NOT NULL DEFAULT 'DRAWN',
  "storageKey"      TEXT NOT NULL,
  "checksum"        TEXT NOT NULL,
  "mimeType"        TEXT NOT NULL DEFAULT 'image/png',
  "width"           INTEGER NOT NULL,
  "height"          INTEGER NOT NULL,
  "signedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A mistaken mark is superseded, never deleted: exit_app has no DELETE
  -- anywhere, and signing evidence is history (CLAUDE.md rule 13).
  "supersededAt"      TIMESTAMP(3),
  "supersededReason"  TEXT,
  "supersededById"    UUID,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "signature_record_storageKey_key" ON "signature_record"("storageKey");
-- One LIVE mark per block; superseded ones stay for the record.
CREATE UNIQUE INDEX "signature_record_documentId_blockKey_key"
  ON "signature_record"("documentId", "blockKey")
  WHERE "supersededAt" IS NULL;
CREATE INDEX "signature_record_caseId_idx" ON "signature_record"("caseId");
CREATE INDEX "signature_record_requestId_idx" ON "signature_record"("requestId");

-- 5. The email that carries a signing link names its request, so the outbox
--    can resolve the live URL at dispatch instead of storing it.
ALTER TABLE "notification_record" ADD COLUMN "signatureRequestId" UUID;

-- 6. Runtime privileges for the two new tables. Kept in step with
--    scripts/db/grants.sql so a database that is migrated but not re-granted
--    still works: requests mutate (status, expiry, token destruction), and
--    marks are append-only apart from being superseded.
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON "signature_request" TO exit_app;
  GRANT SELECT, INSERT, UPDATE ON "signature_record" TO exit_app;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
