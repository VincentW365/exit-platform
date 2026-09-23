-- Email banner as a supplied image asset (owner directive, 2026-09-23; DEC-067).
--
-- 1. The plain-text banner introduced by 20260922120000_single_approval_gate is
--    retired before it ever shipped: the banner is a JPG graphic kept in object
--    storage, referenced from the user row. No environment beyond local
--    development carried the text column, so it is dropped rather than kept.
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "emailBanner";
ALTER TABLE "app_user"
  ADD COLUMN "emailBannerObjectKey" TEXT,
  ADD COLUMN "emailBannerChecksum" TEXT,
  ADD COLUMN "emailBannerMime" TEXT,
  ADD COLUMN "emailBannerWidth" INTEGER,
  ADD COLUMN "emailBannerHeight" INTEGER,
  ADD COLUMN "emailBannerAlt" TEXT,
  ADD COLUMN "emailBannerFileName" TEXT;

-- 2. The development capture keeps the HTML part and the banner it referenced
--    so the mailbox preview shows the complete email presentation.
ALTER TABLE "notification_capture"
  ADD COLUMN "html" TEXT,
  ADD COLUMN "bannerObjectKey" TEXT,
  ADD COLUMN "bannerChecksum" TEXT,
  ADD COLUMN "bannerMime" TEXT,
  ADD COLUMN "bannerAlt" TEXT,
  ADD COLUMN "bannerWidth" INTEGER,
  ADD COLUMN "bannerHeight" INTEGER,
  ADD COLUMN "bannerKind" TEXT;
