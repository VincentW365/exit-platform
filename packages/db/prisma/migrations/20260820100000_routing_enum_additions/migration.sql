-- Email routing directive: the remaining departmental destinations, so no
-- workflow or component has to name a mailbox.
-- Separate migration: Postgres cannot use a newly added enum value in the
-- transaction that adds it.
ALTER TYPE "RecipientClassDir" ADD VALUE 'HR_OFFICERS';
ALTER TYPE "RecipientClassDir" ADD VALUE 'PAYROLL';
ALTER TYPE "RecipientClassDir" ADD VALUE 'SECURITY';
ALTER TYPE "RecipientClassDir" ADD VALUE 'ASSET_WAREHOUSE';
