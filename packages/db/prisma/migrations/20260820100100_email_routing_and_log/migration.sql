-- Email routing directive.
--
--  - notification_routing: which destinations each notification type is
--    addressed to. Destinations are KEYS ("static:IT",
--    "dynamic:EMPLOYEE_MANAGER"), never addresses - the address lives in the
--    recipient directory, so moving a department to a new mailbox is a
--    configuration change.
--  - email-log columns on notification_outbox: what routing intended, what
--    actually happened, whether it was a test send, and a safe error
--    sentence. Masks only; addresses stay encrypted on the configuration.

CREATE TABLE "notification_routing" (
  "id"               UUID NOT NULL,
  "notificationType" "NotificationType" NOT NULL,
  "toDestination"    TEXT NOT NULL,
  "ccDestinations"   TEXT[] DEFAULT ARRAY[]::TEXT[],
  "bccDestinations"  TEXT[] DEFAULT ARRAY[]::TEXT[],
  "note"             TEXT,
  "updatedById"      UUID,
  "rowVersion"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_routing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_routing_notificationType_key"
  ON "notification_routing"("notificationType");

ALTER TABLE "notification_outbox"
  ADD COLUMN "lastErrorDetail"  TEXT,
  ADD COLUMN "intendedToMask"   TEXT,
  ADD COLUMN "intendedCcMasks"  TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "intendedBccMasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "actualToMask"     TEXT,
  ADD COLUMN "wasTestMode"      BOOLEAN NOT NULL DEFAULT false;
