-- Single authorization gate (owner directive, 2026-09-22; DEC-066).
--
-- 1. The HR Manager approves the CASE once; the HR person executing it then
--    finalizes each document in one attested step. The attestation records
--    that meaning under its own kind. Existing HR_DOCUMENT_APPROVAL rows are
--    history and are never rewritten.
ALTER TYPE "AttestationKind" ADD VALUE IF NOT EXISTS 'HR_DOCUMENT_FINALIZATION';

-- 2. Section 8: every user may keep a short plain-text email banner that is
--    appended beneath their sender block on outgoing email. Nullable and
--    additive; nothing existing changes.
ALTER TABLE "app_user"
  ADD COLUMN "emailBanner" TEXT,
  ADD COLUMN "emailBannerUpdatedAt" TIMESTAMP(3);
