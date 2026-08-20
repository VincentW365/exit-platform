-- An emailed document is still the live instance for its (case, type) chain:
-- a corrected version must go through supersede, not appear alongside it.
-- Separate migration because the predicate uses the enum value added in
-- 20260819230000.
DROP INDEX IF EXISTS "uniq_live_document_per_case_type";
CREATE UNIQUE INDEX "uniq_live_document_per_case_type"
  ON "document_instance" ("caseId", "documentType")
  WHERE status IN ('DRAFT','VALIDATION_FAILED','PENDING_APPROVAL','RETURNED','APPROVED','RENDERING','RENDERED','MANUALLY_ISSUED','ISSUED_BY_EMAIL','RENDER_FAILED');
