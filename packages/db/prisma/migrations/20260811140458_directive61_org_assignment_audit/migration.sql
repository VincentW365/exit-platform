-- CreateEnum
CREATE TYPE "CaseManagerSource" AS ENUM ('DIRECTORY', 'OVERRIDE', 'MANUAL');

-- AlterTable
ALTER TABLE "employee_source_record" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "division" TEXT,
ADD COLUMN     "employeeNumber" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "managerName" TEXT,
ADD COLUMN     "managerSourceId" TEXT;

-- AlterTable
ALTER TABLE "offboarding_case" ADD COLUMN     "activationConfirmations" JSONB,
ADD COLUMN     "assignedOfficerId" UUID,
ADD COLUMN     "managerChangeFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "managerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "managerConfirmedById" UUID,
ADD COLUMN     "managerName" TEXT,
ADD COLUMN     "managerSource" "CaseManagerSource",
ADD COLUMN     "managerSourceId" TEXT,
ADD COLUMN     "managerUserId" UUID;

-- CreateIndex
CREATE INDEX "employee_source_record_sourceSystem_managerSourceId_idx" ON "employee_source_record"("sourceSystem", "managerSourceId");

-- CreateIndex
CREATE INDEX "offboarding_case_assignedOfficerId_idx" ON "offboarding_case"("assignedOfficerId");

-- AddForeignKey
ALTER TABLE "offboarding_case" ADD CONSTRAINT "offboarding_case_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_case" ADD CONSTRAINT "offboarding_case_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Directive 6.1 backfill: promote existing payload provenance into the new
-- typed columns. Additive only; the payload is retained unchanged.
UPDATE "employee_source_record" SET
  "managerName"    = NULLIF("payload"->>'managerName', ''),
  "division"       = NULLIF("payload"->>'division', ''),
  "employeeNumber" = NULLIF("payload"->>'employeeNumber', ''),
  "active"         = COALESCE(("payload"->>'active')::boolean, true),
  "lastSyncedAt"   = "retrievedAt";
