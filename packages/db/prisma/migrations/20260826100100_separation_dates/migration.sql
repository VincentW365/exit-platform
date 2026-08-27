-- Canonical separation model, part 2 of 2 (owner directive, 2026-08-26).
--
-- Separates the date concepts the platform had been collapsing into one
-- "exit date", and records the two facts the platform must not infer:
-- whether notice applies to an OTHER separation, and who authorized an
-- employer-initiated one.
--
-- Every column is nullable and no existing value is rewritten. A case
-- created before today keeps exactly the dates it was created with; the
-- notice-received concept continues to be carried by `receivedAt`, which
-- already meant "when this reached HR", so nothing is migrated across.
ALTER TABLE "offboarding_case"
  ADD COLUMN "contractEndDate" TIMESTAMP(3),
  ADD COLUMN "noticeApplicableOverride" BOOLEAN,
  ADD COLUMN "separationTypeDetail" TEXT,
  ADD COLUMN "authorizedByName" TEXT,
  ADD COLUMN "dateOverrideReason" TEXT;

-- Contract expiry is the one type that reads a date straight from employee
-- data, so the directory record needs somewhere to hold it. Read-only, like
-- every other column on this table: the platform never writes to BambooHR.
ALTER TABLE "employee_source_record" ADD COLUMN "contractEndDate" TIMESTAMP(3);
