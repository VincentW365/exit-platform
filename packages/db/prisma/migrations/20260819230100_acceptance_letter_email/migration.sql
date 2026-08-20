-- Resignation acceptance letter issued by email (DEC-054).
--
--  - the home address HR types from the resignation letter scan, so the
--    letter can be addressed (personal data: HR participants only);
--  - copied recipients on a notification record, encrypted as one JSON array
--    with readable names and masks alongside;
--  - the link from a notification record to the rendered document it carries.
--    The PDF bytes stay in object storage and are read (and checksum-verified)
--    at dispatch - they are never duplicated into the record or the outbox.

ALTER TABLE "offboarding_case" ADD COLUMN "employeeAddress" TEXT;

ALTER TABLE "notification_record"
  ADD COLUMN "ccCiphertext" TEXT,
  ADD COLUMN "ccNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ccMasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "attachedDocumentId" UUID;

ALTER TABLE "notification_record"
  ADD CONSTRAINT "notification_record_attachedDocumentId_fkey"
  FOREIGN KEY ("attachedDocumentId") REFERENCES "document_instance"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notification_record_attachedDocumentId_idx"
  ON "notification_record"("attachedDocumentId");
