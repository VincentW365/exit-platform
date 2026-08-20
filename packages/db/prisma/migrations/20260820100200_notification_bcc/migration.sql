-- Email routing directive: blind copies on a notification record, handled
-- exactly like copies - addresses encrypted as one JSON array, with readable
-- names and masks alongside.
ALTER TABLE "notification_record"
  ADD COLUMN "bccCiphertext" TEXT,
  ADD COLUMN "bccNames"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "bccMasks"      TEXT[] DEFAULT ARRAY[]::TEXT[];
