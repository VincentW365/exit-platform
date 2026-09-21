-- Employee directory and continuous synchronization (owner directive,
-- 2026-09-15). BambooHR stays the system of record; this platform keeps a
-- read-only operational mirror that its features read instead of calling
-- BambooHR on every request.
--
-- 1. The mirror gains the minimum extra fields a directory needs, a manager
--    link BY IDENTIFIER, and an archive marker for records the source feed no
--    longer lists. Every column is nullable and nothing existing is rewritten.
ALTER TABLE "employee_source_record"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "middleName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "preferredName" TEXT,
  ADD COLUMN "workPhone" TEXT,
  ADD COLUMN "workExtension" TEXT,
  ADD COLUMN "employmentStatus" TEXT,
  ADD COLUMN "hireDate" TIMESTAMP(3),
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "managerDirectoryId" UUID;

ALTER TABLE "employee_source_record"
  ADD CONSTRAINT "employee_source_record_managerDirectoryId_fkey"
  FOREIGN KEY ("managerDirectoryId") REFERENCES "employee_source_record"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Search runs against indexed local data (directive section 33).
CREATE INDEX "employee_source_record_sourceSystem_active_idx" ON "employee_source_record"("sourceSystem", "active");
CREATE INDEX "employee_source_record_sourceSystem_displayName_idx" ON "employee_source_record"("sourceSystem", "displayName");
CREATE INDEX "employee_source_record_sourceSystem_lastName_idx" ON "employee_source_record"("sourceSystem", "lastName");
CREATE INDEX "employee_source_record_sourceSystem_workEmail_idx" ON "employee_source_record"("sourceSystem", "workEmail");
CREATE INDEX "employee_source_record_sourceSystem_department_idx" ON "employee_source_record"("sourceSystem", "department");
CREATE INDEX "employee_source_record_sourceSystem_employmentStatus_idx" ON "employee_source_record"("sourceSystem", "employmentStatus");
CREATE INDEX "employee_source_record_sourceSystem_employeeNumber_idx" ON "employee_source_record"("sourceSystem", "employeeNumber");
CREATE INDEX "employee_source_record_managerDirectoryId_idx" ON "employee_source_record"("managerDirectoryId");

-- 2. Synchronization history: one row per run, whatever triggered it.
CREATE TABLE "directory_sync_run" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sourceSystem" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "requestedById" UUID,
    "employeeSourceId" TEXT,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "archived" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "directory_sync_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "directory_sync_run_requestedAt_idx" ON "directory_sync_run"("requestedAt");
CREATE INDEX "directory_sync_run_kind_requestedAt_idx" ON "directory_sync_run"("kind", "requestedAt");
CREATE INDEX "directory_sync_run_status_idx" ON "directory_sync_run"("status");
CREATE INDEX "directory_sync_run_employeeSourceId_idx" ON "directory_sync_run"("employeeSourceId");
